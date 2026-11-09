# Package: installers

## 1. Done
- T1: NEW `scripts/install-fs.js` exports `OWNERSHIP_SENTINEL`, `writeAtomic` (mkdir -p, `<path>.sweet-search.tmp`, utf8, rename), `writeViaTmp` (`<path>.tmp`, utf8, rename, no mkdir), `fileState`, `detectProjectRoot`.
  - `fileState`: 3 identical copies removed (install-claude-lean-harness.js, install-codex-harness.js, install-opencode-harness.js); each imports it. None of the three exported it, so no re-export was needed.
  - `writeAtomic`: copies removed in codex and opencode. lean `writeJson` and system-prompt `writeSettings` now call it (same bytes, same temp name, same mkdir).
  - `writeViaTmp` replaces the `.tmp` idiom at: init.js (`writeInitConfig`, prewarm hook write, Codex hook write), uninstall.js (2 places), install-tool-enforcement.js, install-codex-harness.js (`write` in `ensureCodexHooksFeatureFlag`). The callers keep their own `mkdirSync` and their own try/catch.
  - `detectProjectRoot`: init.js re-exports it (tests/integration/init.test.js imports it from init.js); the uninstall.js copy is gone.
  - Sentinel: `write-claude-rules.js` and `install-claude-system-prompt.js` set `const SENTINEL = OWNERSHIP_SENTINEL` (their `_internal.SENTINEL` exports are unchanged; tests use them).
  - Unused `node:fs` / `node:path` imports pruned in the 7 touched installers.
- T2: the function is `detectSkippedPostinstall` (about 14 lines, pure fs, one constant). Moved to NEW `core/infrastructure/postinstall-check.js`. `core/search/setup-status.js` now imports it statically (was a dynamic import of init.js inside try/catch; the function cannot throw on valid input, so the catch was dead). init.js imports it and re-exports it (tests/init/init-announcements.test.js imports it from init.js). init.js no longer imports `INSTALL_NODE_FILE`.
  - The function needs `INSTALL_NODE_FILE = '.install-node'`. It is exported by scripts/link-native-tools.js (outside my set). To keep core free of scripts/, the new module declares the constant itself with a "Mirrors" comment (same pattern as the Rust side). See Needs follow-up.

## 2. Not done and why
- Temp-file writes with a different temp name were NOT merged: `scripts/repo-registry.js:36` and `scripts/user-shims.js:111` use `${file}.${process.pid}.tmp`. `scripts/user-shims.js:229-237` and `:275-279` build `${target}.sweet-search-${process.pid}`, with hard link / copy and chmod 0755 before rename (binary shims, not text). Different names change on-disk behavior under concurrency.
- scripts/link-native-tools.js:64 has the same idiom; outside my file set.
- `readJson` copies (codex, lean, system-prompt `readSettings`, opencode) differ: error text and return keys (`value` vs `settings`, "existing <label>" prefix vs path prefix). Left alone.
- install-mcp-server.js, inject-agent-instructions.js: no copy of the moved helpers (checked); unchanged. DATA_DIR_NAME in init/uninstall left as is (two literals, not in T1 list).
- T3 and T4: report only, as instructed.

## 3. Behavior questions
- `writeViaTmp` callers in init.js/uninstall.js passed 'utf-8', the helper passes 'utf8'. Node treats both the same; no byte change.
- `setup-status.js` previously swallowed any failure of loading init.js (`catch {}` => skippedPostinstall null). It now imports a 20-line module with no failure path. Only difference: none for a normal install.

## 4. Needs follow-up (outside my file set)
- **package.json: add `scripts/install-fs.js` to `files`.** Until then `tests/integration/packaging.test.js` ("every relative import of the install and ss-* scripts is in the tarball") FAILS with 8 entries of `<installer> -> scripts/install-fs.js`, and a published package would crash `sweet-search init`. `core/infrastructure/postinstall-check.js` ships through the existing `core/` entry (verify: `grep '"core/' package.json` printed nothing, so check how `core` is listed).
- scripts/link-native-tools.js: could import `INSTALL_NODE_FILE` from `../core/infrastructure/postinstall-check.js` (export it there) to leave one JS definition; I left it private there to avoid touching your file.
- scripts/link-native-tools.js:64 and user-shims/repo-registry pid-named temp writes: optional second helper if you want it.

