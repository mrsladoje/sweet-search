# Untangle decision log

Started 2026-11-09. Scope chosen by the owner: untangle + **Comments** + **Tests**.

Working files (session scratchpad, not in the repo): import graph (`graph.json`, `graph-report.txt`),
skeletons (`skel/`), git co-change report (`cochange-report.txt`), per-area survey findings (`findings/*.md`).

## Status

- [x] Step 1: ask which additions to do (Comments, Tests).
- [ ] Step 2: list every problem (11 area surveys running; lead evidence below).
- [ ] Step 3: redesign from first principles.
- [ ] Step 4: fix everything on the list (Tests last).
- [ ] Step 5: check with subagents, repeat until nothing is worth a fix.

## Baseline (before any change)

- `node scripts/check-boundaries.js`: direction rules clean; 70 internal + 614 external barrel-bypass warnings.
- Full `vitest run` (loaded machine): 9,611 tests, 24 failed in 19 files. Rerun of those files alone: 2 real failures
  that exist before any change: `tests/eval/agent-bench-policy.test.js` (the index of `eval/repos/fastify` has schema
  version 2, the code needs 3) and `tests/integration/verify-runtime.test.js` (`probeSqliteBinding` with the full model
  set cached). `tests/integration/boundary-enforcement.test.js` times out because `check-boundaries.js` takes > 120 s.

## Lead evidence (import graph + 6 months of git history, 906 commits)

Size: core 208k lines (search 31k, graph 21k, infrastructure 21.5k, indexing 19k, incremental-indexing 11.7k,
ranking 8.9k; prompt-optimization 38k and training 31k are research code inside `core/`), scripts 39k,
crates 57k, tests 153k.

- `eval/agent-read-workflows/bin/_ss-helpers.mjs` is the file with the highest churn in the product (93 commits).
  It changes together with `core/search/search-server.js` (30), `grep-output-shaping.js` (24),
  `agent-output-fixes.js` (23), `search-read.js` (22), `search-pattern.js` (19). `core/agent-tools/cli.js` and
  `daemon-route.js` import it, and it imports `core/agent-tools/cli.js` back (cycle). Product code lives in `eval/`.
- `core/cli.js` and `core/search/setup-status.js` import `scripts/init.js` / `scripts/uninstall.js`. Product code lives in `scripts/`.
- `core/infrastructure/structural-context-repository.js` changes together with `core/graph/structural-context.js` (21),
  `graph-extractor.js` (15), `relationship-resolver.js` (14), `bare-call-resolution.js` (9), `call-site-scanner.js` (7).
  Graph persistence lives in `infrastructure/`.
- `core/indexing/index-maintainer.mjs` changes together with `core/incremental-indexing/application/*` (13, 9, 9, 8, 7).
  `core/indexing` imports `core/incremental-indexing` 31 times, and the reverse 14 times.
- `core/search/search-server.js` changes together with `crates/sweet-search-cli/src/main.rs` (15) and `agent_tools.rs` (6).
- `core/infrastructure` imports `core/agent-tools` (3 sites): the support layer imports upward.
- `core/query` imports `core/training/query-router` (2 sites): product imports a training folder.
- Import cycles: chunkers (5 files), `search-server.js`/`search-cli.js`/`sweet-search.js`, `_ss-helpers.mjs`/`agent-tools/cli.js`,
  `vocab-warmup-orchestrator.js`/`vocab-warmer.js`, `gepa.mjs`/`gepa-cli.mjs`.
- Files in `core/` that nothing imports: `infrastructure/webgpu-maxsim.js`, `infrastructure/config/indexing.js`.
  Files only tests import: `incremental-indexing/domain/encoder-deps.mjs`, `infrastructure/hcgs-invalidation.mjs`,
  `infrastructure/lockfile.mjs`, `infrastructure/schema-migrations.mjs`, `embedding/model-server.mjs` (verify string-path use).
- Broken imports: `scripts/benchmark.js` (`./hcgs-generator.js`), `scripts/profile-pipeline.js`,
  `scripts/spike-coreml/smoke_bridge.js`, six loose scripts in `crates/wasm-router/*.js`.

## Problems

385 verified problems from 10 area surveys (the indexing survey is the 11th). The full lists, one bullet per
problem with `file:line`, are in `docs/untangle/findings/<area>.md`:

| Area | Problems | High worth |
|---|---|---|
| tool-surface (ss-* tools, CLI, daemon, MCP) | 42 | 11 |
| search-core (ranked search pipeline) | 33 | 5 |
| grep-lane (grep path + Rust mirror) | 37 | 6 |
| ranking-stores (ranking, query, vocabulary, vector-store, embedding) | 45 | 13 |
| infrastructure | 40 | 8 |
| incremental-indexing | 36 | 10 |
| graph | 30 | 8 |
| scripts (+ package.json) | 33 | 4 |
| rust-native | 40 | 14 |
| research-placement | 49 | 13 |

## Scope decisions

- In scope: the product (`core/` except research internals, `mcp/`, `bin/`, shipped `scripts/`, `crates/`) and every
  edge between product and research code.
- Out of scope: the internals of `eval/**`, experiment scripts in `scripts/`, `core/prompt-optimization/**` and
  `core/training/**` (papers still depend on them). Only their broken imports and their imports of moved product
  files are fixed.
- Owner instruction (2026-11-09): the papers are not published; do not delete paper material. Rule: nothing under
  `eval/` is deleted or moved. Research harnesses import product files through string-built paths
  (`${R}/core/vector-store/index.js`) that the import graph does not see. A product file that any file in `eval/`,
  `scripts/`, `core/prompt-optimization/` or `core/training/` names by path (299 files, list in the scratchpad as
  `protected-surface.txt`) keeps its path and the exports research uses. Every removal is checked against that list
  and against a symbol search over research code.
