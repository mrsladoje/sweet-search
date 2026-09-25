# HANDOFF — trim the harness's own prompt and tools to cut cost (2026-09-25)

**Read this whole file before you act.** It is the entry point for a new session. Evidence is in
`captures/` and `scripts/` next to this file.

## 1. Goal, in one sentence

Find out whether removing the parts of the **harness's own** system prompt and tool list that
contradict sweet-search (or that a coding task never uses) makes the sweet-search arm cheaper, with
the sweet-search prompt and the benchmark frame kept **exactly** as they are now.

This is not about our own prompt. Our prompt, `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`
(the "M±" rules file) plus the 298-char Claude override from `scripts/install-claude-system-prompt.js`,
stays byte-identical in every condition of this work.

## 2. Why this matters now (the numbers behind it)

From the frozen held-out-2 leg **Claude Code 2.1.281 + Claude Opus 5.5, effort medium, 200 tasks**
(`handoffs/improve/slate-c/RESULT-HO2-OPUS55-200.md`, rows `results/ho2-opus55-200-unified-rows.json`):

- Solves 107 sweet v 103 native (McNemar p = 0.34). Cost **+8.5%** for sweet (95% CI +4.0..+13.3),
  **+9.5%** on the 100 both-solved tasks. Ideal-cache cost per solved task +2.7%.
- **0 subagent requests on either arm.** Tool calls equal: 7.6 v 7.5 per task.
- Phase split at the first edit (`scripts/phase_split.py`, run on the box):

  | phase | native | sweet | Δ | 95% CI |
  |---|---|---|---|---|
  | retrieval, up to first edit | $23.39 | $26.52 | +13.4% | +9.2..+18.0 |
  | fix + verify, after first edit | $15.16 | $15.16 | 0.0% | −8.7..+8.9 |

- Tool output read before the first edit is the same size on both arms (2.76 M v 2.78 M chars).
- The sweet first-turn context is **exactly +2,305 tokens** on every task (min 2,298, max 2,305).
  That is our rules file (6,005 chars) + override (298 chars) + Claude Code's wrapper header, as
  tokenised by the Opus 5.5 tokenizer. It is written to the prompt cache once per rollout
  (≈ 0.47 M extra cache-write tokens over 200 rollouts ≈ +$2.3), which explains most of the gap.
- Cost model for Opus 5.5 medium: **1,000 fixed prompt tokens ≈ $0.0067 per rollout ≈ 3.5% of a
  native rollout** (one cache write at $5/M + ~8 cache reads at $0.20/M; native ≈ $0.19/rollout).
- The sweet arm kept native habits: before its first edit it made 265 `ss-*` calls **and** 252
  shell searches (`rg`, `grep`, `find`) and 204 shell reads (`cat`, `sed -n`). Native used only the
  shell and never Claude Code's Read tool.

Hypothesis of this work: the harness text that tells the model to use its own tools (or to delegate)
is why the sweet arm searches twice; removing that text and the unused tools cuts fixed tokens
**and** duplicate calls.

## 3. What was found in the harness prompts (read `captures/` yourself)

### Claude Code 2.1.281 — exact request captured at $0 (`captures/claude-code-2.1.281-request-default.json`)

- System prompt: **5,756 chars** (`captures/claude-code-2.1.281-system.md`). Tool definitions:
  **46,597 chars, 20 tools**. The tool list is ~8× the prompt.
- **There is no Grep or Glob tool in 2.1.281.** Native search runs through Bash.
- Tools a single coding task never uses, by size (chars of JSON definition): SendMessage 5,800 ·
  Workflow 5,473 · ScheduleWakeup 5,017 · CronCreate 4,123 · EnterWorktree 4,069 · ExitWorktree 2,546 ·
  ReportFindings 2,283 · Skill 1,846 · NotebookEdit 1,679 · ListAgents 1,196 · WebSearch 880 ·
  WebFetch 872 · TaskStop 826 · CronDelete 445 · CronList 289. **Sum ≈ 37,300 chars, est. 9–10 k tokens.**
- **Verified at $0: a project `.claude/settings.json` with `permissions.deny` for those 15 tools
  removes them from the request** (20 → 5 tools: Agent, Bash, Edit, Read, Write; 46,597 → 9,253
  chars). `--disallowedTools` does the same. So this can ship through `sweet-search init` with no
  extra typing for the user.
- Retrieval-steering text that contradicts sweet-search:
  1. System prompt, `# Harness` section: *"Prefer the dedicated file/search tools over shell commands when one fits."* (`ss-*` run in the shell.)
  2. Agent tool description: *"…when answering would mean reading across several files — delegate it and you keep the conclusion, not the file dumps."* (pushes subagent fan-out — the cost driver on the Luna claude-code leg: 1,191 native v 150 sweet subagent requests.)
  3. Older builds carried a Grep tool with *"ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command."* — found as a string in the 2.1.281 binary but **not sent** in 2.1.281.
- Also in the system prompt and irrelevant to a benchmark task: the `# Memory` section (~1,900 chars)
  and the environment/model list.