## 5. Verification
- `node --check` on init.js, uninstall.js, install-*.js (8), write-claude-rules.js, install-fs.js, setup-status.js, postinstall-check.js: clean.
- `npx eslint core/search/setup-status.js core/infrastructure/postinstall-check.js`: clean.
- `npx vitest run tests/init tests/integration/packaging.test.js tests/integration/init.test.js tests/integration/init-integration.test.js tests/search/setup-status.test.js`: Test Files 1 failed | 23 passed (24); Tests 1 failed | 467 passed (468). The one failure is the packaging test above (install-fs.js missing from package.json files). Duration was 9.7 s, not 10 min. Log: /private/tmp/claude-501/-Users-admin--claude-spares-spare-iAs9Z3/8ff595e3-162b-4701-8d87-7fc0723fb9e4/scratchpad/installers-vitest.log
- Not run: shadow check (no ss-grep output code touched).

## T3. What init writes versus what uninstall removes
Columns: artifact | init writer | uninstall remover | dry-run plan (planProjectUninstall, uninstall.js) | help text (init printHelp / uninstall printHelp) | in TRACKED_CREATED_PATHS?
TRACKED_CREATED_PATHS (init.js:387) = `.claude`, `.claude/settings.json`, `.claude/skills`, `.claude/rules`, `.claude/agents`, `.claude/output-styles`, `.cursor`, `.cursor/rules`.

