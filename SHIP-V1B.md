# SHIP-V1B — Claude Code rules in the system prompt (product default)

**Conclusion:** branch `ship-v1b` makes V1b the default for `sweet-search init` (Claude Code). All tests pass. The change is not merged, not tagged and not published.

V1b moves the full sweet-search rules into the lean main agent file, which is the system prompt. `.claude/rules/sweet-search.md` then holds a short pointer only. Claude Code injects rules files into the first user message, after the prompt-cache marker. Thus 2.8.2 wrote about 1.4k rule tokens to the cache again in every session. In the system prompt, these tokens are a cache read.

## Evidence (final-tuning, 2026-10-01)

Source: `sweet-search-final-tuning/core/prompt-optimization/data/final-tuning/` (`r3/RESULTS-HELDOUT-FIXED.md`, `TASK-GUARD.md`, `MORNING-REPORT.md`).
r3 held-out set: n = 103 probes, paired bootstrap stratified by stratum, B = 20000, seed 42, BH correction across 21 tests.

| Cell | Metric | V1b vs 2.8.2 | 95% CI | Significant after BH |
|---|---|---|---|---|
| Opus, Claude Code | cost per probe | −11.3% | [−$0.0122, −$0.0060] | yes |
| Opus, Claude Code | accuracy | −1.2 pt | [−2.9, +0.6] pt | no |
| Sonnet, Claude Code | cost per probe | −10.1% | [−$0.0090, −$0.0037] | yes |
| Sonnet, Claude Code | accuracy | +1.3 pt | [−0.7, +3.3] pt | no |

Task guard (task-completion bench, 20 rollouts per arm): solves 9/20 for V1b vs 8/20 for 2.8.2. The ss-* share of search and read calls is 0.54 vs 0.53, so the share did not drop.
V1 (no pointer file) dropped that share from 0.53 to 0.32. For this reason, the pointer file is necessary.

## What `init` installs now (Claude Code, default)

| File | 2.8.2 | V1b |
|---|---|---|
| `.claude/agents/sweet-search.md` | base prompt + memory section + override (7143 bytes in the end-to-end check) | base prompt + **full rules** + memory section + override (13193 bytes) |
| `.claude/rules/sweet-search.md` | sentinel + full rules (6128 bytes) | sentinel + `CLAUDE_RULES_POINTER` (368 bytes) |
| `.claude/agents/general-purpose.md`, `.claude/agents/Plan.md` | no search advice | unchanged (no rules added) |
| `.claude/settings.json`, `.claude/sweet-search-harness.json` | lean harness entries, file hashes | same entries; the agent-file hash follows the new content |

The rules go after the base prompt and before `# Memory` (or before `# Session context` when auto memory is off). This is the same position as in the benchmarked variant.

## Changes

| File | Change |
|---|---|
| `scripts/write-claude-rules.js` | `CLAUDE_RULES_POINTER` (moved here, byte-identical to the benchmarked text). `resolveClaudeRulesLayout(env, { strict })` reads `SS_VARIANT_CC_RULES_IN_PROMPT`. `writeClaudeRules({ layout: 'full' \| 'pointer' })`; the default stays `'full'`. |
| `scripts/install-claude-lean-harness.js` | `claudeLeanAgentFile({ rules })` puts a rules text before the context section; the default is `null`, so the pure function is unchanged. `installClaudeLeanHarness({ rules })`: when `rules` is not given, the shipped policy goes in, unless the switch is `0`. The result has the new field `rulesInPrompt`. The installer never puts the rules in the agent file when `settings.local.json` selects another main agent. It re-exports `CLAUDE_RULES_POINTER` for the bench runners. |
| `scripts/init.js` | The lean harness now runs first. Then the rules file follows its result: a pointer only when `active === true && rulesInPrompt === true`, else the full file. It writes a warning for an unknown switch value and a note when a user-authored rules file is kept. The help text documents the opt-out. The final summary line names the pointer layout. |
| `eval/task-completion-bench/harness/claude-code-task-runner.mjs` | The default follows the product: with the lean harness and `SWEET_RULES_PLACEMENT=file`, the rules go into the agent file (explicit `rules: mppText`) and the rules file holds the pointer. `=0` gives the 2.8.2 control. `=1` gives V1. An explicit `1` or `2` without the lean harness or with `system` placement still fails. The in-run proofs and the `ccRulesInPrompt` row field stay. The check "mppText must equal the product rules" is removed, so the default cannot fail on a custom rules text. |
| `scripts/retrieval-bench-282.mjs` | `installClaudeProduct` now uses the same order as `init`: lean harness first, then the rules file by its result. `=0` reproduces 2.8.2. |
| `vitest.config.js` | Sets `SS_VARIANT_CC_RULES_IN_PROMPT=''` so that a value in the developer shell cannot change test results. |
| Tests | See the next section. |

