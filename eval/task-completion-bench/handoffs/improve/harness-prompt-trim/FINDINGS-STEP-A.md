# Harness prompt trim — Step A inventory and Step B switch (2026-09-25)

Follows `HANDOFF-HARNESS-PROMPT-TRIM.md`. Everything here cost $0. No rollout ran.

## 1. Conclusion

Trimming Claude Code's own request on the **sweet arm only** cuts its first request from
**18,942 to 10,101 Opus 5.5 tokens (−47%)** (final trim, §7). Native keeps Claude Code's full
prompt. A replay of the held-out Opus 5.5 medium turn logs, behaviour unchanged, predicts:

| | ideal cost v native | realized cost v native |
|---|---|---|
| sweet as shipped (measured) | +6.6% | +8.5% |
| sweet + trim (replay) | **−16.1%** | **−6.2%** |

The sweet arm itself gets 21.3% cheaper ideal and 13.6% cheaper realized. This part is a harness
diet that ships with sweet-search (an opt-in lean mode in `init`); the paper must still say that
it removes harness text, not that retrieval got better. The smoke measures what the replay
cannot: behaviour and solves.

The trim also removes the strongest retrieval contradiction found: an attachment that Claude
Code adds only in bypass-permissions mode, *"read files with cat, head, or sed -n, search with
grep and find"*. It matches the shell habits the sweet arm kept (252 shell searches, 204 shell
reads before the first edit). Whether removing it changes behaviour is what the smoke must show.

Three corrections to the handoff:

1. **Captures through a proxy overstate the tool block.** With a custom `ANTHROPIC_BASE_URL`,
   Claude Code cannot run its tool-search probe, so it sends every tool in full (20–21 tools,
   ~26,000 tokens). The real run defers most tools behind `ToolSearch`. The capture reproduces
   the real run only with **`CLAUDE_CODE_OAUTH_TOKEN` (dummy) + `ENABLE_TOOL_SEARCH=true`**.
   Validated against the box turn logs (§3).
2. **The static prefix IS reused across rollouts.** Every held-out rollout's first request read
   exactly 9,986 tokens from cache (tools + the two short system blocks; subscription uses a
   1-hour TTL). What is written per rollout (median 6,901 native, 9,206 sweet) is everything
   after that breakpoint: the main system block (it holds a per-rollout memory path), CLAUDE.md
   with the rules file, git status and the issue.
3. **The output style with `keep-coding-instructions: false` does not remove** *"Prefer the
   dedicated file/search tools over shell commands"*. It changes one sentence only (the intro).
   No supported mechanism removes that line; our 298-char override already counters it.

**Held-out discipline.** The smoke tasks come from `tasks_heldout.jsonl` (the first held-out
200, retired to DEV-RET on 2026-07-31). None is in HO2 (`tasks_heldout2.jsonl` + reserve), the
frozen 50 or the admitted 200. HO2 data was read only as totals (first-request token sizes,
the cost replay in §5). One exception, disclosed: to test the smoke parser, one HO2 sweet
transcript (`aaugustin__websockets-629`) was copied and parsed, and its per-task line was
printed. It was not used to design or tune anything; the copy was deleted.

## 2. What Claude Code 2.1.281 sends, sweet arm, real request shape

Captured as the runner builds it (`scripts/capture_cc_runner.mjs`: frame in CLAUDE.md, rules in
`.claude/rules/sweet-search.md`, `buildClaudeCliArgs` argv, effort medium), OAuth + tool search.
Tokens from the Anthropic `count_tokens` endpoint (free). 2.1.282 gives the same numbers ±5.

| condition | first request tokens | tools sent | cached prefix tokens | bash-first paragraph | skills list |
|---|---|---|---|---|---|
| native, as shipped | 16,599 | 12 (26,503 chars) | 9,698 | yes | yes |
| sweet, as shipped | 18,937 | 12 (26,503 chars) | 9,698 | yes | yes |
| sweet, `CC_HARNESS_TRIM=steer` | 18,886 | 12 | 9,814 | no | yes |
| sweet, `CC_HARNESS_TRIM=tools` | 10,472 | 5 | 3,562 | yes | no |
| **sweet, `CC_HARNESS_TRIM=1` (tools + steer)** | **10,424** | **5** | **3,678** | **no** | **no** |
| native, `CC_HARNESS_TRIM=1` (capture only — the runner never trims native) | 8,085 | 5 | 3,678 | no | no |
| **sweet, final trim** (above + 3 subagent types denied) | **10,101** | **5** | **3,678** | **no** | **no** |