- Caveat to resolve: native writes ~13,000 cache tokens in every rollout's retrieval phase, so the
  static prefix is **not** reused across benchmark rollouts. Find out why (the system block carries a
  per-session memory path and a billing header; see flag `--exclude-dynamic-system-prompt-sections`).
  A real user may get cache reads instead, which shrinks any saving. Measure; do not assume.

### Codex 0.146.1 (`captures/codex-0.146.1-base-instructions.md`, recorded in every rollout's `session_meta.base_instructions`)

- 17,731 chars. Retrieval lines: *"you reach first for `rg` or `rg --files`"* (contradicts) and *"prefer parallelization over sequential tool calls"* (fits). Everything else is personality,
  channels, formatting, destructive actions, and a 4,539-char skills section.
- Codex has **no search or read tools**; search runs through its shell tool. Its tool list was not
  captured yet.
- Replace the base prompt with `model_instructions_file` (Apache-2.0 allows an edited copy with notice).
  **Unverified:** whether a project-level config can set it, or only `~/.codex/config.toml`.

### opencode 1.18.4 (`captures/opencode-1.18.4-*`)

- Prompt chosen by model id (function in the binary): `gpt` (not codex) → GPT prompt (9,289 chars);
  `claude` → Claude prompt (8,212 chars); `gemini-` → Gemini prompt; etc. All six variants are in
  `opencode-1.18.4-all-prompts.json`.
- GPT prompt: *"prefer using Glob and Grep tools (they are powered by `rg`)"* (contradicts), plus
  *"build context by examining the codebase first"*, *"parallelize… file reads"* (fit).
- Claude prompt, ~1,400 chars of retrieval steering: *"When exploring the codebase… it is CRITICAL
  that you use the Task tool instead of running search commands directly"* (+2 examples), and *"Read
  for reading files instead of cat/head/tail… Reserve bash tools exclusively for actual system commands"*.
- **Bash tool description (all models):** *"Avoid using Bash with the find, grep, cat, head, tail,
  sed, awk, or echo commands… Content search: Use Grep (NOT grep or rg) · Read files: Use Read (NOT
  cat/head/tail)"*. Every `ss-*` call is a Bash call, so this is the sharpest contradiction found.
- Tool descriptions extracted: glob 517, grep 663, read 1,164, task 2,305, bash 2,714 chars.
- Replace the prompt with a custom agent prompt in project `opencode.json` (MIT). **Unverified:**
  whether an agent prompt replaces or appends to the model-family prompt, and whether the Bash tool
  description can be overridden without a fork.

## 4. How to see what a harness really sends — at $0

`scripts/capture_proxy.py PORT OUTDIR` is a tiny HTTP server that saves each POST body and answers
400. Point the harness at it; no model is called, nothing is billed.

Claude Code recipe used (box; adapt paths on the Mac). Use a **throwaway config dir and a fake key**
so the owner's login is never read or refreshed:

```bash
python3 capture_proxy.py 18777 /tmp/capture/cc &
cd /tmp/ccrepo   # a tiny git repo
env -i HOME=/tmp/ccx PATH=/usr/bin:/bin CLAUDE_CONFIG_DIR=/tmp/ccx \
  ANTHROPIC_BASE_URL=http://127.0.0.1:18777 ANTHROPIC_API_KEY=sk-ant-capture-dummy \
  IS_SANDBOX=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  claude -p "hello" --model claude-opus-5-5 --permission-mode bypassPermissions --output-format json
```

Do the same for Codex (a provider `base_url` in a temporary `CODEX_HOME`) and opencode (provider
`baseURL` in a temporary `OPENCODE_CONFIG`). **Capture the benchmark's own invocation** (the args
from `harness/claude-code-task-runner.mjs::buildClaudeCliArgs`, with the rules file and frame in
place) — a bare `hello` session is not the prompt the agent actually gets.

## 5. Work plan for the new session

### Step A — inventory at $0

1. Capture, for Claude Code **as the runner invokes it** (sweet arm): (a) as shipped, (b) with the
   15-tool deny list, (c) with our output style set to `keep-coding-instructions: false`
   (see `scripts/install-claude-system-prompt.js`), (d) with `--exclude-dynamic-system-prompt-sections`.
   For each: system chars, tool chars, and which of the contradicting lines survive.
2. Capture Codex and opencode the same way; add their tool lists to §3.
3. Write a table of every contradicting line, its tokens, and the supported mechanism that removes it.

### Step B — define the trimmed condition (Claude Code first)

Proposed **TRIM** = sweet arm exactly as now **plus**:
- deny the 15 non-coding tools (settings deny or `--disallowedTools`);
- neutralise the system-prompt line *"Prefer the dedicated file/search tools over shell commands"*.