No Rust code writes these files (`crates/` has no reference to them). `core/cli.js` sends `init` and `uninstall` to these scripts. `uninstall.js` needs no change: the pointer file has the same sentinel, so `removeClaudeRules` removes it, and the manifest hash removes the agent file.

## Migration behaviour (re-run of `init`)

| State before `init` | Result |
|---|---|
| 2.8.2 install, all files sentinel-owned or hash-owned | The agent file is rewritten with the rules and its manifest hash is updated. The rules file goes from full to pointer (`updated`). The subagents and `settings.json` stay byte-identical. |
| Rules file written by the user (no sentinel) | The file stays untouched (`preserved-user-file`). The agent file carries the rules. `init` writes a note. `uninstall` keeps the file. |
| Lean agent file edited by the user (hash mismatch) | The harness is not active. The agent file stays. The rules file is full. |
| `settings.json` selects another main agent | No lean agent file. The rules file is full. |
| `settings.local.json` selects another main agent | Lean files are installed **without** the rules. The rules file is full. The output style is the fallback, as before. |
| `--no-lean-harness` or `--mcp --no-cli` | The lean harness is removed. The rules file is full (CLI or MCP variant), as before. |
| V1b install, then `init` again | No byte changes (`unchanged`). |
| V1b install, then `SS_VARIANT_CC_RULES_IN_PROMPT=0 init` | Exact 2.8.2 bytes in every `.claude` file (proved in the tests and in the end-to-end check). |

## Opt-out

`SS_VARIANT_CC_RULES_IN_PROMPT=0 sweet-search init` installs the 2.8.2 layout: the full rules file and an agent file without rules. One switch serves the product and the bench helpers:

| Value | Layout | Use |
|---|---|---|
| unset, empty, `2` | rules in the agent file + pointer rules file | default (V1b) |
| `0` | full rules file only | opt-out, 2.8.2 control runs |
| `1` | rules in the agent file, no rules file | bench reproduction of V1 only |
| anything else | default; `init` warns; bench runners fail | — |

`--no-lean-harness` also gives a full rules file, because it removes the agent file that would carry the rules.

## Tests run (worktree `sweet-search-ship-v1b`, private `SWEET_SEARCH_RUNTIME_DIR`)

| Command | Result |
|---|---|
| `npx vitest run tests/init tests/integration/init-integration.test.js tests/integration/init.test.js tests/integration/brand-presence.test.js tests/infrastructure/init-config.test.js` | 23 files, **463 passed**, 0 failed |
| The same command with `SS_VARIANT_CC_RULES_IN_PROMPT=0` in the shell (hermeticity check) | 463 passed |
| `node eval/task-completion-bench/tests/sweet-rules-placement.mjs` | ALL PASS |
| `node eval/task-completion-bench/tests/claude-code-cost.mjs` | ALL PASS |
| `node eval/task-completion-bench/tests/harness-batch-variants.mjs` | ALL PASS |
| `node eval/task-completion-bench/tests/prompt-stdin.mjs` | all assertions passed |
| `npx eslint` on every changed file | clean |

Before the test updates, 6 existing tests failed. All 6 asserted the old full rules file after a default CLI init, which is the intended change. These tests now assert the pointer, and they also check that the agent file carries the policy exactly once.