- Experiment switches: a switch that nothing sets (product, eval, scripts, tests, docs) is removed. A switch that an
  eval or replay script still sets stays, and goes on a list for the owner.
- ss-grep output: every change must keep the Rust lane byte-equal. Structural moves only, unless the lane is ported
  in the same commit.
- Ranking: no change may alter scores. A unification that would change which formats a signal applies to is recorded
  as a behavior question, not done silently.

## Fixes (redesign: as if today's requirements were known from the start)

Each fix lists the main problems it solves. The per-area files hold the rest.

### F1. The agent tools are product code with one home, one tool table and an explicit call context
- `eval/agent-read-workflows/bin/_ss-helpers.mjs` (2106 lines, 93 commits) is the only implementation of the six tools.
  `core/agent-tools/cli.js:38` and `daemon-route.js:53` import it; it imports `core/agent-tools` back (cycle).
- The module body is one 1900-line function `runAgentTool` with 48 closures. Nothing in it can be imported alone.
- `core/agent-tools/virtual-process.js` patches `process.env/cwd/exit/stdout` so the tools can run inside the daemon.
  `core/infrastructure/call-fs.js:16`, `cached-json-file.js:33`, `code-graph-repository.js:724` read that patch
  (`currentCall()`), which is why infrastructure imports `core/agent-tools`.
- The tool table is copied in `tools.js:8`, `agent_tools.rs:34`, `ss-grep-core/src/chain.rs:20`, `chain.js:161`,
  package.json `bin`, 12 stubs. The protocol marker and `NODE_ENTRY_COMMANDS` are copied in `tools.js:26`,
  `native-resolver.js:31`, `main.rs:1979`.
- The agent-search result is rendered three times: `_ss-helpers.mjs:1657`, `search-server.js:696`, `mcp/tool-handlers.js:144`.
- Read / trace / read-semantic argument parsing and defaults are written 5 to 6 times (`main.rs:844,1080,1188`,
  `search-read.js:1439`, `search-read-semantic.js:1050`, `search-trace.js:15`, `search-server.js:250,364,457`, MCP zod schemas).
- Grep options are renamed at each of 4 layers (`grepFileOrder` -> `fileOrder`, `_siblingLine` -> `siblingLine`).

### F2. One definition of "agent format" and of the budget tier of each format
- The set `agent | agent_preview | agent_full | agent_full_xl` is spelled out about 14 times: `search-postprocess.js:393,701`,
  `sweet-search.js:50,1006`, `search-hybrid.js:19,196`, `body-lexical.js:29`, `search-boost.js:125`, `search-pattern.js:146`,
  `search-server.js:75`, `file-kind-ranking.js:2101`, `graph-expansion.js:319`, `mcp/server-main.js:219` (misses `agent_full_xl`).
- `_isAgentFormat` is a second flag for the same fact; each caller sets it by its own rule
  (`mcp/tool-handlers.js:140` uses `format === 'agent'`; ss-grep uses `!fixedString`).
- Tier knowledge (budget, related rows, reserve fraction) is spread over 6 if-chains in `context-expander.js:1767,1992,2187,2810,2862`.

### F3. One project identity, one daemon client and one daemon spawner
- Project-root resolution has 7 copies with different rules (`server-identity.js:36,74`, `main.rs:25-90`,
  `config/platform.js:15`, `mcp/server-main.js:60`, `worktree-roots.js`, `agent_tools.rs:96`, `lane/gate.rs:97`).
- `/health` and `/stop` over the unix socket are hand-written 7+ times (`search-server.js:1934,1994,2105`,
  `setup-status.js:63`, `daemon-registry.js:229`, `search-cli.js:106`, `worktree-index.mjs:624`).
- Three spawners start the daemon with different env and entry; only `start-server.js` applies `applyPersistedLiModel()`.
- `init-config.js applyPersistedLiModel` patches a global config object; 8 entry points must remember to call it.

### F4. The full build and the incremental build write the index through the same functions
- Entity / relationship / FTS INSERTs exist twice: `graph-extractor.js:3555` and `production-reconciler-helpers.mjs:22-60`.
- The id recipe `sha256(path:type:name)[0:16]` exists three times: `graph-extractor.js:3111`, `file-nodes.js:41`,
  `production-reconciler.mjs:217`.
- `pickLiInput` exists three times: `encoder-input.mjs:53`, `indexer-ann.js:53`, `production-reconciler.mjs:226`.
- The late-interaction writer settings block (10 fields) is pasted in `li-segment-merge.mjs:270`,
  `production-li-delta.mjs:231`, `maintenance-handlers.mjs:339`; `indexer-ann.js:347` builds it a fourth way.
- The deny-dir list is copied in `path-filter.mjs` and `maintainer-watcher.mjs:56`.
- `core/indexing` imports `core/incremental-indexing` 31 times (hashing, manifest, path-filter) and the reverse 14 times;
  `index-maintainer.mjs` lives in `core/indexing` but changes with `incremental-indexing/application/*`.
- Artifact file names (`code-graph.db` in 32 files, `reconcile-manifest.json` in 14) and manifest fields are used raw.

### F5. The graph domain owns its storage and its predicates
- `core/infrastructure/structural-*.js` (7 files), `file-nodes.js`, `code-graph-repository.js` are graph domain code;
  they change with `core/graph/*` (21, 15, 14, 9, 7 commits).