Tools sent as shipped: Agent, Bash, Edit, ListAgents, Read, ReportFindings, ScheduleWakeup,
Skill, ToolSearch, Workflow, DeferredToolPlaceholder, Write; deferred by name: CronCreate,
CronDelete, CronList, EnterWorktree, ExitWorktree, NotebookEdit, RemoteTrigger, SendMessage,
TaskStop, WebFetch, WebSearch. After the trim: Agent, Bash, Edit, Read, Write. `RemoteTrigger`
exists only on the subscription route; it had to join the deny list, or it alone keeps
ToolSearch in the request.

The request also carries a second system-role message after the user turn (8,931 chars as
shipped) that the old capture did not show: environment, deferred tool names, the list of
subagent types, the skills list (~5,500 chars), and — in bypass mode only — the bash-first
paragraph. The trim leaves 2,116 chars of it.

## 3. Validation against the held-out box logs

`results/ho2-opus55-2026092*/turns/*.jsonl` on the box, first turn per rollout (n = 200 each):

| arm | first request tokens min / median / max | cached | written |
|---|---|---|---|
| native | 16,523 / 16,889 / 20,532 | 9,986 (median) | 6,901 (median) |
| sweet | 18,828 / 19,194 / 22,837 | 9,986 (median) | 9,206 (median) |

The capture counts (16,599 and 18,937, tiny repo, short git status) sit at the box minimums.
The proxy capture without tool search counts 25,991 — 7,000 tokens too many.

## 4. Contradicting or unused text, and what removes it

| text (where) | tokens (approx.) | removed by | shippable? |
|---|---|---|---|
| *"While bypass permissions mode is active: You can do much of your work through the Bash tool … read files with cat, head, or sed -n, search with grep and find …"* (system-role message; `bashFirst` attachment, feature `tengu_…`, variant `relaxed`) | ~120 | `CLAUDE_CODE_THRIFTY_SONIC=0`, or any permission mode other than bypass/auto | env var is **undocumented and internal** — research only. A user in default or acceptEdits mode never sees the paragraph. |
| Bash tool, added when the steer is OFF: *"IMPORTANT: Avoid using this tool to run cat, head, tail, sed, awk, or echo … use the appropriate dedicated tool"* | ~80 | nothing supported | it is Claude Code's normal-mode default |
| *"Prefer the dedicated file/search tools over shell commands when one fits."* (system, `# Harness`) | ~15 | only `--system-prompt-file` with an edited copy | no (Anthropic text). Our override already counters it. |
| Agent tool: *"…delegate it and you keep the conclusion, not the file dumps"*; agent list: Explore *"Read-only search agent for broad fan-out searches"*, general-purpose *"When you are searching for a keyword or file … use this agent"* | ~450 | `--disallowedTools "Agent(Explore)" "Agent(general-purpose)" …` removes the two agent entries (2,611 → 1,284 chars); the Agent line itself stays | yes (settings deny) — kept OUT of the trim on purpose: delegation is a real capability, and Opus 5.5 made 0 subagent requests |
| 16 unused tools + skills list + deferred-name list | ~7,900 | `--disallowedTools` / project `permissions.deny` | yes — as an opt-in "lean mode" in `init` only |
| `# Memory` section (~1,900 chars) | ~450 | nothing supported (`--exclude-dynamic-system-prompt-sections` only MOVES it into the first user message) | no |

`--exclude-dynamic-system-prompt-sections` moves 2,499 chars out of the system block into the
first user message. It changes cache reuse, not size, and applies to both arms; not in the trim.

## 5. Predicted saving from the diet alone (replay, $0)

Replay of the held-out turn logs with the harness's own cost formula (`ideal-cost.mjs`
`costFromTurns`, Opus 5.5 list prices), removing 6,020 cached-prefix tokens and 2,493 written
tokens from every request (the `CC_HARNESS_TRIM=1` deltas above), behaviour unchanged:

| arm | ideal cost, 200 rollouts | realized cost, 200 rollouts |
|---|---|---|
| native | $42.56 → $33.27 (−21.8%) | $38.46 → $33.25 (−13.5%) |
| sweet | $45.38 → $36.06 (−20.5%) | $41.74 → $36.50 (−12.6%) |

Ideal cost charges the whole first request at the full input rate, so fixed tokens weigh more
there. With the FINAL trim (§7: 6,020 cached-prefix + 2,821 written tokens removed) the sweet
arm replays at $45.38 → $35.70 ideal (−21.3%) and $41.74 → $36.08 realized (−13.6%).
**Pre-registered reading for the smoke:** sweet+TRIM v sweet is expected near −14% realized /
−21% ideal from the diet alone. Only a difference beyond that — or a drop in shell
search/read calls before the first edit — says anything about behaviour. At 12 rollouts, cost
is a direction, not a finding.

## 6. Codex 0.146.1 and opencode 1.18.4 (captured at $0, pinned versions installed side by side)

