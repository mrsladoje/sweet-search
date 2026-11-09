# search-core report

## Done
- T1: new core/infrastructure/agent-format.js (frozen AGENT_FORMATS Set + isAgentFormat). Replaced 4-format sets in: search-postprocess.js (393 const removed, 682 inline set), sweet-search.js (50, 1005), search-hybrid.js (19, 196), body-lexical.js (29), search-boost.js (125), search-pattern.js (147), search-server.js (75; also used at :1056), file-kind-ranking.js (~2101; env override SWEET_SEARCH_FORCE_BM25F_BOOSTS kept).
  Local variables named isAgentFormat exist in postprocess/server/file-kind-ranking, so those files import AGENT_FORMATS (.has) instead of the function.
- T2: new core/search/ablations.js (hasAblation). Used in search-hybrid, body-lexical, search-postprocess, sweet-search (empty-rescue), search-rrf, search-semantic. No ablation name removed.
- T3 removed: legacy hybridSearch (+ prototype wiring + barrel export), SmartSearch alias (+ barrel), warmSearch (+ barrel), `get codebaseDb()`, SMART_SEARCH_COLOR_MODE / SMART_SEARCH_HEADER_STYLE aliases. SEARCH_SERVER_PORT export became local const REQUEST_URL_PARSE_BASE ('http://localhost:9876') in search-server.js; its stale TCP-port comment replaced by one line.

## Not done and why
- formatGrepResults: NOT removed. search-format.js:149 (formatResults) calls it. Only the barrel export would be removable; I kept both.
- toAblationSet (context-expander.js:~2398): kept. It returns a Set that packageForAgent uses with `.has()` in many places, and tests/search/span-dedupe.test.js tests it. It is a normaliser, not the predicate.
- graph-expansion.js ~319: NOT changed. The file states it is deliberately import-free ("callers inject all dependencies"). It tests the same 4-set (plus env override). See follow-up.
- file-kind-ranking.js keeps its own hasAblation (line ~317); it is outside my named sites.

## Behavior questions
Sites testing a DIFFERENT set (left unchanged):
- search-pattern.js:649 and :874: `format === 'agent' || 'agent_preview' || 'agent_full' || 'agent_full_xl'` (same 4-set as an || chain, but outside the one line I may edit).
- search-pattern.js:~762-766 (ssFindIsAgentFormat): same 4-set as || chain.
- search-hybrid.js:~170 anchor injection / allowPlainTitlecase: `options.format === 'agent'` only.
- search-semantic.js fullVectorStageWanted: `options.format !== 'agent'` only (agent_* tiers still get stage rescore).
- sweet-search.js:~845 `patternResult.format === 'agent'` only.
- mcp/tool-handlers.js:140 `_isAgentFormat: format === 'agent'` only.
- search-pattern.js:150 isAgentFormat(options): `_isAgentFormat === true || 4-set` (flag OR set).
- core/graph/graph-search.js:42 DOC_COMMENT_FORMATS: same 4-set (outside my file set).
- hybridSearch removal: eval/maxsim-bench/rerun/pipeline-hook.mjs:52 names 'hybridSearch' in a profiling wrap list. wrapAsync does `typeof orig !== 'function'` return, so a missing method is harmless. Brief rule 3 says a user blocks removal; I judged a no-op name list is not a caller and removed it. Revert the hybridSearch part if you disagree.

Places that set `_isAgentFormat` (unchanged):
- core/search/sweet-search.js:~1026 `true` (agent packaging path)
- core/search/search-pattern.js:~653, ~896 `true`
- core/search/search-server.js:~1211 `Boolean(agentFormat)` where agentFormat comes from resolveAgentSearchRequest (any of the 4 formats, or 'agent' when ?agent=true)
- mcp/tool-handlers.js:140 `format === 'agent'` (read-only; note only 'agent' not the other tiers)
- search-server.js:~1787-1832 client helper forwards it as ?agent=true
- file-kind-ranking.js:~2171 derives it locally: 4-set OR SWEET_SEARCH_FORCE_BM25F_BOOSTS=1
- mcp/server-main.js: does not set or read it.
Readers: search-format.js:44, context-expander.js (default false at ~2416; many `=== true` gates), search-pattern.js (416/452/458/150), file-kind-ranking.js (1682/1756/1794).

## Needs follow-up (outside file set)
- core/graph/graph-expansion.js:~319: replace the 4-string || chain with AGENT_FORMATS only if import-free rule is relaxed (or inline-duplicate remains).
- core/graph/graph-search.js:42: DOC_COMMENT_FORMATS is the same set.
- search-pattern.js:649, :766, :874: use isAgentFormat/AGENT_FORMATS (grep-path file: needs the Rust lane check per CLAUDE.md; this change is behavior-neutral but touches a lane-mirrored file).
- eval/maxsim-bench/rerun/pipeline-hook.mjs:52 may drop 'hybridSearch' from its list.

## Verification
- `node --check` on all edited files: clean.
- `npx eslint` on all edited core/ files (search-*, body-lexical, ablations, index, cli-decoration, sweet-search, agent-format, file-kind-ranking): clean (no output).
- `npx vitest run tests/search tests/ranking tests/integration/barrel-contracts.test.js tests/mcp`: Test Files 127 passed | 1 skipped (128); Tests 2487 passed | 18 skipped; 41.5 s.
- Log: SCRATCH/search-core-vitest.log
