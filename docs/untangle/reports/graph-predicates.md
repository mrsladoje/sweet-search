# graph-predicates report

## (1) Done
- T1 live-row predicate: added `liveEntitySql(alias)` / `liveRelationshipSql(alias)` to core/infrastructure/code-graph-visibility.js (unpinned form of the existing helpers). Replaced identical copies:
  - code-graph-repository.js `_entity/_relationshipVisibilitySql/Params` -> entityVisibilitySql etc. (identical, alias param passes through)
  - graph-search.js `_entityVisibilitySql` (keeps allowNullJoined wrapper), `_relationshipVisibilitySql` (helper + trace-only clause), both Params
  - graph-expansion.js `_entityVisibility`, `_relationshipVisibility`: now import the helper and TRACE_ONLY_TYPES_SQL; the inlined copy and export `GRAPH_EXPANSION_TRACE_ONLY_TYPES_SQL` removed; tests/graph/trace-only-ranking-safety.test.js adapted (assertion on the copy removed). The "import-free" comment is gone with it. Line ~319 (agent-format check, other agent) untouched.
  - structural-pagerank.js (entity `stale_since IS NULL AND epoch_retired IS NULL`, relationship), community-detector.js (LIVE_RELATIONSHIPS, entity query), import-resolver.js buildFileImportMap `liveRel`, structural-alias-resolver.js line 97, relationship-resolver.js lines 608/654/1298 (relationship-only fragments)
- T2 id recipe: new `logicalEntityId(relPath, type, name)` in core/infrastructure/file-nodes.js; `fileNodeId` and `GraphExtractor.makeId` call it (makeId passes `name:disambiguator` as name when options are given, same bytes). The hashed text is identical: `${relPath}:${type}:${name}`. Input preparation stays with each caller (fileNodeId turns `\` into `/`; makeId applies path.relative with projectRoot and no backslash change).
- T3 dead HCGS sidecar reader: removed probe, `_summaryJoinSql`, `_summarySelectSql`, `_summaryVisibilityParams`, `_summaryVisibleForEntity`, `_rowWithVisibleSummary` (and its ~17 call sites), `_summaryVisibilityCache` from core/graph/graph-search.js. Queries now select `entities.summary` directly, the same SQL that ran when the table was absent. Proof: whole-repo `rg hcgs_summary_metadata` finds a creator only in core/incremental-indexing/infrastructure/hcgs-invalidation.mjs (importers: tests only, `recordSummary` has no product caller); eval/ and scripts/ do not create it. Tests of the removed feature deleted in tests/graph/graph-search.test.js (3 `it` blocks: pinned retired summaries, live cache, sidecar created after open) and the summary assertions in the alias test.
- T4 exports without a user (`export` keyword removed, bodies kept): import-scanner `SFC_LANGUAGE`, `destructuredNames` (still on the default export object); receiver-types `receiverTypesSupported`; graph-extractor `codeBeforeComment`, `elixirHeredocLines`, `mergeElixirClauses`, `clampSentinelEndLines`, `setSchemaVersion`, `createCommentLineTracker`; bare-call-resolution `BARE_CALLABLE_TYPES`, `languageOfPath`; structural-importance `REL_WEIGHT`, `TYPE_WEIGHT`, `logNorm`, `getAblationFlags`, `hintScore`; structural-context `isGenericTargetName`; trace-overloads `parenBody`, `maskCode`, `closeOf`, `listParts`, `parseParameter`; relationship-resolver `detectProject` (named export only; still on default object); hcgs-generator `generateEntitySummary` and the `_cliMain` alias line. No barrel line named any of these (barrel is `export *`).

## (2) Not done and why
- structural-context.js `sectionItemLimit`, `impactPathLimit`, `itemCodeCap`: KEPT exported. eval/trace-truncation-classify/classify.mjs imports them.
- code-graph-visibility.js `CodeGraphReaderVisibility.hasSummarySidecar` / `summaryVisible` (called at structural-context-repository.js:235) is the same dead sidecar probe. Not in the task list and its tests (tests/graph/structural-context.test.js creates the table) would change; left alone.
- Copies not replaced: see (3).

## (3) Behavior questions (copies that differ from the helper)
All are table-or-condition differences; unchanged.
- structural-alias-resolver.js:4 `ACTIVE = 'stale_since IS NULL'`: entity filter without epoch_retired.
- structural-graph-signals.js:42 default `'stale_since IS NULL'`: same gap (callers may pass the real visibility SQL).
- override-edges.js:111 `live = 'AND epoch_retired IS NULL'`: also applied to entities (no stale_since check), so not the entity helper.
- import-resolver.js:2152 `liveEnt`: entities, epoch_retired only, no stale_since.
- relationship-resolver.js:609 `e.epoch_retired IS NULL` and :1297 `entityLive`: entities, epoch_retired only.
- graph-search.js:~625 and code-graph-repository.js:~1370-1384 stale-file lookups: use `stale_since IS NOT NULL` and `epoch_retired <= ?`, a different rule on purpose.
- Question: should entity readers above also require `stale_since IS NULL`? A change would alter results on graphs with soft-deleted rows.

## (4) Needs follow-up (outside my file set)
- core/incremental-indexing/application/production-reconciler.mjs ~217 `graphEntityLogicalId` is a third copy of the id recipe: it can call `logicalEntityId` from core/infrastructure/file-nodes.js.
- Live-row copies outside my set: core/vocabulary/vocab-warmer.js:496-498, vocab-miner.js:522, core/indexing/indexer-sparse-gram.js:84, indexer-ann.js:115, artifact-builder.js:61, core/search/context-expander.js, core/incremental-indexing/** (graph-gc.mjs and others). Not checked line by line.
- hcgs-invalidation.mjs, graph-gc.mjs:255-275, maintenance-state-reader.mjs:226 still handle the sidecar table.

## (5) Verification
- `node --check` on all 18 edited core files: no output (pass).
- `npx eslint` on the same files: clean.
- `npx vitest run tests/graph tests/integration/barrel-contracts.test.js`: Test Files 73 passed (73), Tests 1219 passed (1219). (`tests/search/search-trace*.test.js` matches no file; skipped.)
- 30 more test files that import the touched modules (rg list, outside tests/graph): 29 passed, 625 tests passed.