New tests:
- `tests/init/agent-instructions.test.js`: pointer layout, full ↔ pointer in place, a user file is kept under the pointer, uninstall removes the pointer, an unknown layout is rejected, the resolver values (including a prototype-key value).
- `tests/init/claude-lean-harness.test.js` ("rules in the main agent (V1b)"): position before `# Memory` and before `# Session context`, subagents without rules, `2` = unset byte for byte, `0` = no rules, explicit `rules` text or `false`, owned-file migration in both directions with manifest hashes, no rules when another main agent is selected.
- `tests/init/lifecycle.test.js` ("lifecycle: V1b rules placement", spawns the real CLI): opt-out = 2.8.2 layout, upgrade from 2.8.2 + manifest consistency + idempotent re-init, opt-out after upgrade restores exact 2.8.2 bytes, user rules file kept and kept after uninstall, user-selected main agent, user-edited agent file, unknown switch value, uninstall after upgrade leaves no Claude Code file.
- `tests/init/harness-prompts.test.js`: product default = bench runner install (`rules: mppText`) + `read6fs`, except the override; `2` = unset and `0` = no-rules bytes; **golden sha256 pins** for the V1b agent file (`5d238cab…`, no override; `f09e7ef9…`, as shipped) and the pointer (`2523ba9a…`). The existing 2.8.2 pin (`11446e95…`) stays unchanged.

## Byte equality with the benchmarked variant (`SS_VARIANT_CC_RULES_IN_PROMPT=2`)

1. The golden pins come from the reference implementation on branch `final-tuning` (`claudeLeanAgentFile({ rulesInPrompt: true })`). A script compared four option sets (override on/off, memory on/off, prompt edits on/off). All four were identical, and the policy and pointer texts were identical too.
2. End-to-end: the reference bench install (`final-tuning` code, `=2`, pointer file + `installClaudeLeanHarness`) and `ship-v1b init` gave **identical** bytes in all 5 files on the same path: the rules file, 3 agent files and the manifest.
3. In code, `=2` and unset take the same path (`resolveClaudeRulesLayout` maps both to `pointer`). A unit test shows that they install the same bytes.

## End-to-end check ($0, temp git repo, temp `CLAUDE_CONFIG_DIR`, temp registry and runtime dir)

Script: `scratchpad/e2e.sh` (not committed). 2.8.2 came from a temporary detached worktree of `main` @ 0e128ac6.

```
### 1. 2.8.2 init         rules 6128 B (full), agent 7143 B, policy copies in agent: 0
### 2. ship-v1b init      [init] Claude rules: updated [pointer; the full rules are in .claude/agents/sweet-search.md]
                          rules 368 B, agent 13193 B, policy copies in agent: 1, manifest hashes OK (3/3)
                          changed vs 2.8.2: agent file, rules file, manifest only
### 3. init again         [init] Claude rules: unchanged [...]   no file changed
### 4. uninstall          Removed: .claude/rules/sweet-search.md; Removed: Claude lean harness (...)  -> no .claude directory left
### 5. reference (=2)     IDENTICAL x5 (rules, sweet-search.md, general-purpose.md, Plan.md, sweet-search-harness.json)
### 6. settings.local.json selects another agent  -> rules file 6128 B (full), agent without the policy
### 7. SS_VARIANT_CC_RULES_IN_PROMPT=0           -> all .claude files byte-identical to the 2.8.2 install
```

Pointer file as installed:
```
<!-- generated by `sweet-search init`; removed by `sweet-search uninstall` -->
# Sweet-search
Use the `ss-*` tools (`ss-search`, `ss-grep`, `ss-read`, `ss-find`, `ss-semantic`, `ss-trace`) for all code search and navigation, as the sweet-search rules in your system prompt describe. Use raw `grep`/`find`/`cat` or the native reader only for a file edited seconds ago.
```

## Risks