- The "live row" SQL (`epoch_retired`, `stale_since`) is copied in about 8 files; `code-graph-visibility.js` has the shared form.
- "Is this a test path" has 5 to 6 definitions with different regular expressions.
- `graph-search.js:2099-2354` is a second, older callers/callees engine beside ss-trace.

### F6. Product installers leave `scripts/`, and init and uninstall read one install manifest
- `core/cli.js` and `core/search/setup-status.js:139` import `scripts/init.js` (2642 lines) and `scripts/uninstall.js`.
- What init writes is listed four times (init call sequence, three copies in uninstall, `TRACKED_CREATED_PATHS`, help text).
- `fileState` is identical in three installers; write-then-rename appears 14 times; four "is this file ours" schemes.
- Shipped installers carry benchmark-only v1 constants and migrations (`install-claude-lean-harness.js`).

### F7. The live query router is product code with one model version
- `core/query` imports `core/training/query-router` (features + model file). `manifest.json` and `verify-runtime.js`
  name `v45`; the runtime uses `v46`. The feature extractor exists 4 times; the JS CatBoost router has no product caller.
- The equivalence scripts in `crates/wasm-router/*.js` have broken imports, so no check ties WASM to JS.

### F8. One native addon loader, no guards for old addons
- 8 modules load the same `.node` file, each with its own cache and validate callback.
- `typeof native.x === 'function'` guards for old addons: `binary-hnsw-index.js:64,194,1758`, `hardware-capability.js:191`.
- `native/mem-pressure` is a no-op that nothing loads; `native/bg-priority` has no product caller.

### F9. The search pipeline passes an explicit request context, and the packager is split from its primitives
- `Object.assign(SweetSearch.prototype, ...)` (`sweet-search.js:1186`) mixes in functions from 6 files that read `this.*`.
- Seven per-request caches are threaded through `options` by convention (`sweet-search.js:817`).
- `context-expander.js` (3029 lines) holds 9 jobs; the grep path, the indexer (`worktree-index.mjs`) and
  `code-graph-repository.js` import its primitives.
- `hasAblation` is copied 6 times; 5 stopword lists; identifier splitters repeated; two RRF implementations.

### F10. Tuning values live in one place; a switch exists only if something sets it
- More than 100 env names are read by product code and set by nothing.
- The env-flag parser is hand-written 8 to 10 times with different accepted words.
- `lane/pipeline.rs:1-5` hard-codes the defaults of `readFixFlags` (`agent-output-fixes.js:127-160`) with no link.
- About 45 constants are duplicated between JS and Rust with no parity test.

### F11. Remove code that has no caller
- Files: `core/vector-store/seismic-index.js`, `core/vocabulary/vocabulary-utils.js`, `core/query/query-router-ml.js`,
  `core/search/session-warmup.js`, `mcp/config-gen.js`, `core/infrastructure/webgpu-maxsim.js`,
  `core/infrastructure/config/indexing.js`, `incremental-indexing/infrastructure/lockfile.mjs`, `hcgs-invalidation.mjs`,
  `schema-migrations.mjs`, `domain/encoder-deps.mjs`, `embedding/model-server.mjs` + `model-client.mjs`.
- Exports: `hybridSearch` (legacy), `SmartSearch`, `warmSearch`, `codebaseDb`, `formatGrepResults`, `SEARCH_SERVER_PORT`,
  `ROUTING_CONFIG`, `isJinaAvailable`, `isMistralAvailable`, `getOptimalBatchSize`.
- Old-layout readers and migrations (no production users).
- Each item is verified again with a repo-wide search before removal.

### F12. Research code keeps working and stops leaking into the product
- Broken imports: `scripts/benchmark.js:467`, six scripts in `crates/wasm-router/`.
- Product functions that exist only for benchmarks (`spawn-ledger.js`, `ensureDaemonForProjectRoot`) are listed for the owner.

## Order of work

1. F11 removals (verified dead code) and F12 broken imports. Low risk; makes every later step smaller.
2. Single-source fixes that keep behavior: F2 format set, F10 env-flag parser, F4 copies, F5 predicates, F3 daemon client.
3. Placement moves: F1 tool code into `core/agent-tools`, F5 graph storage into `core/graph`, F6 installers, F7 router artifact, F4 primitives.
4. Deeper redesigns: F1 call context and per-tool modules, F9 request context and packager split, F8 loader.
5. Comments, then Tests, then the subagent recheck loop.

## Done

(one line per landed change, with the commit)

- Batch 1 (F11, F12): removed modules with no caller outside their barrel line and their own tests:
  `vector-store/seismic-index.js` (+ `SEISMIC_CONFIG`, the dead branch in `search-postprocess.js`, the MCP health row),
  `vocabulary/vocabulary-utils.js`, `query/query-router-ml.js`, `search/session-warmup.js`, `indexing/merkle-tracker.js`,
  `indexing/incremental-parser.js`, `indexing/li-skip-policy.js` (test now imports `indexing-file-policy.js`),
  `infrastructure/webgpu-maxsim.js`, `infrastructure/config/indexing.js`. Repaired imports in `scripts/benchmark.js`
  and 8 scripts in `crates/wasm-router/`.
- Kept after a second look: `indexing/legacy-artifact-sweep.js` (added on purpose on 2026-10-22), `mcp/config-gen.js`
  (documented in `docs/search/MCP_INTEGRATION.md`, changed 2026-10-14), `query/query-router-catboost.js` (the
  equivalence scripts in `crates/wasm-router/` use it as the reference for the WASM router).
