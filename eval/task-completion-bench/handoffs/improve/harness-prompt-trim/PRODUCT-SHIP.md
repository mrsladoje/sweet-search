# Claude Code lean harness — shipped by `sweet-search init` (2026-09-26)

## Conclusion

`sweet-search init` now installs the benchmark winner for Claude Code (`max-batch`) as plain
project files. The user types nothing extra. A $0 request capture shows that the files give a
request **byte-identical** to the benchmarked flag form. Subagents run the trimmed subagent
prompt and load the sweet-search rules, in `-p` mode and in the interactive terminal UI.

## What init writes

| File | Content |
|---|---|
| `.claude/agents/sweet-search.md` | main-session agent: our short base prompt (6 rules, the batching line included) + the 298-char routing override. It REPLACES Claude Code's base system prompt. |
| `.claude/agents/general-purpose.md` | replaces the built-in catch-all subagent with the trimmed subagent prompt |
| `.claude/settings.json` | `agent: "sweet-search"`; `permissions.deny` = 16 unused tools + `Agent(Explore/Plan/claude/statusline-setup/sweet-search)`; `env` = the 5 Claude Code switches of max-batch |
| `.claude/sweet-search-harness.json` | ownership manifest: what init added, so uninstall removes only that |

The texts live in `scripts/install-claude-lean-harness.js`. The benchmark runner imports them
from there, so the benchmark and the product cannot drift apart.

The old output style (`.claude/output-styles/sweet-search.md`) is removed while the lean
harness is active: the override now sits in the main-agent prompt. If the user selected their own
main agent (`agent` in settings or settings.local), or wrote their own
`.claude/agents/sweet-search.md`, init keeps theirs, warns, and falls back to the output style.

## Evidence ($0, Claude Code 2.1.281, scripts in `scripts/ship-probe/`)

| Check | Result |
|---|---|
| project settings `systemPrompt` key | ignored (request identical to stock) — not a usable route |
| output style with `keep-coding-instructions: false` | keeps ~2,600 chars of Anthropic's base prompt, including "Prefer the dedicated file/search tools" |
| settings `agent` + agent files + deny + env (`prodE`, built by the installer) v benchmarked `CC_HARNESS_TRIM=max-batch` | **0 differing lines** in both captured requests (after masking temp paths and the device id) |
| plain `claude -p`, default permission mode, fake model that launches one subagent | main: our prompt + override, 5 tools, rules loaded, no "Prefer the dedicated…" line. Subagent: our subagent prompt, rules loaded, 5 tools |
| interactive TUI (pty), same fake model | same as above; interactive adds `AskUserQuestion` and tool search (interactive-only) |

Request sizes (first request, chars): stock sweet 54,285; max-batch / shipped form 22,343.

## Benchmark mode

`CC_HARNESS_TRIM=product` installs the same files into each run dir (the override stays in the
runner's own `--append-system-prompt`, as in every mode), so the frozen-set run measures exactly
what ships. Existing modes are unchanged (constants compared byte-for-byte).

## What users lose (owner decision: ship by default)

Web search/fetch, skills, notebook editing, plan-mode subagent, worktrees, cron/remote triggers,
auto memory, git-status context. `sweet-search uninstall` restores all of it; so does deleting the
entries from `.claude/settings.json`.

## Risks

- Three env switches are internal Claude Code variables (`THRIFTY_SONIC`, `TOTAL_TOKENS_REMINDER`,
  `PARCHMENT_FERN`). An unknown variable is ignored, so a release that drops one loses only that
  saving. Re-run `scripts/ship-probe/probe.sh` on each new Claude Code release.
- Solve parity is measured on 20 rollouts per arm (confirm10). It rules out a large loss only.