| Artifact | init writer | uninstall remover | dry-run plan line | help text | tracked |
|---|---|---|---|---|---|
| `.sweet-search/` dir | `ensureDataDir` init.js:356 | `planProjectUninstall` removal entry, `rmSync` in `executeProjectUninstall` | yes ("`.sweet-search/` (size)") | uninstall: yes; init: yes | no (is the data dir itself) |
| `.sweet-search/config.json` | `writeInitConfig` init.js:432 (3 calls in `runInit`) | goes with the dir | with dir | uninstall: inside "config, index, daemon state" | no |
| `.sweet-search/created-paths.json` | `recordCreatedPaths` init.js:408 | goes with the dir; read first by `readCreatedPaths` in `planProjectUninstall` | with dir | no | no (it is the record) |
| `.gitignore` line `.sweet-search/` (only if .gitignore exists) | `maybeIgnoreDataDir` init.js:366 | NONE | no | init mentions it ("the .gitignore line"); uninstall: no | no. **init writes, uninstall does not remove** |
| `.claude/skills/sweet-index/` | `installSweetIndexSkill` init.js:1451 | `removeSweetIndexSkill` uninstall.js:289 | yes | uninstall: yes ("/sweet-index skill"); init: --no-claude text | `.claude`, `.claude/skills` yes |
| `.claude/settings.json` SessionStart/SessionEnd prewarm hook | `registerPrewarmSessionStartHook` init.js:1175 | `removePrewarmSessionStartHook` uninstall.js:317 | yes | uninstall: yes ("index-maintainer and prewarm hooks"); init: `--skip-prewarm-hook` | `.claude/settings.json` yes |
| `.claude/rules/sweet-search.md` | `writeClaudeRules` write-claude-rules.js (called init.js ~2000s) | `removeClaudeRules` write-claude-rules.js, called in `executeProjectUninstall` | yes | both | `.claude/rules` yes |
| `.claude/output-styles/sweet-search.md` + `outputStyle` key | `installClaudeSystemPrompt` install-claude-system-prompt.js | `removeClaudeSystemPrompt` same file | yes | uninstall: yes ("output style + selection") | `.claude/output-styles` yes |
| Lean harness: `.claude/agents/{sweet-search,general-purpose,Plan}.md`, `.claude/sweet-search-harness.json`, settings `agent`, `permissions.deny`, `env`, tab-title UserPromptSubmit hook | `installClaudeLeanHarness` install-claude-lean-harness.js (init passes `titleHook:true`) | `removeClaudeLeanHarness` same file | yes ("Claude lean harness") | uninstall help does NOT name the agent files or manifest (only "Claude Code wiring"). init help: partly | `.claude/agents` yes. `.claude/sweet-search-harness.json` is not a tracked path but is removed by the remover |
| Tool enforcement: `permissions.deny: [Grep]` + PreToolUse Read hint hook | `installToolEnforcement` install-tool-enforcement.js (opt-in `--enforce-tools`) | `removeToolEnforcement` same file | yes | uninstall: "optional tool-enforcement and reminder hooks" | `.claude/settings.json` yes |
| `AGENTS.md` block (or whole file) | `injectAgentInstructions` inject-agent-instructions.js (`--agents`) | `removeAgentInstructions` same file | yes (grouped line "agent-instruction marker blocks (...)") | both | no |
| `GEMINI.md` block / symlink | `injectAgentInstructions` (`--gemini`) | `removeAgentInstructions` | yes (grouped) | both | no |
| `.cursor/rules/sweet-search.mdc` | `injectAgentInstructions` (`--cursor`) | `removeAgentInstructions` | yes (grouped) | both | `.cursor`, `.cursor/rules` yes |
| `.mcp.json` `mcpServers.sweet-search` | `installMcpServer` install-mcp-server.js (`--mcp`) | `removeMcpServer` same file | yes | uninstall: "MCP server registration" | no |
| `.codex/hooks.json` SessionStart hook | `registerCodexSessionStartHook` init.js:1291 | `removeCodexSessionStartHook` uninstall.js:391 | yes | uninstall: yes | no (`.codex` is not tracked: an emptied .codex/ dir is removed by `removeCodexHarness`, comment in executeProjectUninstall) |
| `.codex/config.toml` keys (`model_instructions_file`, `developer_instructions`, `[features] hooks`) + `.codex/sweet-search-instructions.md` + `.codex/sweet-search-harness.json` | `installCodexHarness` install-codex-harness.js; flag via `ensureCodexHooksFeatureFlag` | `removeCodexHarness` same file | yes ("Codex harness") | uninstall: yes (detailed) | no |
| `.opencode/` files (`sweet-search.md`, `sweet-search-prompt.txt`, `plugins/sweet-search.mjs`, `plugins/sweet-search-cache.mjs`, `opencode.json(c)` keys, manifest) | `installOpencodeHarness` install-opencode-harness.js | `removeOpencodeHarness` same file | yes ("opencode harness") | uninstall: yes (detailed) | no |
| `~/.codex/config.toml` `[features] hooks` (only with `--codex-enable-global-hooks`) | `ensureCodexHooksFeatureFlag(join(homedir(), '.codex', 'config.toml'), {create:true})` in `runInit` | NONE (grep of uninstall.js: no `.codex/config`, no homedir codex path) | no | init help: legacy/advanced; uninstall "Never removed" only names a flag that existed before init | no. **init writes, uninstall does not remove** (user-level file; by design?) |
| Repo registry `repos.json` entry (user level) | `registerRepo` repo-registry.js, init.js `runInit` step 2 | `unregisterRepos` via `runUninstall` for `--all` (and whole-run clean) | no per-repo line | uninstall `--all`: "Every repo where init ran" | no |
| `ss-*` user shims in `~/.local/bin` + shim manifest | `installUserShims` user-shims.js via `setUpAgentTools` init.js:747 | `removeUserShims` user-shims.js, `--all` only | `planUserShimRemovals` in the `--all` plan | uninstall: yes (Also removed by --all) | no |
| Native tool link: bin/ss-* stubs replaced, `<package>/.install-node` | `linkNativeAgentTools` link-native-tools.js (postinstall and init) | removed with the npm package (`removePackage`, `--all`) | package line in `--all` plan | uninstall: package yes; stubs not named | no |
| Model cache `~/.cache/sweet-search` incl. CoreML cascade | `downloadModelsForProfile` init.js:856 and CoreML fetch/build | `planSharedCacheRemovals` / `getCoremlCascadeRemovals`, `--all` only | yes in `--all` plan | uninstall: yes | no |
| `.claude/settings.local.json` | NOT written by init (read only by lean/system-prompt to detect an override) | n/a | n/a | n/a | n/a |
| `.claude`, `.cursor` etc. empty dirs | created as side effect of the writers above | `pruneCreatedPaths` uninstall.js:612 (only paths recorded in created-paths.json) | not listed in `lines` (prune is applied after removers; shown only at execution: "Removed: now-empty paths init created") | uninstall: last bullet of "Never removed" | defines the set |

Mismatches (init writes, uninstall does not remove): (1) `.gitignore` line; (2) `~/.codex/config.toml` global hooks flag. Reverse (uninstall removes, init never writes it): `removeClaudeLeanHarness`/`removeClaudeSystemPrompt` also remove a prior lean/style install on `--no-cli`/`--no-lean-harness` re-init (init itself calls the removers, so not a mismatch). Unlisted in the uninstall help: lean-harness agent files and `.claude/sweet-search-harness.json`; the dry-run plan does not list the prune of created directories.
Install-order dependencies: init runs lean harness before `writeClaudeRules` (layout depends on its result); uninstall removers run `removeCodexSessionStartHook` before `removeCodexHarness` (so an emptied .codex/ goes).
Registry idea location: init.js:1736 `runInit` (about 10 calls), uninstall.js:554/641/491, `TRACKED_CREATED_PATHS` init.js:387, init help init.js:1488.

