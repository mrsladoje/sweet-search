# split-context-expander report

## Done
- Split core/search/context-expander.js (3029 lines) into 8 modules in core/search/packaging/; pure move, verified by verify-move.mjs.
- context-expander.js keeps packageForAgent and toAblationSet, and re-exports every name it exported before.
- core/search/search-pattern.js: only the final `export {...} from` line changed, split into 7 export-from lines pointing at the new modules (barrel names unchanged).
- No product file other than search-pattern.js imported a moved name from context-expander.js (sweet-search.js and search-pattern.js import only packageForAgent). agent-output-fixes.js untouched.
- Names that were file-private but used across modules got an `export` keyword (inferLanguage, LANG_KEYWORDS, safeCall, subjectOf, resolveSubMode, TEST_QUERY_RE, assembleSandwichCode, clampTextToTokenCap, MAX_HEADER_TOKENS, budget constants, RELATED_* constants, etc.).
- Imports among new modules (no cycle): header-context -> span-expansion, budget; sufficiency -> header-context; graph-neighbors -> header-context, related-rows, budget; budget -> related-rows (safeCall); same-file-map -> budget; span-expansion, related-rows, staleness have no sibling imports.

| file | lines | names |
|---|---|---|
| core/search/context-expander.js |      683 | toAblationSet packageForAgent  |
| core/search/packaging/budget.js |      561 | estimateTokens DEFAULT_TOKEN_BUDGET AGENT_FULL_TOKEN_BUDGET AGENT_FULL_XL_TOKEN_BUDGET DEFAULT_PER_RESULT_CAPS allocateBudget FIRST_UNIT_TOKENS POINTER_TAIL_RATIO FIRST_UNIT_CALIBRATED_RANKS allocateBudgetShipped truncateToTokenCap DEFINITION_LEAD_LINE startAtNamedDefinition prefixWithCutMarker compressToPreview resolveSubMode PREVIEW_TIER_BUDGET BUDGET_TIERS computeBudgetSignals selectAgentBudget  |
| core/search/packaging/graph-neighbors.js |      301 | IMPORT_FILE_EXT_RE isResolvedImportFile GRAPH_NEIGHBORS_EXCLUDED_MODES graphNeighborsEnabled goUnexportedElsewhere extractTypeCandidates renderGraphNeighbors  |
| core/search/packaging/header-context.js |      244 | MAX_HEADER_TOKENS LANG_KEYWORDS extractImportLines extractHeaderContext clampTextToTokenCap  |
| core/search/packaging/related-rows.js |      191 | SCOPE_ENTITY_TYPES relatedSubjectEntity subjectOf RELATED_DEFAULT_ROWS RELATED_AMBIGUOUS_DEFS RELATED_AMBIGUOUS_FANIN RELATED_GENERIC_DEFS RELATED_FANIN_PROBE safeCall renderRelatedRowLine shortestUniquePath TEST_QUERY_RE subtokensAgree countAgreeing relatedRowScore CONTAINER_ROW_MIN_LINES CONTAINER_MEMBER_MIN_AGREE CONTAINER_MEMBERS_MAX CONTAINER_TYPES MEMBER_TYPES containerRowMembers annotateContainerRowMembers selectRelatedRows  |
| core/search/packaging/same-file-map.js |      132 | buildSameFileMap refillCoveredSummaries  |
| core/search/packaging/span-expansion.js |      633 | inferLanguage findEnclosingEntity expandToSymbol buildSandwichExpansion assembleSandwichCode elisionMarker mergeSiblingChunks expandBySyntax expandLeadingTrivia getIndentLevel  |
| core/search/packaging/staleness.js |       65 | checkStaleness  |
| core/search/packaging/sufficiency.js |      259 | computeConfidence extractCodeIdentifiers unresolvedExternalRefs computeSufficiency  |

## Not done
- Nothing skipped. startAtNamedDefinition, compressToPreview, truncateToTokenCap and resolveSubMode sit in budget.js (token-cap and tier jobs); LANG_KEYWORDS and inferLanguage sit in header-context.js and span-expansion.js as shared primitives.
## Behavior questions
- None.
## Needs follow-up
- Stale comments elsewhere name context-expander.js for moved functions (core/graph/structural-context.js:303, core/indexing/worktree-index.mjs:450, core/infrastructure/code-graph-repository.js:682, agent-output-fixes.js comments, search-postprocess.js:982). Left alone (outside file set).
- budget.js imports safeCall from related-rows.js only for startAtNamedDefinition; a small shared util would be cleaner later.
## Verification
- verify-move.mjs last line: declarations before: 74; problems: 0; exports before: 29; export names no longer at the old path: none
- depgraph + analyze: only import cycle listed is core/prompt-optimization/sweep/gepa (not core/search).
- node --check on all 9 files + search-pattern.js: clean. npx eslint core/search: clean. check-boundaries: All domain boundaries clean.
- vitest tests/search tests/agent-tools tests/mcp barrel-contracts tests/ranking: first run 6 failed in daemon-lifecycle.integration.test.js (load); that file rerun alone: 13 passed. Other 34 files (agent-tools, mcp, barrel, ranking): 589 passed.