- Wave 1 (5 packages; reports in `docs/untangle/reports/`):
  - **F1 move**: the six tools are product code in `core/agent-tools/run-agent-tool.mjs` (was
    `eval/agent-read-workflows/bin/_ss-helpers.mjs`) with their parsers in `core/agent-tools/argparse.mjs`. The two
    `eval/` paths stay as bench entries that re-export the product modules (replay scripts and the MaxSim bench import
    them; `node _ss-helpers.mjs <sub>` keeps the bench pins). The cycle `_ss-helpers` <-> `agent-tools/cli.js` and the
    `runTool` parameter that patched it are gone. `// Mirrors:` markers in `crates/` and `fixtures-gen/` point at the new paths.
  - **F2**: `core/infrastructure/agent-format.js` owns `AGENT_FORMATS` / `isAgentFormat`; 14 spelled-out copies use it
    (search, ranking, graph). Sites that test a different set are unchanged (see "Questions for the owner").
  - **F9 (part)**: `core/search/ablations.js` owns `hasAblation` (6 copies removed).
  - **F11**: removed legacy `hybridSearch`, `SmartSearch`, `warmSearch`, `codebaseDb`, the `SMART_SEARCH_*` env aliases,
    `SEARCH_SERVER_PORT` export; `incremental-indexing/infrastructure/lockfile.mjs`, `schema-migrations.mjs`,
    `domain/encoder-deps.mjs` and their tests; the dead HCGS sidecar reader in `graph-search.js`; `export` on 25 names in
    `core/graph` that nothing imports.
  - **F5 (part)**: `liveEntitySql` / `liveRelationshipSql` in `code-graph-visibility.js` replace 11 identical copies of the
    live-row SQL. `logicalEntityId` in `file-nodes.js` owns the id recipe; `fileNodeId` and `GraphExtractor.makeId` call it.
  - **F6 (part)**: `scripts/install-fs.js` owns `fileState`, `writeAtomic`, `writeViaTmp`, `detectProjectRoot`,
    `OWNERSHIP_SENTINEL`. `core/infrastructure/postinstall-check.js` owns `detectSkippedPostinstall` and
    `INSTALL_NODE_FILE`, so `core/search/setup-status.js` no longer imports `scripts/init.js`.
- Not dead after proof: `formatGrepResults` (called in `search-format.js`), `hcgs-invalidation.mjs` (live code reads its
  table), `tombstone-injector.mjs` (a research script imports it), `sectionItemLimit` / `impactPathLimit` / `itemCodeCap`
  (an eval script imports them).

## Constraints found while fixing

- `eval/maxsim-bench/rerun/pipeline-hook.mjs:52` wraps `SweetSearch.prototype` methods by name (`hybridSearchV2`,
  `semanticSearch`, `semanticSearch3Stage`, `lexicalSearch`, `_applyPostRetrieval`, ...) and
  `LateInteractionIndex.prototype.scoreWithLateInteraction`. F9 "replace the prototype mixin" must keep these as prototype
  methods with these names until the MaxSim paper is out.
- `crates/ss-grep-core/fixtures-gen/args.mjs` cuts functions out of the SOURCE TEXT of `run-agent-tool.mjs`. A split of
  that file per tool must update the fixture generator in the same commit.

## Questions for the owner (behavior; not changed)

- `mcp/tool-handlers.js:140` sets `_isAgentFormat` only when `format === 'agent'`. The daemon sets it for all four agent
  formats (`search-server.js:1211`). MCP calls with `agent_full` / `agent_preview` therefore skip the gates in
  `search-format.js:44` and `context-expander.js` that read the flag.
- Single-format gates: `search-hybrid.js:~170` (anchor injection, `allowPlainTitlecase`), `search-semantic.js`
  `fullVectorStageWanted` (`format !== 'agent'`), `sweet-search.js:~845`.
- `init` writes a `.gitignore` line and (with `--codex-enable-global-hooks`) a flag in `~/.codex/config.toml`;
  `uninstall` removes neither. The uninstall dry-run plan does not list the pruning of empty directories.
- The HCGS summary sidecar (`hcgs_summary_metadata`) is created only by a module that tests import. `graph-gc.mjs`
  (`pruneRetiredGraphSummaries`), `maintenance-state-reader.mjs` and `CodeGraphReaderVisibility.hasSummarySidecar` read it.
  Remove the sidecar completely, or wire it up?
- Env overrides that nothing sets (table in `docs/untangle/reports/incremental-dead.md`).
- v1 harness constants and migrations in `scripts/install-claude-lean-harness.js`, the CoreML build path in `init.js:2477`,
  the `codex_hooks` migration (users listed in `docs/untangle/reports/installers.md`).

## Done: wave 2 (reports in `docs/untangle/reports/`)

- **No import cycle is left in product code.** Chunkers: `core/indexing/chunking/java-family.js` is the leaf for
  `JAVA_FAMILY` / `normalizePathSlug`. Vocabulary: the two pass-through wrappers in `vocab-warmer.js` are gone.
  Search: `sweet-search.js` no longer starts its own CLI (`npm run search` runs `core/cli.js`).
- **F4 (in place)**: `core/indexing/chunk-embed-text.js` owns `chunkIdOf`, `chunkFilePath`, `embedTextCap`, `embedTextOf`
  and `pickLiInput` for the full build, the streaming build and the incremental build (3 copies of `pickLiInput`,
  4 parsers of `SWEET_SEARCH_EMBED_TEXT_CAP`, 3 copies of `chunkFilePath`). `pickLiInputText` (the LI input hash)
  calls `pickLiInput`, so the hash and the encoder read the same text. `logicalEntityId` replaces
  `graphEntityLogicalId`. `liWriterSettings` owns the 9 LI writer fields (3 pasted copies).