## T4. Do-not-touch items: file:line and users
Line numbers are current after my edits.

v1 constants in scripts/install-claude-lean-harness.js
- `CLAUDE_LEAN_BASE_PROMPT` :90 — users: eval/task-completion-bench/harness/claude-code-task-runner.mjs:46,196.
- `CLAUDE_LEAN_BASE_PROMPT_BATCH` :102 — users: claude-code-task-runner.mjs:46,201; eval/task-completion-bench/tests/harness-batch-variants.mjs:44 (dynamic import of the installer); tests/init/claude-lean-harness.test.js:20,102,326.
- `CLAUDE_LEAN_SUBAGENT_DESCRIPTION` :106 / `CLAUDE_LEAN_SUBAGENT_PROMPT` :108 — shared by v1 and v2 (v2 uses them); keep.
- `CLAUDE_LEAN_DENY_TOOLS` :118 — no user outside the installer (only used to build `CLAUDE_LEAN_DENY` :130). `CLAUDE_LEAN_DENY_AGENT_TYPES` :125 same.
- `CLAUDE_LEAN_DENY` :130 — users: tests/init/claude-lean-harness.test.js:24,103,337.
- `CLAUDE_LEAN_ENV` :138 — users: claude-code-task-runner.mjs:46,218; tests/init/claude-lean-harness.test.js:25,104,342,348.
- v2 `CLAUDE_LEAN_HARNESS_DENY` — users: tests/init/claude-lean-harness.test.js:26,136,368,374; tests/init/lifecycle.test.js:37,146 (product, keep).
- Edit-pair machinery: `CLAUDE_LEAN_BATCH_LINE` :185, `CLAUDE_LEAN_NOEDIT_LINE` :199 (user: eval/task-completion-bench/harness/trim/batch-variants.mjs:18,242), `CLAUDE_LEAN_EDIT_ACT` :200 (batch-variants.mjs:18,290,321), `CLAUDE_LEAN_EDIT_REPORT` :204 (batch-variants.mjs, tests), `CLAUDE_LEAN_EDIT_GIT` :208 (tests/init/claude-lean-harness.test.js:121), `CLAUDE_LEAN_EDIT_PACK` :212, `CLAUDE_LEAN_PROMPT_EDITS` :216 (tests/init/claude-lean-harness.test.js:23,121,125).
- v1 -> v2 migration in `installClaudeLeanHarness`: stale deny removal :604-608, env removal :627-641, manifest version check :659-662, header text :39-42. Test pinned: tests/init/claude-lean-harness.test.js:326-374 builds a V1 manifest.

CoreML build path
- `runCoremlCascadeBuild` scripts/init.js:2477 (definition), called init.js:1982 under `--build-coreml-cascade` (parse init.js:158, help init.js:1529). Users of the flag: README.md:215; no test. The script it spawns, scripts/build-coreml-cascade.js, is named by core/infrastructure/coreml-cascade.js:19,561,570,608,913, core/infrastructure/native-inference.js:134, scripts/check-boundaries.js:98, tests/release/lateon-code-edge-e2e.test.js:694. It is not in package.json `files` (per findings), so the published branch always reports "not found".

`codex_hooks` -> `hooks` migration
- scripts/install-codex-harness.js:221-239 (doc), :269-295 (code, status 'migrated' at :280, :295); init.js:1391,1399-1402 (`'migrated'` counted as enabled), :1595,:1648,:2162 (help/comments). Tests: tests/init/codex-hook.test.js:4,144,163-200 (4 cases assert 'migrated'), 223,237,363-373.

Legacy flags
- `--codex-enable-global-hooks`: init.js:116 (default), :244-250 (parse), :1390 (text), :1642 (help), :2168/:2197 (use). Tests: tests/init/codex-hook.test.js:351-356,389,414,441,457.
- `--skip-prewarm-hook`: init.js:91,174-178,1172,1179,1292,1372-1379,1542,2145,2176. Tests: tests/init/uninstall-all.test.js:54, tests/init/codex-hook.test.js:393-414.
- `--no-opencode-cache-key` / `--opencode-cache-key`: init.js:115,234-242,1636-1638, `opencodeCacheKeyOffByEnv` (install-opencode-harness.js) at init.js ~2218; env `SWEET_SEARCH_OC_CACHE_KEY` in vitest.config.js:19-21. Plugin: scripts/harness-prompts/opencode-cache-key-plugin.mjs.