Choose the mechanism for the second item after Step A. Options: output style with
`keep-coding-instructions: false` plus our own replacement coding text (shippable; check what else it
drops), or `--system-prompt-file` with an edited copy of the captured prompt (research only — do not
ship Anthropic's text; it is closed source and changes nearly every release).

Keep the **Agent tool** in TRIM (delegation is a real capability). If time allows, a later arm can
deny it too; report it separately.

Implement TRIM in `harness/claude-code-task-runner.mjs` behind an env switch (e.g. `CC_HARNESS_TRIM=1`),
**default OFF and byte-identical when OFF** (the medium and high held-out legs must stay reproducible).
Record the switch on every row. Do not change `READ_PAGES_TOOL_NOTE`, the override, the rules file,
or the frame.

### Step C — smoke on the owner's Mac (the box is busy)

**The box is running the Opus 5.5 HIGH frozen-200 leg** (`/root/ho2-opus55high-sup.sh`, runs
`ho2-opus55high-*`, prediction sealed in `slate-c/PREDICTION-HO2-OPUS55-HIGH.md`). **Do not start
anything on the box** that competes with it, and do not touch its login file.

Design the owner asked for:
- **Sweet arm only**, two conditions: **sweet as now** v **sweet + TRIM**. Same model
  (`claude-opus-5-5`, effort medium), same Claude Code build in both, `TASK_FRAME` on (the default
  `frame=ON`), default `MPP` (the p7-final rules file).
- **3 development tasks.** Load the `microsmoke` skill first: it asks for REPS ≥ 2, so plan
  3 tasks × 2 conditions × 2 reps = **12 rollouts**, reading solve flips first and cost second.
- **Never a held-out task.** Check every candidate against `select/HELDOUT2_FROZEN50.txt` and the
  admitted-200 list. Earlier dev smokes used these stock-image tasks (none in HO2):
  `sqlkata__querybuilder-557` (C#), `intel__rohd-458` (Dart), `jensneuse__graphql-go-tools-174` (Go,
  golden already on the Mac), `yargs__yargs-1422` (JS), `chaijs__chai-990` (JS); specs in
  `select/.cache/smoke-candidates.json`. Prefer small repos with quick tests (see the slow-test
  lesson below).

Mac-specific traps, all checked 2026-09-25:
1. **Claude Code version.** The Mac runs **2.1.282**; the held-out legs ran 2.1.281. Do not switch
   the owner's CLI (`claude install <v>` relinks `~/.local/bin/claude`). Either use 2.1.282 for both
   smoke conditions and record it, or install 2.1.281 side by side **and** restore the link. Ask
   the owner if unsure.
2. **Login.** On macOS the Claude login is in the Keychain, not `~/.claude/.credentials.json`, so the
   runner's credential-copy path does not work. Use `CLAUDE_CODE_OAUTH_TOKEN` (the owner runs
   `claude setup-token` in their own terminal — never paste the token into chat). The runner already
   prefers that variable and strips API keys.
3. **No jail on macOS.** Linux namespaces are not available; expect `SS_ISOLATION=0`. The agent then
   has open network. Equal for both conditions, but disclose it.
4. **Docker is aarch64**; the SWE-rebench images are x86-64 and run under emulation. Tests will be
   slower; a task can fail for emulation reasons. Run the env-ledger sweep locally first
   (`harness/env-ledger-sweep.mjs --tasks <specs> --out <dir>`, then `ENV_LEDGER=<dir>/ledger.jsonl`).
   **No run without a green ledger.**
5. **Goldens.** Only 1 of the 5 candidates has a golden on the Mac. Build missing ones **one at a
   time** (the Mac indexer saturates Metal and all cores on one repo; never parallel).
6. **Model contention.** CPU ORT and the GPU path must not run at the same time; stop leaked
   `ss-*` index-maintainer daemons before the run.
7. **Slow tests.** On the high leg's first task, Opus spent 25 min per arm waiting on `run_tests`
   (two 10-minute Bash timeouts) while model time was ~30 s. Pick tasks whose tests finish in
   seconds.

Prepare everything, run the $0 checks, then **stop and give the owner the exact launch command**
(policy: no paid or subscription run starts without the owner's explicit go).

### Step D — what to report

Per condition (aggregate over the 12 rollouts, and per task because these are dev tasks):
solve flips; cost (list and ideal-cache); first-turn context tokens; cache-write tokens; retrieval-
phase v fix-phase cost (`scripts/phase_split.py`); counts of `ss-*` v shell search v shell read v
Read-tool calls before the first edit; subagent requests. A result from 12 rollouts is a direction,
not a finding.

## 6. Rules that apply (from the owner's standing guidance)

- Dev tasks only for tuning. The held-out sets are read as totals only.
- Harness diet savings (tools any user could deny) are **not** a retrieval result. If shipped, the
  paper reports them separately from the sweet-search effect.
- Do not ship Anthropic's prompt text. Codex and opencode may be forked under their licences, with notice.
- Stripping user-facing features (web search, skills, scheduling, worktrees) must be an explicit
  opt-in "lean mode" in `init`, not a silent default. Discuss with the owner before building the
  product side.
- Commit and push straight to `main`. Replies to the owner: ASD-STE100 style, conclusion first.
