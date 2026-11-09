# cycles report

## Done
- T1: new leaf core/indexing/chunking/java-family.js (exports normalizePathSlug, JAVA_FAMILY; imports nothing). chunk-builder.js and ast-chunker.js import from it; ast-chunker.js re-exports both. 5-file cycle gone (cycle command).

## Not done and why
- T2: vocab cycle kept. The two wrappers (runFullWarmup, saveBinaryArtifact in vocab-warmer.js:42,47) only forward through `await import()` to the orchestrator, but a product caller outside my set uses them by path: core/indexing/index-codebase-v21.js:471 (`import('../vocabulary/vocab-warmer.js')` then runFullWarmup). Removing them would break the post-index warmup. Other users: tests/vocabulary/vocab-warmer.test.js:135-136, tests/search/review-fixes.test.js:225-274 (import vocab-warmer.js directly); barrel core/vocabulary/index.js:50-51 re-exports them from vocab-warmer.js; mcp/tool-handlers.js:499 uses the barrel (fine). No eval/ or scripts/ users.
- T3: not changed (see below).

## Behavior questions
- The warmer saveBinaryArtifact wrapper drops the 4th `{texts}` argument; the orchestrator version accepts it. Only tests call the wrapper, so pointing at the orchestrator is a strict superset.

## Needs follow-up
- Change core/indexing/index-codebase-v21.js:471 to import runFullWarmup from '../vocabulary/vocab-warmup-orchestrator.js'. Then in vocab-warmer.js delete the two wrappers, `runFullWarmup` in the default export (line ~539), and header comment lines 12-13; in core/vocabulary/index.js export runFullWarmup/saveBinaryArtifact from './vocab-warmup-orchestrator.js' under the old names (keep the *Orchestrator aliases); retarget tests/vocabulary/vocab-warmer.test.js and tests/search/review-fixes.test.js to the orchestrator. I can do the vocabulary/test part once index-codebase-v21.js is changed.
- Other copies of the Java-family set (not changed):
  - core/incremental-indexing/domain/encoder-input.mjs:59 `LI_TEXT_LANGS` = python + java, php, csharp, c#, kotlin, scala: the JAVA_FAMILY members plus 'python' (same policy as indexer-ann.js:55). Same Java members.
  - core/incremental-indexing/domain/encoder-input.mjs:70 copy of normalizePathSlug (same regex semantics per its comment).
  - core/indexing/indexer-ann.js:14,55 imports JAVA_FAMILY from ast-chunker.js (works via the re-export; could import java-family.js).
  - core/incremental-indexing/application/production-reconciler.mjs imports JAVA_FAMILY from ast-chunker.js (per findings; same set).
  - eval/audit_chunk_overflow.js:41 imports both from ast-chunker.js (research; works via re-export).

## T3: search cycle edges (all dynamic; no static edge in the cycle)
- sweet-search.js:1226 `await import('./search-cli.js')` -> runCli. Runs only in the CLI guard (:1224, `import.meta.url === file://argv[1]`), at module load only when run as a script.
- search-cli.js:32 dynamic -> sweet-search.js (default SweetSearch), call time (inside runCli).
- search-cli.js:34 dynamic -> search-server.js (startServer, queryServer, isServerRunning, autoSpawnServer), call time.
- search-server.js:808 dynamic -> sweet-search.js (default SweetSearch), call time (startServer). search-server.js does not import search-cli.
- Cycle closes only via sweet-search.js:1226. Smallest change: move the CLI guard out of sweet-search.js into a separate entry file. That needs package.json "search" script (line 116) to point to it, and package.json is off limits; keeping `node core/search/sweet-search.js <q>` working means the guard must stay. Not changed. core/search/index.js:5 also re-exports runCli from search-cli.js (static, one way, not in the cycle).
- Note: the cycle tool counts dynamic imports; at runtime there is no load-time cycle.

## Verification
- node --check on ast-chunker.js, java-family.js, chunk-builder.js: ok. npx eslint on the same: clean.
- Cycle command: remaining cycles are search (3), vocabulary (2), gepa (2); chunker cycle gone.
- npx vitest run <31 test files importing the chunkers> tests/vocabulary tests/search/review-fixes.test.js: Test Files 31 passed, Tests 873 passed. (tests/search/search-cli*.test.js and tests/indexing/ast-chunker*.test.js match nothing.)
