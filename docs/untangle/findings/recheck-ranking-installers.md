# Recheck: ranking / query / vocabulary / embedding + installers / package wiring

Read the decision log first. Everything below was re-verified against the tree as it is now (HEAD 04729cdd + working tree).
Part 1 (core) is in good shape after the splits and the comment pass; the real remaining links are in part 2.

## Items (most valuable first)

- [H] [worth:high] scripts/init.js:386-415, scripts/init.js:2112-2443, scripts/uninstall.js:22,554-600,641-760 — "What init writes" is stated four times
  (the `runInit` call sequence, `TRACKED_CREATED_PATHS`, the 11 `removeX({dryRun:true})` lines in `planProjectUninstall`, the 11 `report(removeX())` blocks in
  `executeProjectUninstall`) and the two uninstall lists even have different orders (plan: prewarm, skill, agent files, rules, style, lean, enforcement, codex hook, codex harness,
  opencode, mcp; execute: skill, prewarm, codex hook, codex harness, opencode, agent files, rules, style, lean, enforcement, mcp). `uninstall.js` imports the 2.6k-line `init.js`
  only for `PREWARM_HOOK_COMMAND` and `readCreatedPaths`; the three removers for init-written artifacts (`removeSweetIndexSkill`, `removePrewarmSessionStartHook`,
  `removeCodexSessionStartHook`) live in uninstall.js while their writers live in init.js.
  FIX: see "The one list" below. New `scripts/install-artifacts.js` owns the list, `TRACKED_CREATED_PATHS`, `snapshot/read/recordCreatedPaths`, `PREWARM_HOOK_COMMAND`;
  the three removers move beside their writers (init.js re-exports and uninstall.js re-exports every moved name: tests import them from there).
  RISK: output order. Keep two numeric ranks per entry (`planRank`, `runRank`) so dry-run lines and the "Removed:" lines print in today's order; check with
  `tests/init/uninstall*.test.js` + `tests/init/lifecycle.test.js` + a byte diff of `sweet-search uninstall --dry-run` on a repo after `init --claude --codex --opencode --mcp --agents --cursor`. SIZE: M.

- [H] [worth:high] scripts/init.js:1197-1243,1303-1306,1360-1371; scripts/uninstall.js:342-346,419-421; scripts/install-claude-lean-harness.js:266; scripts/install-tool-enforcement.js:135,145,180 —
  "this hook group is ours" is written 8 times (`group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(X))`), and `registerPrewarmSessionStartHook` /
  `registerCodexSessionStartHook` are the same function (read JSON, find owned group, replace or push, write) for two files; the hook command strings and their flags
  (`sweet-search-hook --agent-session-hook|--agent-session-drop|--read-hint|--session-title`) are spelled in init.js:1181-1182,1243,1297, install-tool-enforcement.js:27,
  install-claude-lean-harness.js:264 and read back by `scripts/hooks/hook.mjs:18-20` and `core/search/session-daemon-prewarm.mjs:56-58`. A new hook needs 4 coordinated edits.
  FIX: one `scripts/hook-entries.js`: `HOOK_BIN`, `HOOK_FLAGS`, `hasOwnedHook(group, marker)`, `upsertOwnedGroup(groups, entry, marker)`, `removeOwnedGroups(groups, marker)`. The 8 sites and both register
  functions call it (the SessionEnd match keeps its extra `--agent-session-drop` condition via the `marker` argument). Add to package.json `files` (packaging test names it).
  RISK: written bytes of `.claude/settings.json` / `.codex/hooks.json` (same JSON, same order). Check `tests/init/prewarm-hook.test.js`, `codex-hook.test.js`, `tool-enforcement*.test.js`. SIZE: M.

