# Package: w4-installers

## 1. Done
- Item 1, one list of artifacts. NEW `scripts/install-artifacts.js`: `PROJECT_ARTIFACTS` (11 frozen entries: id, remove, planLabel, report, creates, planRank, runRank), `artifactsInPlanOrder()`, `artifactsInRunOrder()`, `DATA_DIR_NAME`, and the created-paths record (`CREATED_PATHS_FILE`, `TRACKED_CREATED_PATHS` = union of `creates`, `snapshotTrackedPaths`, `readCreatedPaths`, `recordCreatedPaths`). `removeSweetIndexSkill` moved here.
  - `scripts/uninstall.js`: `planProjectUninstall` and `executeProjectUninstall` are now one loop each over the list; no import of `init.js` any more; `DATA_DIR_NAME` literal gone. It re-exports `removeSweetIndexSkill`, `removePrewarmSessionStartHook`, `removeCodexSessionStartHook` (tests import them from there).
  - `scripts/init.js`: imports the record functions and `DATA_DIR_NAME` from the new module and re-exports the record names. Init keeps its own call sequence.
- Item 2, hook entries. NEW `scripts/hook-entries.js`: `HOOK_BIN`, `HOOK_FLAGS`, `hookCommand`, `hasOwnedHook(group, marker | [markers])`, `removeOwnedGroups`, `upsertOwnedGroup`, `registerSessionHooks` (the shared body of the two register functions), and the two hook removers moved from uninstall.js.
  - Sites now using it: init.js (both register functions, `hasCodexPrewarmHook`; `PREWARM_HOOK_COMMAND` kept as an export = `HOOK_BIN`), uninstall.js hook removers (2 sites, now in hook-entries.js), install-claude-lean-harness.js (`isTitleHookGroup`, `CLAUDE_LEAN_TITLE_HOOK_COMMAND` same value), install-tool-enforcement.js (3 sites, `READ_HINT_HOOK_COMMAND` same value). The SessionEnd match keeps its extra condition via `[HOOK_BIN, '--agent-session-drop']`.
- Item 3, `setRepoMapModule`: partly. `QualityScorer` takes a `repoMap` constructor option (`core/ranking/quality-scorer.js`); `tests/ranking/quality-scorer.test.js` passes the mock through it. See Needs follow-up for the rest.
- New tests: `tests/init/uninstall-order.test.js` (pins dry-run and run order on the real CLI; written and run green against unchanged code first), `tests/init/install-artifacts.test.js` (ids and ranks unique, removers find nothing in an empty repo, tracked paths order).

## 2. Not done and why
- Sites that stay different: none left in my files; every "is ours" check now calls `hasOwnedHook`. Other spellings of the hook flags remain outside my set: `core/search/session-daemon-prewarm.mjs:56-58` and `scripts/hooks/hook.mjs:18-20,87` read them (hook.mjs/session-title.mjs are readers; they could import `HOOK_FLAGS`, left alone).
- Setter not deleted (see below). `setRepoMapModule` callers in the whole repo: `core/search/sweet-search.js:27,178` (the only product call), `core/ranking/index.js:15` (barrel), the one test. No research code calls it.
- help text left alone (CLI output).

## 3. Behavior questions
- None. Byte comparison before/after (see Verification): dry-run and run stdout, exit codes, file trees before and after uninstall are identical for three init variants.

## 4. Needs follow-up (outside my file set)
- package.json `files`: add `scripts/install-artifacts.js` and `scripts/hook-entries.js`. Until then `tests/integration/packaging.test.js` "every relative import of the install and ss-* scripts is in the tarball" FAILS with 6 entries (init.js, uninstall.js, lean harness, tool enforcement -> the two new files). Expected single failure.
- `setRepoMapModule` (core/search is another agent's folder): in `core/search/search-postprocess.js:711` pass `repoMap: { pageRank, loadGraph, buildAdjacency }` (import from `../graph/repo-map.js`) to `new QualityScorer({...})`; delete the call and import in `core/search/sweet-search.js:27,178`; then delete `setRepoMapModule`, `_repoMapModule` and the `?? _repoMapModule` fallback in `core/ranking/quality-scorer.js` and the export in `core/ranking/index.js:15`. Today the setter still works as fallback, so product behavior is unchanged and nothing breaks if this waits.
- Optional: `core/search/session-daemon-prewarm.mjs` and `scripts/hooks/hook.mjs` could read flag names from `HOOK_FLAGS` (hook.mjs runs from the package; add no import to the daemon module without checking boundaries).

## 5. Verification
- Dry-run order is covered by `tests/init/uninstall-order.test.js` "dry-run plan lists the artifacts in plan order"; execute order by "the run reports removals in run order" (both new; before them no test pinned either order: `tests/init/lifecycle.test.js` and `uninstall-all.test.js` check files and not line order). Both passed on the unchanged code before the refactor.
- Byte check: `scratchpad/w4-installers-snap.sh` runs init plus `uninstall --dry-run` plus `uninstall --force` for 3 variants in temp projects with a temp HOME. `diff -r w4-installers-before w4-installers-after`: only init stdout/stderr lines that print the random temp path differ; every dry*.out, run*.out (incl. exit code), tree*.txt, after*.txt is identical.
- `node --check` on init.js, uninstall.js, install-*.js, hook-entries.js, inject-agent-instructions.js, write-claude-rules.js, core/ranking/quality-scorer.js: clean. `npx eslint scripts/init.js scripts/uninstall.js scripts/hook-entries.js scripts/install-artifacts.js`: clean. `npx eslint core/`: clean.
- `node scripts/check-boundaries.js 2>/dev/null | tail -2`: "Checked: 12 domains, 12 direction rules, ... 65 internal, 602 external barrel bypass warning(s) — not blocking."
- `npx vitest run tests/init tests/integration/packaging.test.js tests/integration/init-integration.test.js tests/integration/init.test.js tests/ranking tests/graph/repo-map.test.js`: Test Files 1 failed | 42 passed (43); Tests 1 failed | 866 passed. The failure is the packaging test named above.
