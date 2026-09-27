# Claude Code lean harness — shipped by `sweet-search init` (2026-09-26)

## UPDATE 2026-09-27: v2 = conflict-only trim (supersedes the v1 description below)

Owner decision: "Conflict-only, restore all". The harness must stay as good as stock for every
user. `init` now removes only what conflicts with the sweet-search rules, plus pure bloat.

| Item | v1 (below) | v2 (now) |
|---|---|---|
| Main agent body | 821-char coding prompt | 3,384-char paraphrase of the user-relevant stock guidance (safety, harness conventions, careful actions, request discipline, reporting). Only the "prefer the dedicated file/search tools" steer is left out. |
| Batching line | "an edit made with a short script …" | "… a build and the command that checks its result. Make file changes with Edit or Write." |
| `permissions.deny` | 16 tools + 5 agent types | `Agent(Explore)`, `Agent(claude)`, `Agent(sweet-search)` only |
| Plan subagent | denied | `.claude/agents/Plan.md` replaces it; it loads the rules (the built-in Plan does not) |
| `env` | 5 switches | `THRIFTY_SONIC=0`, `TOTAL_TOKENS_REMINDER=off`, `PARCHMENT_FERN=1` |
| Opt-out | uninstall only | `sweet-search init --no-lean-harness` (rules + output style only) |

Re-running init on a v1 install removes the deny and env entries v1 added (manifest-owned only).

$0 capture, Claude Code 2.1.281, `claude -p --model claude-opus-5-5`, default permission mode,
OAuth + tool search, first main request (body chars, ~tokens = chars/4):

| | system chars | tools (non-deferred) | body chars | ~tokens | rules in Plan subagent |
|---|---|---|---|---|---|
| stock | 6,053 | 12 | 50,477 | 12,619 | no |
| v1 lean | 1,291 | 5 | 18,920 | 4,730 | Plan denied |
| v2 lean | 3,854 | 12 (same as stock) | 46,608 | 11,652 | yes |

Known cost of the `agent` mechanism (by capture and binary reading): a custom main prompt drops
Claude Code's own `# Memory` instructions, `# Environment` notes and the gitStatus snapshot
(`omitGitStatus` is set for any custom prompt, and for any subagent named Plan or Explore).
Existing auto memories (MEMORY.md) still load. Removing `DISABLE_GIT_INSTRUCTIONS` does bring back
the Bash tool's `# Git` section and the commit-attribution reminder (both match stock); removing
`DISABLE_AUTO_MEMORY` does not bring back the `# Memory` instructions while the agent is active.
The v2 prompt asks for `git status` before a command that could discard uncommitted work.

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