- [X] [worth:high] core/ranking/file-kind/env-tuning.js:1-41 and its 20 call sites in core/ranking/file-kind/{entity-kind,chunk-signals,symbol-boosts}.js — 20 tuning env vars are read in hot loops and are set by nothing
  (grep over the whole repo incl. eval, scripts, tests, docs, shell, python): `SWEET_SEARCH_BODY_DENSITY, DECLARATIVE_FACTOR, KIND_BOOST, KIND_DEMOTE, MEGA_CHUNK_{CUTOFF,FLOOR,SLOPE}, NAME_EXACT_BOOST,
  NAME_SUBSTR_BOOST, NO_ANOMALOUS_CHUNK_DEMOTION, PATH_TOKEN_BOOST, RAWSTRING_{FACTOR,THRESHOLD}, REF_BOOST_{ALPHA,CAP,LARGE_LINES}, STUB_{FACTOR,MAX_LINES}, SYMBOL_EXACT_BOOST`,
  and `SWEET_SEARCH_FORCE_BM25F_BOOSTS` (file-kind-ranking.js:124, graph/graph-expansion.js:285; named only in docs/untangle). The decision log rule: "a switch that nothing sets is removed".
  Still set, so KEEP: `FILE_KIND_RANKING/FACTOR/WINDOW` (tests/ranking/file-kind-ranking.test.js), `IDENTIFIER_MENTION_BOOST` (core/prompt-optimization/scripts/ss-search/stage5-boost-sweep.mjs), `MAX_ENVELOPE_LINES`.
  FIX: replace each `envFloat(NAME, d)` by the constant `d` (named const per rule file); delete `envFloatRange`, keep `envFactor/envWindow/envOff` for the three kept names; delete FORCE_BM25F and use `isAgentFormat(opts.format)` from core/infrastructure/agent-format.js in file-kind-ranking.js:123 and graph-expansion.js:284.
  RISK: only a user who exports one of these names; scores unchanged otherwise. Check: tests/ranking/*, GCSN dev run unchanged to 4 decimals. SIZE: S-M.

- [S] [worth:med] scripts/uninstall.js:455-486 — `getOptionalNativePackageNames` has no caller except `tests/init/uninstall-native-packages.test.js` (its header cites a `--purge` flag that does not exist);
  `removePackage` (uninstall.js:828) runs plain `npm uninstall`. The function also carries a hand-copied fallback list of the 7 `optionalDependencies` of package.json.
  FIX: delete the function and the test. RISK: none at runtime. SIZE: S.

- [H] [worth:med] scripts/uninstall.js:220,228; core/indexing/maintainer-launcher.mjs:42,179; core/incremental-indexing/application/operator-cli.mjs:23,134; core/indexing/worktree-index.mjs:79,120,560,743;
  core/indexing/index-maintainer.mjs:345; core/indexing/rss-budget.mjs:326; core/search/{daemon-registry.js:148,session-daemon-prewarm.mjs:170}; core/indexing/index-device-choice.js:254;
  core/incremental-indexing/infrastructure/maintenance-state-reader.mjs:292 — `pidAlive` exists 9 times (differences: `isInteger` vs `isFinite` vs `Number()` coercion; all treat EPERM as alive) and the
  maintainer lock file name `'index-maintainer.lock'` is spelled in 6 core files plus `uninstall.js`, although `maintainer-launcher.mjs:42` already exports `MAINTAINER_LOCK_FILENAME`.
  `uninstall.js stopRunningMaintainer` re-implements "stop the maintainer".
  FIX: `core/infrastructure/process-alive.js` (`pidAlive(pid)` = the coercing `Number(pid)` + `isInteger` form of daemon-registry.js:148) and import `MAINTAINER_LOCK_FILENAME` from maintainer-launcher. All 9 copies and uninstall.js use them.
  RISK: a string pid ("123") is alive in 2 copies, not in 3; maintainer lock pids are JSON numbers, so no change. Check `tests/incremental-indexing/*`, `tests/init/uninstall*.test.js`. SIZE: S.

- [H] [worth:med] core/ranking/quality-scorer.js:300-315 and core/search/sweet-search.js:194 — `setRepoMapModule({pageRank, loadGraph, buildAdjacency})` is a module-global setter that `sweet-search.js` must call before any `QualityScorer` runs;
  `scoreCentrality` throws "call setRepoMapModule first" otherwise. The stated reason ("avoid a circular ESM import with repo-map") is false today: `core/graph/repo-map.js` imports only infrastructure.
  FIX: `check-boundaries.js:44` forbids `ranking -> graph`, so do not import repo-map in quality-scorer.js. Pass the three functions as a `QualityScorer` constructor option (`repoMap`), supplied at the single `new QualityScorer` in search-postprocess.js:724 (which already runs in the search layer that imports repo-map). Delete the setter, `require_repo_map`, the call in sweet-search.js:194 and the export in ranking/index.js:15; the test (tests/ranking/quality-scorer.test.js:404) passes the mock as the option. Then the call-order rule is gone.
  RISK: none for scores. SIZE: S.

- [S] [worth:med] core/embedding/model-server.mjs (216 lines), core/embedding/model-client.mjs (250), core/embedding/embedding-service.js:40-50,325-360 — a shared model server that no product code starts
  (`startModelServer` runs only when the file is executed directly; only `tests/embedding/shared-model-dispatch-shim.test.js` sets `SWEET_SEARCH_SHARED_MODEL_SERVER`). F11 of the log lists it for removal; it was neither removed nor put on a question list.
  Not in protected-surface.txt. FIX: delete both files, the gate and lazy import in embedding-service.js, the test. RISK: none for the CLI/daemon; if the owner plans the shared server for the box, keep. SIZE: S. (Owner call: see Behavior questions 4.)

- [S] [worth:med] package.json `files` line "scripts/benchmark-harness.js" — a benchmark script is shipped in the npm tarball; nothing imports it, and its `PROJECT_ROOT = path.resolve(__dirname, '../../..')` points above the repo (it was moved from a deeper folder), so it cannot run from the package.
  FIX: remove the line from `files` (the script itself stays: experiment script). `scripts/smoke-test.js` stays (release.yml runs it). RISK: tarball content only; run `tests/integration/packaging.test.js`. SIZE: S.

- [H] [worth:med] .github/workflows/release.yml:62,130,183,236,277 (`toolchain: 1.97.1` five times) vs publish-native-linux-x64-gnu-cuda.yml:116 and -arm64-gnu-cuda.yml:98 (`--default-toolchain stable`) — the Rust version is pinned five times in one file and not at all in the two CUDA publishers, so the CUDA addons are built with a different compiler than the CPU addons.
  FIX: add `rust-toolchain.toml` (channel 1.97.1) at the repo root, drop the five `toolchain:` lines (dtolnay action reads it) and make the CUDA `rustup` step install `1.97.1` from the same file. RISK: CUDA build compiler version changes (see Behavior questions 3); Rust code is not edited. SIZE: S.

- [H] [worth:med] core/vocabulary/*.js (30 sites), core/embedding/{embedding-cache.js:133,embedding-service.js:354,embedding-telemetry.js:131,161,167,model-server.mjs:155} (6) — `if (process.env.DEBUG_CATCHES) process.stderr.write('[non-fatal] ...')` is pasted 52 times in core (15 files, also search-server.js 12). Nothing sets the variable; only docs/VOCAB_PREWARM.md names it.
  FIX: `core/infrastructure/non-fatal.js` `reportNonFatal(err, label = '')` with the same text; the 52 sites call it (keeps the switch and the stderr text). Alternative: delete the switch (rule "nothing sets it"). RISK: stderr text must stay equal; check tests that spy on stderr. SIZE: M (mechanical).

- [H] [worth:med] core/ranking/file-kind/chunk-signals.js:284-296 and core/graph/graph-expansion.js:276-283 — `SWEET_SEARCH_MAX_ENVELOPE_LINES` with the default 500 is parsed in two modules with different rules (ranking: invalid value returns -1 = rule off; graph: invalid value falls back to 500). One setting, two meanings for a bad value.
  FIX: one `resolveMaxEnvelopeLines(options)` in core/infrastructure (returns `{ value, invalid }`); ranking keeps "-1 on invalid", graph keeps "500 on invalid" by reading `invalid`. RISK: none if both callers keep their reading of `invalid`. Check `tests/ranking/mega-entity*.test.js`, graph-expansion tests. SIZE: S.

- [H] [worth:med] core/ranking/cascaded-scorer.js:120, core/ranking/flashrank.js:687, core/search/search-semantic.js:614,774 — the reranker score field chain `localRerankerScore, jinaScore, voyageScore, flashRankScore` is written 4 times, with `??` in one place and `||` in three (a score of exactly 0 gives 0 vs `undefined`/the next field). A new reranker needs 4 edits.
  FIX: `RERANK_SCORE_FIELDS` array + `rerankScoreOf(r)` (keeps `??` form) and `rerankScoreOrUndefined(r)` (keeps `||` form) next to the rerankers in core/ranking; the 4 sites call them. RISK: exact 0-score semantics kept by having both forms; check tests/ranking/cascaded-scorer.test.js, tests/search/*rerank*. SIZE: S.

- [H] [worth:low] core/embedding/embedding-local-model.js:591,677, core/ranking/late-interaction-model.js:334,347, core/indexing/{indexer-pool.js:183,indexer-phases.js:516,indexer-ann.js:68-85,index-device-choice.js:103} — `SWEET_SEARCH_EMBED_USE_CPU` / `_LI_USE_CPU` are read raw in 7 places as `=== '1'`; `index-device-choice.js:100-104` documents that its own parse is wider (`1|true|on`) and "can only skip a test". Two parse rules for the same switch.
  FIX: `forceCpu('embed'|'li', env)` using `isOnValue` from core/infrastructure/env-flag.js — but that widens '1' to 'true'/'on' in 7 places (behavior); so only do it with the owner's yes (Behavior questions 2). SIZE: S.

- [S] [worth:low] core/embedding/embedding-service.js:500,702,714 — `int8DotProduct` is exported three ways (`export {x as y}`, a const, and in the default object); only tests/embedding/int8-stage2-rescore.integration.test.js uses it. core/query/query-router.js:25 / query-router-catboost.js:33 both define `MAX_QUERY_LENGTH = 100000`; `QueryRouter` constructor (query-router.js:49) takes `options` and ignores it.
  FIX: keep one export, point the test at `int8CosineSimilarity`; export the constant from query-router.js and import it in catboost; drop the unused parameter. RISK: none. SIZE: S.

## The one list (answer to "can init and uninstall read ONE list of installed artifacts?")

Yes for the per-repo artifacts, without changing what either command does. It cannot drive init's install order by itself (init calls depend on flags: `--no-claude`, `--no-cli` tear-down, `--enforce-tools`, layout result before `writeClaudeRules`), so init keeps its explicit call sequence and reads the list for the paths and the record; uninstall is driven by it.

`scripts/install-artifacts.js` exports `PROJECT_ARTIFACTS`, a frozen array. One entry = one thing init may leave in a repo:

| id | remove(projectRoot, {dryRun}) | normalised to `{status, detail, kept?}` by | planLabel | creates (tracked paths) | planRank / runRank |
|---|---|---|---|---|---|
| sweet-index-skill | `removeSweetIndexSkill` (moved to init side) | already | `/sweet-index skill (.claude/skills/sweet-index/)` | `.claude`, `.claude/skills` | 2 / 1 |
| prewarm-hook | `removePrewarmSessionStartHook` | already | `daemon-prewarm SessionStart hook in .claude/settings.json` | `.claude`, `.claude/settings.json` | 1 / 2 |
| codex-session-hook | `removeCodexSessionStartHook` | already | `Codex SessionStart hook (.codex/hooks.json)` | — | 8 / 3 |
| codex-harness | `removeCodexHarness` | already (+ `kept[]`) | `Codex harness (<detail>)` | — | 9 / 4 |
| opencode-harness | `removeOpencodeHarness` | already (+ `kept[]`) | `opencode harness (<detail>)` | — | 10 / 5 |
| agent-instructions | `removeAgentInstructions` | map `harnesses{}` to one status per harness | `agent-instruction marker blocks (<list>)` | `.cursor`, `.cursor/rules` | 3 / 6 |
| claude-rules | `removeClaudeRules` | string to `{status}` | `.claude/rules/sweet-search.md` | `.claude`, `.claude/rules` | 4 / 7 |
| claude-system-prompt | `removeClaudeSystemPrompt` | already | `Claude system-prompt output style (<detail>)` | `.claude`, `.claude/output-styles` | 5 / 8 |
| claude-lean-harness | `removeClaudeLeanHarness` | already | `Claude lean harness (<detail>)` | `.claude`, `.claude/agents` | 6 / 9 |
| tool-enforcement | `removeToolEnforcement` | already | `tool-enforcement strict mode (<detail>)` | `.claude/settings.json` | 7 / 10 |
| mcp-server | `removeMcpServer` | string to `{status}` | `MCP server registration (.mcp.json — mcpServers.sweet-search)` | — | 11 / 11 |

Plus two things that are not entries but are read from the same module: `DATA_DIR_NAME` (re-exported from `core/infrastructure/init-config.js` `INIT_DATA_DIR_NAME`, replacing the literals in init.js:74,1078 and uninstall.js:38) and the created-paths record (`CREATED_PATHS_FILE`, `snapshotTrackedPaths`, `readCreatedPaths`, `recordCreatedPaths`).
`TRACKED_CREATED_PATHS` becomes the ordered union of all `creates` (today's value, in today's order: `.claude, .claude/settings.json, .claude/skills, .claude/rules, .claude/agents, .claude/output-styles, .cursor, .cursor/rules`; keep that literal order by sorting the union with it, or keep the array and assert in a test that it equals the union).

Functions that read it:
- `uninstall.js planProjectUninstall` (11 inline dry-run calls become one loop over entries sorted by `planRank`; `lines` built from `planLabel`).
- `uninstall.js executeProjectUninstall` (11 blocks become one loop sorted by `runRank` using the existing `report(...)` helper; agent-instructions, rules, system-prompt and MCP keep their special "Kept:" wording through a small per-entry `reportFn`).
- `uninstall.js pruneCreatedPaths` (reads `readCreatedPaths` from the new module, not from init.js; `uninstall.js` stops importing `init.js`).
- `init.js snapshotTrackedPaths / recordCreatedPaths / readCreatedPaths` (move; init.js re-exports them).
- `init.js printHelp` (init help, lines 1488+) and `uninstall.js printHelp` (491+) can list the same `planLabel` strings later; leave the prose alone in the first step (help text is CLI output).
- New test: for every entry, the writer named in `installedBy` exists and `remove(tmpRepo, {dryRun:true})` returns `not-found` on an empty repo; this is what keeps "what init writes" and "what uninstall removes" from drifting again (the two known gaps in the log, `.gitignore` line and `~/.codex/config.toml` flag, become two entries with `remove: null` and a `reason`).

## Behavior questions

1. The dry-run list (plan) and the execution list print the same 11 items in two different orders. One list needs one order, or two rank columns. Keep both ranks (no change), or unify (dry-run output and "Removed:" lines change order)?
2. `SWEET_SEARCH_EMBED_USE_CPU` / `_LI_USE_CPU` / `_EMBED_HYBRID`: dispatchers read `'1'` (hybrid: `1|true|on`), `index-device-choice.js` reads `1|true|on`. One parse means `=true` starts to count in 7 places. Widen?
3. CUDA publishers build with Rust `stable` (whatever is current on release day); CPU addons with 1.97.1. Pin CUDA to 1.97.1 too, or is the floating compiler wanted?
4. Is the shared model server (`SWEET_SEARCH_SHARED_MODEL_SERVER`, model-server.mjs + model-client.mjs) planned for the box or any paper run? If yes keep it and add one start path; if no, remove (F11 listed it, nothing happened).
5. Late-interaction index research dials (`voronoiPrune`, `voronoiKeepRatio`, `normPruneThreshold`, `adaptiveBitAlloc` (assigned at late-interaction-index.js:369 and never read), `wushCalibrate`, `wushSampleSize`, 55 references in core/ranking/late-interaction-index.js): no caller sets them, but docs/PAPER_RANKING.md, docs/MAXSIM_OPTIMIZATION.md and docs/LI_QUANTIZATION_STRATEGY.md describe them. Paper material: keep, or remove with the docs updated?

## Checked, no action
- core/query: no churn; `query-router.js` is a thin WASM wrapper; back-compat re-exports in core/vocabulary and core/embedding are already gone (`grep backward|compat` finds only schema compatibility checks).
- package.json: every `bin`, `files` and `scripts` path exists (checked by script); `files` names `scripts/install-fs.js`; the `hcgs`/`warmup` scripts point at existing files.
- `scripts/link-native-tools.js`, `user-shims.js`, `repo-registry.js` keep their own pid-named temp-file writes on purpose (concurrent writers); merging them with `writeAtomic` would change temp names.
- Stopword lists, `PATH_TOKEN_STOPWORDS`, intent-router vs intent-detector, flashrank providers: already on the owner list or policy items in CLAUDE.md; not repeated.

Nothing else worth fixing in this area beyond the items above.