- **F3 (part)**: `core/search/daemon-client.js` `daemonRequest` replaces 7 hand-written `/health` / `/stop` requests.
- **F10 (part)**: `core/infrastructure/env-flag.js` (`isOffValue`, `isOnValue`) replaces 6 copies.
  `core/infrastructure/agent-tools-protocol.js` owns the protocol marker (was a second literal in `native-resolver.js`).
- **F11**: removed the config aggregate default export, `ROUTING_CONFIG`, `isMistralAvailable`, `isJinaAvailable`,
  `getOptimalBatchSize`, `DB_PATHS.summaries`, `saveArtifacts`, `updateArtifacts`, the `deprecatedInt8Db` check.
- **Boundary check**: `scripts/check-boundaries.js` runs in 0.5 s (was 201 s; its test timed out and never ran).
  It knows `agent-tools` and `incremental-indexing` (12 domains). An old bug let one exception exempt every forbidden
  import under its `from` folder; the precise match exposed 4 hidden violations, now declared with a max:
  `indexing -> search` (3: `rss-budget.mjs:56`, `worktree-index.mjs:57,62`) and `prompt-optimization -> indexing` (1).
  The mutual dependency `indexing <-> incremental-indexing` is capped at today's 30 / 16 import sites.
- Tests removed because they asserted comment text: two in `tests/integration/brand-presence.test.js` (the header of
  `sweet-search.js` had to say "Sweet Search v2.3" and name `/tmp/sweet-search.sock`, a path the daemon no longer uses).

## Parity differences found (not changed: each one changes index content)

- Incremental fallback embedding text (`production-reconciler.mjs`) has no symbol, no space separator and no
  1500-character cut, and does not apply the embedding-text cap to `embedding_text`. The full build does.
- `enrichChunksFromGraph` differs between `indexer-build.js` and `production-reconciler.mjs`: epoch filters, file-node id
  mapping, file-path source, error handling, caching.
- Graph INSERT sets differ (`graph-extractor.js insertGraph` vs `production-reconciler-helpers.mjs`): `OR REPLACE` vs plain
  INSERT, extra epoch and logical-id columns, id remap, FTS rebuild vs per-row inserts. Shared columns match.
- `denseInputHash` hashes `embedding_text || text || content`; the dense encoder reads `embedTextOf(chunk, cap)`.
- Deny-dir lists differ on purpose (`path-filter.mjs` has `vendor` and `coverage`; `maintainer-watcher.mjs` omits them).
- Entity "live" filters that skip `stale_since` (list in `reports/graph-predicates.md`).

## More questions for the owner

- `autoSpawnServer` (`search-server.js`) starts the daemon through `cli.js --serve` and is the only start path that
  does not run `applyPersistedLiModel()` before the server module loads.
- `core/infrastructure/manifest.json` and `scripts/generate-asset-manifest.js` name `v45_router_d4.js`; the JS CatBoost
  router imports `v46_router_d4.js`. The `verify-runtime` deep check tests a file that nothing loads.
- `SWEET_SEARCH_READ_VIA_DAEMON` / `_SEMANTIC_VIA_DAEMON` / `_TRACE_VIA_DAEMON`: users listed in `reports/daemon-client.md`.
- A full test run leaves a maintainer and an encoder that run on this repository itself (working directory = repo root).
  A test starts a real daemon for the repo root. Find it and make it use a temp project.

## Done: wave 3

- **Pure-move splits** (checked with a parser: every top-level declaration has the same source text in exactly one
  new file; all export names stay at the old path):
  - `core/search/context-expander.js` 3029 -> 683 lines (keeps `packageForAgent`); 8 modules in `core/search/packaging/`:
    span-expansion, staleness, header-context, sufficiency, graph-neighbors, related-rows, budget, same-file-map.
  - `core/ranking/file-kind-ranking.js` 2661 -> 669 lines (keeps `applyResultDemotions`, `applyFileKindRanking`);
    7 modules in `core/ranking/file-kind/`: result-fields, env-tuning, query-analysis, file-kind-detect, entity-kind,
    symbol-boosts, chunk-signals.
- `AGENT_TOOL_SUBCOMMANDS` (tools.js) replaces the copy `CHAIN_BOUNDARY_TOOLS`; the usage line of `agent-tools/cli.js`
  is built from `AGENT_TOOLS`.
- **Test hermeticity**: `tests/integration/mcp-server.test.js` started MCP servers on the repository root (it left a
  maintainer and an encoder that ran on this repository); `tests/init/harness-prompts.test.js` loaded the opencode
  plugin with the system temp folder as worktree, which ran the real `sweet-search-hook` and left a daemon. Both now
  use a temp fixture project. A full run leaves no process.

## Done: Comments step (JavaScript product code)

- Scope: `core/` (except `vector-store/`, the MaxSim and distance kernels, `prompt-optimization/`, `training/`) and `mcp/`:
  222 files. Not done: `scripts/`, Rust (`crates/`), because no token checker exists for Rust here.
- Rule: a comment stays only if it changes for a reason of its own (outside fact, measured result, reason for a value,
  contract between files or languages, crash-safety / concurrency reasoning, anything a tool reads).
- Result: 5,026 lines removed net. Proof per file: the token stream without comments is equal to the previous commit
  (`verify-comments.mjs`: 222 files, 0 problems). The check caught two real slips (help-text strings edited as if they
  were comments) before they landed.
- Second review: 342 removed blocks that contained a reason marker were read again by separate reviewers against the
  original file; 48 came back fully or in part (V8 string limit notes, validation evidence, WAL durability, rollback after
  a failed swap, GPU batch sizes, scoring formulas of the vocabulary miner, the per-language syntax notes of the import scanner).