- **Codex**, sweet arm as `codex-task-runner.mjs` invokes it: base `instructions` 21,335 chars;
  AGENTS.md arrives as a separate user message. 11 tools, and the shell tool
  (`exec_command`) description has no steering. Steering is in the base prompt: *"When you
  search for text or files, you reach first for `rg` or `rg --files`"* and *"You parallelize
  tool calls … especially file reads such as `cat`, `rg`, `sed` …"*.
  **`model_instructions_file` REPLACES the base prompt** (verified byte-exact), set either with
  `-c model_instructions_file=…` or with a **project-level `.codex/config.toml`** (works in
  0.146.1 although `--help` names only `~/.codex/config.toml` — re-check on version bumps).
- **opencode**: GPT prompt + AGENTS.md = 19,739 chars, 8 tools; Claude prompt 18,703 chars,
  9 tools. The `bash` tool description (5,354 chars JSON, every model) says *"Avoid using Bash
  with the `find`, `grep`, `cat` … Content search: Use Grep (NOT grep or rg) · Read files: Use
  Read (NOT cat/head/tail)"*; glob/grep/task descriptions push *"use the Task tool instead"*.
  **`agent.build.prompt` in project `opencode.json` REPLACES the model-family prompt** and keeps
  AGENTS.md and the tools. **A built-in tool description cannot be changed by config**
  (`tools.bash` accepts only a boolean) — the sharpest contradiction needs a fork (MIT).

Captures: `captures/codex-0.146.1-request-*.json`, `captures/opencode-1.18.4-request-*.json`,
`captures/claude-code-2.1.281-oauth-toolsearch-*.json`.

## 7. Step B — the switch

`CC_HARNESS_TRIM` in `harness/claude-code-task-runner.mjs` (`claudeHarnessTrim`), default OFF:

- **Sweet arm only.** Native always runs untrimmed, whatever the switch says.
- unset / `0` → no argv, no env: byte-identical to the held-out legs (tested).
- `tools` → `--disallowedTools` + 16 tools + `Agent(Explore)`, `Agent(general-purpose)`,
  `Agent(statusline-setup)` (the two search-delegation entries and one unused type; the Agent
  tool and its catch-all type stay). Appended LAST: the flag is variadic.
- `steer` → `CLAUDE_CODE_THRIFTY_SONIC=0`.
- `1` → both. Any other value throws. Every row records `harnessTrim`.

The rules file, the override, the frame and `READ_PAGES_TOOL_NOTE` are untouched.

**Shippable form, verified by capture:** a project `.claude/settings.json` with
`permissions.deny` = the same 19 entries and `env.CLAUDE_CODE_THRIFTY_SONIC = "0"` produces a
request with identical tools and system blocks to the CLI flags (10,103 v 10,101 tokens; only
the temp path differs). Claude Code's base system block is NOT replaced: it holds one
contradicting sentence (~15 tokens), our override already counters it, and no supported
setting replaces it.
Tests: `node tests/claude-code-cost.mjs` (7 new assertions, all pass).

## 8. Mac traps found while preparing Step C (beyond the handoff's list)

1. **Unjailed Claude Code read the operator's own `~/.claude`** (global CLAUDE.md, memories,
   skills, plugins, hooks, MCP servers) and wrote transcripts where the cost reader never looks.
   Fixed: with `SS_ISOLATION=0` the runner sets `CLAUDE_CONFIG_DIR` to the private per-rollout
   home. Jailed runs are unchanged. Verified by capture: nothing from the operator's home appears.
2. **The Colima VM cannot reach Docker Hub's blob CDN** (TCP timeouts inside the VM; the host
   reaches the same hosts in ~10 ms; containers reach `registry-1` but not the CDN). Likely the
   host's VPN tunnels. Colima was NOT restarted — it runs the owner's long-lived containers.
   Workaround: `scripts/host_pull.py` downloads an image on the host (standard library only,
   digest-checked) and `docker load` imports it through the socket. Archives are kept in
   `~/.ss-eval/image-tars/`; the ledger sweep deletes loaded images, so reload before a run.
3. **The grader's patch folder was invisible in the VM.** `eval.py` makes it with Python
   `tempfile`; Colima shares only `$HOME`. Fix: `TMPDIR=$HOME/.ss-eval/tmp` (also covers the
   runner's `tmpdir()` state folder).
4. `DOCKER_HOST`: `run-pilot` defaults to the Colima socket, but `agent-runner-shared.mjs`
   defaults to `/var/run/docker.sock`, which does not exist on the Mac. Export it explicitly.
5. The SWE-rebench evaluator was not on the Mac: cloned to `~/swe-rebench-tools/SWE-rebench-V2`
   at the box's commit `c71902a8` (the runner uses its own patched `eval.py`).
6. **Subscription quota is shared.** The box's HIGH leg runs on the owner's Claude subscription.
   A Mac smoke through `claude setup-token` draws on the same usage limit.
