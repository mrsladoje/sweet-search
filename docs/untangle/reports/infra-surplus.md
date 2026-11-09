# infra-surplus report

## (1) Done
- core/infrastructure/config/index.js: removed the aggregate `export default {...}` and the 8 `import {...}` lines that only fed it. Proof: no static default import, no `(await import()).default`, no `config.default`, no `import * as` + `.default` of config/index.js or core/config.js anywhere (core, tests, scripts, mcp, eval, string-built paths). Only users of the default were the barrel line `export { default as config }` and one contract-test case.
- core/config.js: removed `export { default } from ...`.
- core/infrastructure/index.js: removed `export { default as config }` (no importer takes `config` from the barrel; checked all 32 barrel importers).
- core/infrastructure/config/search.js: removed `ROUTING_CONFIG` (only the facade default and the contract test named it). Header comment adjusted.
- core/infrastructure/config/embedding.js: removed `isMistralAvailable`, `isJinaAvailable`, `getOptimalBatchSize` (no reader anywhere; only the removed default object).
- core/infrastructure/config/platform.js: removed `DB_PATHS.summaries` (no reader; the only other hit is the string 'code-summaries.json' in scripts/benchmark-harness.js, not the key; no Object.values/entries/spread of DB_PATHS exists).
- tests/integration/barrel-contracts.test.js: removed the `ROUTING_CONFIG` assertion and the whole "config default export" case.
- core/indexing/artifact-builder.js: removed `saveArtifacts`, `updateArtifacts`, the "INT8 VECTORS (DEPRECATED)" comment block, the `deprecatedInt8Db` check in `getArtifactStats`, and the two names (plus a stale NOTE comment) in the default export object. Proof: no caller of either function in any file (also through `artifactBuilder.` and the barrel). `buildHnswIndex` untouched.