- About 30 false comments were corrected (names of files, functions and documents that do not exist; a "DEFAULT: TRUE" on
  a default that is false; `v45` where the import is `v46`; "runs sequentially" on code that runs in parallel).
- Doc blocks that sat above the wrong function were moved to their function.
- Found in code, not changed: `indexer-ann.js` logs "3-stage retrieval will fall back to float HNSW" (float HNSW is gone).

## Test time

- Full suite on a quiet machine: 60 s and 62 s wall in two runs (9,464 tests). Before: one test
  (`boundary-enforcement`) spawned a 201 s script and starved the others.

## Done: Tests step

- Scope: 475 test files (all of `tests/` except `tests/unit/prompt-optimization/`, `tests/training/`). 53 files changed.
  Rule: a test stays if a real regression makes it fail, and nothing else does. When unsure, the test stays.
- Result: 9,428 tests, 0 failures in two full runs on a quiet machine (51 s and 61 s wall). A full run leaves no process.
- The two failures that existed before the refactor are repaired:
  - `tests/eval/agent-bench-policy.test.js` skips, with the reason in its name, when the frozen local benchmark index is
    absent or has another schema version.
  - `tests/integration/verify-runtime.test.js` builds its own model cache in a temp dir (it read this machine's cache)
    and checks that a file one byte short fails.
- Tests that acted on real state, now isolated: `incremental-tracker.test.js` (cleared and wrote this repository's
  `.sweet-search/merkle-state.json` and file-state db on every run), `native-launcher.integration.test.js` (sent `/stop`
  to the default socket), `boundary-enforcement.test.js` (wrote violation files into the live `core/` tree),
  `search-pattern.test.js` (grepped the repository root).
- Removed about 30 tests that could not fail or tested copies of the code (typeof-only checks, tests that swallowed
  their own error, empty placeholders, a file that tested functions defined inside the test). Rewritten to behavior:
  source-text tests of `run-agent-tool.mjs` (`semantic-also`, `cwd-paths`, `agent-output-fixes-wiring`), `llm-provider`,
  `db-utils` pragmas, `coreml-provider`, `query-router-3class`.
- Silent `return` skips became visible skips with the condition in the test name.
- `tests/setup/reap-test-fixtures.js` now reaps only orphaned fixtures and fixtures of its own run. Two vitest runs in
  one checkout no longer kill each other's fixtures (two agents hit this during the step).
- Kept on purpose: native-vs-JS parity tests, ss-grep byte-contract tests, installer byte-contract tests,
  `barrel-contracts.test.js`, policy tests over many files, `tests/embedding/embedding-perf.test.js` (opt-in benchmark).
- `npm run test:changed` (`vitest run --changed`) for the edit loop.

## Product seams that tests ask for (not done)

1. `atomicSwapDatabase`: option for the retry delay (fixed 500 ms).
2. Indexer phase runner: injectable `buildLateInteractionIndex` (`indexer-phases-wiring.test.js` reads source text).
3. `maintainer-watcher.mjs`: injectable git poll interval (fixed 2,000 ms).
4. `patternSearch`: take the sparse-gram index from the searcher (two tests read this repository's own index).
5. An in-process `init` entry (three `tests/init` files start 20 to 40 `node core/cli.js` processes each).
6. A way to wake a sleeping maintainer; an override for `WEDGED_KILL_GRACE_MS` (5 s).
7. `model-fetcher`: option for `RETRY_BASE_MS`.
8. `autoSpawnServer`: the fixed 5 s readiness wait and `SPAWN_CLAIM_TTL_MS`.
- Product observation: `TimeWindowRateLimiter.acquire` (`core/embedding/embedding-remote.js`) polls every 1 ms while a
  rate window is full.

## Done: unused code

- `export` removed from 150 names that no file in the repository mentions (tests and research included).
- 125 unused identifiers removed from 58 product files: about 66 import names, 17 functions, 9 module constants,
  36 locals (list in `docs/untangle/reports/unused.md`). Calls with an effect were kept; only the unused binding went.
- `eslint.config.mjs` now has `no-unused-vars` as an error for product files, so the state holds.

## Recheck (step 5): findings in `docs/untangle/findings/recheck-*.md`

Four fresh read-only agents read the code again with this log and the constraints. 48 items remain (14 indexing,
9 tools and search, 11 graph and infrastructure, 14 ranking and installers), most of them small copies.

## Done: wave 4 (from the recheck; reports `docs/untangle/reports/w4-*.md`)

- **Daemon client split**: `core/search/search-client.js` (437 lines) holds the functions that talk to a running daemon;
  `search-server.js` (2,122 -> 1,715 lines) re-exports them. The client never imports the server. One declaration
  changed: the server now calls `setInProcessSearch(...)` where it assigned a variable that the client functions read.
- `tests/agent-tools/mirror-markers.test.js` checks that every `// Mirrors: <file>:<function>` marker in the Rust lane
  names a JS file and function that exist.
- `core/search/stage-timing.js` owns the profiling hooks (3 copies removed). Six files import `isTestLikePath` from its owner.
- **One install list**: `scripts/install-artifacts.js` (`PROJECT_ARTIFACTS`, 11 entries) is read by the uninstall plan,
  the uninstall run and the created-paths record; `uninstall.js` no longer imports `init.js`. `scripts/hook-entries.js`
  owns the hook strings and the "is ours" check (8 copies). `tests/init/uninstall-order.test.js` pins both print orders
  (it passed on the old code first).
- **Indexing**: `state-files.mjs` owns the state-file names (11 files), `readReconcilePause` (3 readers -> 1),
  `liveVectorSql` (3 -> 1), `json-file.mjs` (5 files), the watcher's deny list is built from `path-filter.mjs`,
  `DOC_EXTENSIONS` has one owner, `PIPELINE_VERSION` / `STATE_VERSION` live in `index-format-versions.js`.
- **Graph / infrastructure**: `isTestPath` (3 identical copies -> 1), shared `placeholders` / `clampLimit` /
  `escapeRegExp`, a `guarded` helper for 11 pasted try/catch blocks in `native-sparse-gram.js`, `makeId` without the
  options no caller passed.
- **Order dependence removed**: `core/infrastructure/config/load-env.js` loads `.env`; `platform.js`, `ranking.js`,
  `embedding.js`, `translation.js` import it first. Before, `ranking.js` and `translation.js` could read API keys
  before the file was loaded when `native-inference.js` or `init-config.js` reached them first.
- `QualityScorer` takes `repoMap` as a constructor option (the module-level setter still works; its removal needs one
  edit in `core/search/sweet-search.js`).
- Not shared, because the copies differ: the six state-dir resolvers (table in `reports/w4-indexing.md`).
- Checked: `hashing.mjs` never uses its "native crate" backend (no Rust export `xxhash3_64` exists), so every setup
  hashes with `@node-rs/xxhash` and the values agree.

## Done: wave 5 (cross-folder follow-ups; report `docs/untangle/reports/w5-followups.md`)

- `core/infrastructure/state-files.mjs` owns the names of the index state files for the full build, the incremental
  build and search (it was in `incremental-indexing`, where the full build and search could not import it).
- `core/infrastructure/stage-timing.js` owns the profiling hooks; `graph-expansion.js` uses it too.
  `file-kind-ranking.js` keeps its own per-rule timing (it is not a copy).
- `core/infrastructure/pid-alive.js` replaces 11 identical copies of the liveness probe. Four copies differ and stay
  (table in the report).
- `isEmbedForcedToCpu` (env-flag.js) replaces 5 identical checks. `VIEW_EXT` is built from `view-templates.js`.
- The tombstone bitmap writer and the sparse-gram delta writer import the layout from their readers.
- `hashing.mjs`: the dead "native crate" backend is gone; hash values for six sample inputs are equal before and after.
- `setRepoMapModule` is gone; `search-postprocess.js` passes `repoMap` to `QualityScorer`.
- `LI_SEGMENT_SIZE` has one definition (exported from `late-interaction-index.js`).

## State at the end of this session (2026-11-10)

- 11 commits, local on `main`, not pushed. Full suite: 9,436 tests, 0 failures, 51 to 61 s wall. Lint (with
  `no-unused-vars`) and the boundary check (12 domains) are clean. The only import cycle left is in research code.
- Measures: product import cycles 4 -> 0; cross-area edges out of `core/infrastructure` 3 -> 0; unused identifiers
  125 -> 0 (enforced); test failures 2 -> 0; full-suite time about 10 min -> about 1 min; comment lines -5,026.

## Open: larger items (not started; each needs a decision or a dedicated session)

1. Done 2026-11-10 (section "Done: open item 1" below). It was: `core/agent-tools/run-agent-tool.mjs` is one function
   of about 1,870 lines with 48 closures.
2. `startServer` in `search-server.js` is one function of about 950 lines with the routes inline.
3. Experiment switches (`SS_FIX_*`, `SS_VARIANT_*`, `SS_SMOKE_*`, A3 / B7 paths) and about 20 ranking tuning variables
   that nothing in the repository sets: remove or keep? (owner is still tuning)
4. Three renderers of the agent-search result (ss-search, daemon, MCP) with different output bytes; two parallel
   implementations of read / trace / read-semantic (`sweet-search read|trace` vs `ss-read|ss-trace`).
5. Three daemon spawners; `autoSpawnServer` skips `applyPersistedLiModel()`.
6. `SweetSearch` prototype mixin and the seven per-request caches passed as options (blocked until the MaxSim paper is
   out: its hook wraps the prototype methods by name).
7. Folder moves blocked by research references: graph storage out of `core/infrastructure`, `index-maintainer.mjs` to
   the incremental build.
8. Parity differences between the full build and the incremental build (section above).
9. Rust: comments pass and the JS/Rust constant parity test (about 45 constants) are not done.
10. Product seams that tests ask for (section above); `scripts/` experiment files and research helpers (out of scope).

## Done: open item 1, one module per ss-* tool (2026-11-10)

- **Shape.** `core/agent-tools/run-agent-tool.mjs` (2,008 -> 125 lines) keeps `runAgentTool`: it resolves the two roots,
  builds the call context once and dispatches through a table built from `AGENT_TOOLS`. The six tools are
  `core/agent-tools/commands/grep.mjs` (567 lines), `find.mjs` (159), `read.mjs` (249), `semantic.mjs` (138),
  `trace.mjs` (154) and `agent-search.mjs` (249); each exports one function `cmd<Tool>(ctx, args)`. `shared.mjs` (418)
  holds 32 functions: the helpers that two or more tools use, and what those call. `context.mjs` (66) builds the
  call context. The bench entry
  `eval/agent-read-workflows/bin/_ss-helpers.mjs` is unchanged and still re-exports `runAgentTool`.
- **Call context** (`createCallContext`), decided from what the 48 functions read: `projectRoot`, `fileRoot`, `host`,
  `sessionId`, `exactRereadOmission`, `shownSpanTrailer`, `spanPolicyEnabled`, `fix`, `a3SessionId`, `alreadyShownOn`,
  `dedupe`, and the two variables of the lazy index coverage. 28 functions take `ctx` as their first parameter; the
  other 20 (the usage-failure helpers among them) read no per-call variable and stay plain functions. The context has no
  environment, working directory or output stream: the commands still use `process.*` inside the virtual process.
- **Only moves.** A script generated the modules from the committed file. A second script, with a parser, shows that all
  62 declarations (48 functions, 14 constants) are in exactly one new module and that the text of each is equal to the
  committed text after the `ctx` edits are undone; that a call passes `ctx` if and only if its callee takes it; and that
  no such function is used as a value. No experiment switch (`SS_FIX_*`, `SS_VARIANT_*`, `SS_SMOKE_*`, A3, B7) changed.
- **Readers of the source text.** `crates/ss-grep-core/fixtures-gen/args.mjs` cuts its functions from `shared.mjs` and
  `grep.mjs` and gives the cut code a `ctx` with the file root. Proof: with the 13 corpus repositories switched off (the
  corpus is not on this machine), the old and the new generator both write `synthetic.json` and `pure.json` (3,256
  cases) with the committed bytes. No fixture was regenerated. `// Mirrors:` markers and comments in `crates/` point at
  `commands/grep.mjs` (comment-only edits; the `description` line of `crates/ss-grep-core/Cargo.toml` too).
- **Proof of equal output** on a temp fixture project (16 files, indexed; daemon with a private runtime dir, no
  maintainer), before and after:
  - 1,892 calls: 445 cases of all six tools (flags, globs, scopes, zero hits, usage errors, 40 settings of 32 switches,
    ledger and A3 sequences), each with and without the chained-call boundary, through the daemon route (890) and in process
    (894), plus 108 fresh `cli.js` processes. Every exit code is equal. stdout is equal byte for byte in 1,869 calls;
    in the other 23 the only difference is a clock field (`latencyMs`, `routerLatency_us`, `latency=Nms`). stderr
    differs only in clock fields, load durations and the stack frames of one crash case. Two captures of the old code
    differ from each other in the same fields.
  - Lane shadow check (`SS_LANE_SHADOW_LOG`): 354 JS-answered ss-grep calls of the matrix, 134 answered by the lane
    with the same bytes, 0 different, 220 declined (switches, zero hits, usage errors). Through the native client
    (`bin/ss-grep`): 101 calls with `SWEET_SEARCH_GREP_LANE=0` and with the lane on, 101 equal.
  - Full suite, lint and the boundary check are clean.
- **Not merged (out of scope): four copies of the warm-or-fallback fetch.** `grep.mjs` `fetchMode` (-l / -c / -o),
  `fetchScoped` (file scopes), `fetchUnscoped` (listing), and `find.mjs` (pattern search, with the ss-grep fallback when
  there is no late-interaction index). Each tries `queryWarmSearch` and, on any error, runs the same engine method in
  process (`getSweetSearch`). Proposed single owner: one function in `commands/shared.mjs` that takes the engine method
  and one option set. The copies are not equal today: the warm request adds `mode`, `expand: false`, `rerank: false`
  and `useLateInteraction: false`, and `fetchMode` sends `mode: 'grep'` on both paths. A merge must keep these or show
  that they have no effect. `semantic.mjs` has a fifth block of the same shape for `readSemantic`.
- **Found, not changed.**
  - `ss-grep -l` and `-c` ask the daemon for `maxFiles: 100000` (`GREP_FILE_MODE_MAX_FILES`); `/search` rejected a value
    above 1,000 (`readGrepShapingParams`). The warm request always failed and the `catch` of `fetchMode` ran. Inside the
    daemon the fallback is the daemon's own searcher, so nothing was lost. In a fresh process (`cli.js`, the path behind
    the native client) each such call loaded a cold engine: 2 to 8 s on this machine. Fixed in the next commit (section
    below).
  - The index paths of the engine are module-level (`DB_PATHS`). One process can serve only the project it started for:
    a capture process started in this repository opened this repository's code graph for `ss-trace` and for the cold
    grep fallback, although every call named the fixture as its root. The daemon and `cli.js` are not affected (one
    project per process). The per-call context does not remove this limit; the replacement of `process.*` must.

## Done: ss-grep -l / -c get a warm answer in a fresh process (2026-11-10)

- `GREP_FILE_MODE_MAX_FILES` (100,000) has one JS owner, `core/search/grep-output-shaping.js`. `commands/grep.mjs` sends
  it and `readGrepShapingParams` accepts `maxFiles` up to it (was 1,000, older than the -l / -c modes of 2026-10-20).
  The lane keeps its own copy (`lane/pipeline.rs`). `perFileCap` and `outsideProbe` keep their bound of 1,000.
- No output byte changed: the same 1,892 calls, split code against fixed code, have equal exit codes and equal stdout.
  stderr differs in 34 calls of the in-process and `cli.js` captures, all `-l` / `-c`: the load banners of the cold engine
  are gone (32 calls), or the engine loads once and not twice (2 calls, a regex that does not parse). Shadow log: 134 answered by the lane with the
  same bytes, 0 different; 26 of them are `-l` / `-c` / `-o` calls, whose JS answer now comes through `/search`.
- `tests/agent-tools/ss-grep-file-modes-warm.test.js` runs `-l` and `-c` against a fake daemon that checks the request
  with the real parser; a cold engine fails the call. It fails with the old bound.
- Still cold in a fresh process: a regex that the engine cannot parse. The daemon answers with an error, the `catch`
  runs the engine in process, and the regex repair reads the parse error of that engine.