1. **Subagents see only the pointer.** `general-purpose` and `Plan` load the project rules file, so they now get the pointer and not the full rules. The pointer says "as the sweet-search rules in your system prompt describe", but a subagent system prompt does not contain them. The benchmarks used the same layout, so the measured results include this effect. A heavy-subagent workload was not measured on its own.
2. **The override text still names the rules file.** `CLAUDE_SYSTEM_OVERRIDE` (at the end of the agent file) says "follow the sweet-search guidance in `.claude/rules/sweet-search.md`". That file is now the pointer. The text was not changed, because a change would break byte equality with the benchmarked arm. A wording fix needs a new benchmark run.
3. **Accuracy is equal, but not better.** Opus V1b vs native: accuracy −2.1 pt (raw p 0.034, BH p 0.078, not significant). Opus V1b vs 2.8.2: −1.2 pt, CI crosses 0. Opus V1b still costs +6.9% vs native (significant). Do not publish "cheaper than native" for Opus.
4. **State that changes after `init`.** If a user sets another main agent after a V1b install and does not run `init` again, the rules reach the model only as the pointer. A re-run of `init` writes the full file again. The same was true in 2.8.2 for other late edits.
5. **Bench default changes.** `claude-code-task-runner.mjs` and `retrieval-bench-282.mjs` now install V1b when the switch is unset. Earlier 2.8.2 Claude Code rows have no `ccRulesInPrompt` field. New default rows have `ccRulesInPrompt: 'v1b-pointer'`. For a 2.8.2 control, use `SS_VARIANT_CC_RULES_IN_PROMPT=0`. Do not pool rows across this change.
6. **Archived probe scripts** in `eval/task-completion-bench/handoffs/improve/harness-prompt-trim/scripts/` (`ship-probe/*.mjs`, `tty_run.py`, `capture_cc_runner.mjs`) call the installer without `rules`. They now get the rules in the agent file, and some of them also write the full rules file. To repeat their old captures, run them with `SS_VARIANT_CC_RULES_IN_PROMPT=0`. They were not edited.
7. **Claude Code version.** The placement assumes that Claude Code 2.1.281 behaves the same in later versions: rules files after the cache marker, the agent body as the system prompt. Re-check with a $0 capture on each new Claude Code release, as for the lean harness.

## Release-note entry (no CHANGELOG.md exists in the repo)

> **Claude Code: the sweet-search rules move into the cached system prompt.** When the lean harness is active (the default), `sweet-search init` now writes the full rules into `.claude/agents/sweet-search.md` and only a short pointer into `.claude/rules/sweet-search.md`. Claude Code puts rules files after the prompt-cache marker, so the rules were written to the cache again in every session. Held-out (n = 103, seed 42): cost −11.3% on Opus and −10.1% on Sonnet vs 2.8.2, accuracy equal. Re-run `sweet-search init` to upgrade. A rules file that you wrote yourself is kept. To keep the old layout, run `SS_VARIANT_CC_RULES_IN_PROMPT=0 sweet-search init`.

## Owner commands (merge and release; nothing below was run)

Review and merge:
```sh
cd /Users/admin/Projects/sweet-search-private
git fetch origin ship-v1b
git log --oneline main..origin/ship-v1b
git diff main...origin/ship-v1b --stat
git checkout main && git merge --ff-only origin/ship-v1b   # main has not moved since 0e128ac6; else: git merge --no-ff origin/ship-v1b
git push origin main
```

Release (version number is your choice; the example uses 2.9.0):
```sh
npm version 2.9.0 --no-git-tag-version
npm install --package-lock-only
# npm 11 trap (memory: release-ci gotcha 3): re-inject {"optional":true} for every key of
# packages[""].optionalDependencies that lost its node_modules/<name> record, then check:
#   mkdir /tmp/lockcheck && cp package.json package-lock.json /tmp/lockcheck && (cd /tmp/lockcheck && npm ci --ignore-scripts --dry-run)
#   green = "added 411 packages"; anything else: do not tag.
git commit -am "release: 2.9.0 — Claude Code rules in the cached system prompt (V1b)"
git tag v2.9.0 && git push origin main v2.9.0
gh run list --limit 5          # release.yml + the two CUDA workflows start on the tag
# A green run is not proof of publication. Verify on the registry:
curl -s -H 'Cache-Control: no-cache' 'https://registry.npmjs.org/sweet-search?write=true' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)['dist-tags']))"
# After publish: npm install --package-lock-only again, so the published siblings resolve (gotcha 9).
```
If the tag run fails: cancel the two CUDA workflows at once (`gh run cancel <id>`), fix, then rerun them after the main publish.