## (2) Not done and why
- `DB_PATHS.int8Vectors` KEPT: core/indexing/indexer-phases.js:991-992 (outside my file set) still reads it. Follow-up if wanted: remove that block in indexer-phases.js, then the key.
- `batchQuantizeToInt8` / `batchQuantizeToBinary` KEPT: the file's own CLI `test` command (artifact-builder.js `node artifact-builder.js test`) calls them. Removing would change CLI behavior. They are also in the default export object.
- "Config keys nothing reads": I checked the named ones only. A full key-by-key audit of config/*.js was not done (no automatic proof; low value).
- Barrel exports: none removed (as ordered).

## (3) Behavior questions
- core/prompt-optimization/data/query-shapes/ss-trace/probes.json lists `updateArtifacts` twice in expected-answer lists (lines ~6040, ~10149). Data file, not code. The lists already name a function that does not exist (`buildHnswIndexFromDb`), so they are stale. I did not touch it (protected area). Decide whether to refresh.
- `ss-trace` / `getArtifactStats()` output no longer has `deprecatedInt8Db` when an old codebase-int8.db file exists. No consumer reads it.

## (4) Needs follow-up
- Paper freeze: eval/benchmarks/hnsw-rivals/paper/{FREEZE,REPFREEZE,POSTFREEZE,POSTHOCFREEZE,MECHFREEZE}.json hold SHA-256 of core/config.js, core/infrastructure/index.js, config/embedding.js, config/platform.js, config/index.js, config/search.js, core/indexing/artifact-builder.js, core/embedding/index.js, core/indexing/index.js, core/query/index.js, llm-provider.js. freeze_check.py demands exact match against the checkout. Before my edits these already differed: artifact-builder.js, config/index.js, config/search.js, config/vector-store.js, core/indexing/index.js, core/query/index.js. My edits additionally change core/config.js, core/infrastructure/index.js, config/embedding.js, config/platform.js (they matched the freeze before). If the paper runs from the working tree, `freeze_check.py` already failed; if it runs from a pinned commit/worktree, no effect. Lead: confirm the paper uses a pinned checkout. If it does not, revert those 4 files (core/config.js, infrastructure/index.js, embedding.js, platform.js) and keep the rest.
- T4 fix needs edits outside my set (see below): core/infrastructure/manifest.json, scripts/generate-asset-manifest.js, package.json `files`.

## T3 barrel table (static + dynamic + string-built import sites across whole repo; "research" = eval/, scripts/, core/training, core/prompt-optimization; scripts/init.js and scripts/verify-runtime.js are shipped tooling counted as research)
Method: script parses export lists (incl. `export *` chains) and every importer; names taken by braces/destructuring exactly, namespace importers by `.NAME`. Script: SCRATCH/barrel-table.cjs, raw: SCRATCH/barrel-table.json.

| barrel | names | product | test only | research only | test+research | nobody |
|---|---|---|---|---|---|---|
| core/infrastructure/index.js | 171 | 8 | 43 | 17 | 11 | 92 |
| core/indexing/index.js | 98 | 0 | 0 | 1 (ASTChunker) | 0 | 97 |
| core/query/index.js | 17 | 0 | 6 | 0 | 1 (QueryRouter) | 10 |
| core/embedding/index.js | 106 | 5 | 25 | 4 | 5 | 67 |

Importer counts (product/test/research): infrastructure 6/15/11; indexing 0/0/2; query 0/2/3; embedding 4/9/6.
- infrastructure product: applyReadPragmas, resolveNativeBinary, isDedupAvailable, computeFingerprints, clusterFingerprints, readPersistedLiPolicy, applyPersistedLiModel, DEDUP_CONFIG. Research only: LATE_INTERACTION_CONFIG, _resetCoreMLCache, detectHardwareCapability, getCoremlCascadeRoot/EmbedDir/LiDir/LiEdgeDir/State/Report, getSkippedOptInModels, isNativeAcceleratedModel, fetchCoremlCascade, getCascadeSpec, resolveFamiliesToFetch, getDedupLoadError, describeDedupConfig, computeFileHash. Test+research: fetchModel, getModelCacheDir, MODEL_REGISTRY, getModelEntry, getModelsForProfile, getPlatformInfo, resolveNativeAddon, isAppleSilicon, isCoreMLProviderAvailable, generateWithRetry, DB_PATHS. Test only (43) includes the contract test's existence checks (config constants, wasm*, ORT, language names). "Nobody" (92) includes repositories, quantization, SIMD, relationship-type/file-node/import-path helpers: all reach their users by direct module path.
- indexing barrel: only importers are eval/scripts/freeze-pattern-chunk-ids.js and scripts/ast-chunker-cli.js, both take only `ASTChunker`. No product code, no test imports this barrel. 97 names unused through it.
- query barrel: importers scripts/benchmark.js, scripts/test-router-phase1.js, scripts/test-routing-performance.js (QueryRouter), tests/query/intent-router.test.js, barrel-contracts. Nobody uses the catboost names or intent boosts through it.
- embedding product: expandVocabulary (core/vocabulary/vocab-prewarm-cli.js), getEmbedding (graph/hcgs-generator, indexing/indexer-phases), set/clear/getEmbeddingPool (indexing/indexer-pool.js). Research only: truncateForHNSW, floatToInt8, int8CosineSimilarity, floatToBinary (scripts/diagnose-int8.js, stage1-recall.js). Test+research: hammingDistance, getBinaryEmbedding (eval/benchmarks/hnsw-rivals/*), getLocalPipeline, callLocalModel, unloadLocalModel.

Side effects of importing the indexing barrel: yes. It re-exports ./index-codebase-v21.js, so importing it loads the whole indexer module graph. Top-level effect: if SWEET_SEARCH_UV_THREADPOOL_SIZE is set and UV_THREADPOOL_SIZE is not, it sets process.env.UV_THREADPOOL_SIZE (lines 36-38). `main()` runs only when the file is the direct entry (realpath of import.meta.url equals argv[1]), so a barrel import does not start indexing. The barrel's two importers are research scripts (ASTChunker only); import ./ast-chunker.js directly would avoid the load, but those are research files.

## T4 query router model version
- What the runtime loads: core/query/query-router.js loads only the WASM router crates/wasm-router/pkg/query_router_wasm.js. The JS CatBoost file is loaded only by core/query/query-router-catboost.js, which imports `v46_router_d4.js`; that module has no product caller (only core/query/index.js barrel, crates/wasm-router/*.js equivalence checks, tests/query/query-router-3class.test.js). crates/wasm-router/extract-trees.js defaults to v46 as the tree source.
- Names v45: core/infrastructure/manifest.json:8 (`catboostRouter`), scripts/generate-asset-manifest.js:18 (generator for that manifest), package.json:86 `files` (lists both v45 and v46), docs/INIT_STRATEGY.md:743-744,848, comment core/query/query-router-catboost.js:4 ("v45_depth4"), training scripts (grid-search-catboost.py, benchmark-3class-router.js comparison text), FREEZE*.json hashes (both files).
- Names v46: query-router-catboost.js:12 (import), extract-trees.js:15, evaluate-catboost-router.js:348, benchmark-3class-router.js:129, package.json:87, tests/query/query-router-3class.test.js:22 comment.
- Inconsistency: manifest + generator + scripts/verify-runtime.js (`load:catboost-router` deep check, line ~202 reads manifest.catboostRouter) check v45, but the code that imports a CatBoost JS file uses v46. verify-runtime therefore tests a file nothing loads, and a rebuild of the manifest keeps the error.
- Smallest fix: change v45 to v46 in manifest.json and scripts/generate-asset-manifest.js (2 lines); optionally drop v45 from package.json `files` (v45 only matters to training docs; both files are frozen in the paper FREEZE json, so do not delete the file). Note the test tests/integration/verify-runtime.test.js and manifest tests may pin v45: check before changing.

## T5 domain code inside the support layer (core/infrastructure)
Counts = files outside the file itself that name it (code only; barrel counted once).
- llm-provider.js: core/graph/hcgs-generator.js (1), infrastructure barrel + config/index.js comment (2), tests/infrastructure (1). Research: reaches it through the barrel only (`generateWithRetry` in core/training/query-router/reviewers/llm-labeler.js). Not in protected-surface, but the FREEZE json hashes it.
- view-templates.js: core/graph (3: bare-call-resolution, graph-extractor, relationship-resolver), core/indexing (2: ast-chunker, chunking/view-chunker), tests/indexing (1). No research use, not protected.
- structural-alias-resolver.js: only structural-context-repository.js + tests (graph 1, search 1). Not protected.
- structural-candidate-ranker.js: only structural-context-repository.js. Not protected.
- structural-context-repository.js: core/graph (3: structural-context, structural-forward-push, graph-search), infrastructure (1: structural-graph-signals), core/prompt-optimization (1: scripts/preprocess.mjs, string path in comment and static import), tests 10. PROTECTED (protected-surface.txt line 76).
- structural-context-utils.js: core/graph (1), infrastructure (2: graph-name-indexes, repository), tests/graph (1). Not protected.
- structural-graph-signals.js: only structural-context-repository.js. Not protected.
- structural-qualified-resolution.js: infrastructure (2: language-patterns/registry-core, repository), core/search (1: context-expander), tests 2. Not protected.
- structural-source-definitions.js: only structural-context-repository.js + one test. Not protected.
No moves made. Only structural-context-repository.js is pinned by research; the other 6 structural files are reached only through it, so they could move together with it only if that path is kept (a re-export stub) .

## (5) Verification
- `node --check` on all edited core files: no output (pass).
- `npx eslint core/infrastructure/config core/config.js core/infrastructure/index.js core/indexing/artifact-builder.js tests/integration/barrel-contracts.test.js` -> clean.
- `npx vitest run tests/infrastructure tests/integration/barrel-contracts.test.js tests/embedding tests/query tests/ranking/late-interaction-config.test.js tests/ranking/local-reranker.test.js tests/indexing/phase5-artifacts.integration.test.js tests/indexing/indexer-profile.test.js` -> Test Files 46 passed (46), Tests 890 passed (890).
- No tests/indexing/artifact-builder*.test.js exists (glob matched nothing); artifact-builder is covered by phase5-artifacts and the vector-store/embedding tests above.
