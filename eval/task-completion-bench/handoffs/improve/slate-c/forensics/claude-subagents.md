# Claude-code subagents: forensics on the sweet and native arms (slate C, "claude-subagents")

Date: 2026-09-02. Author: workflow forensics agent. Cost of this study: $0 (trace reading, static code reading, web documentation). Evidence box read-only; scratch under `/tmp/wf-slatec/claude-subagents/`.

Tags: `[M]` measured with a named script, `[C]` read from code, `[W]` web with URL, `[I]` inferred.

## 0. Verdict

Sweet delegates less on claude-code because `ss-search` occupies the slot where native spawns an `Explore` subagent. On the 15 tasks where native delegated, sweet's first substantive call was `ss-search` or `ss-grep` in 43 of 45 rollouts and `Agent` in 2; native's first substantive call was `Agent` in 22 of its 28 delegating rollouts, at a median call index of 2 `[M]`. Sweet's own nine delegations never changed a solve against their sibling reps and cost 2.5 to 4.5 times the non-delegating siblings on solved tasks `[M]`. When sweet does delegate, the built-in `Explore` subagent never sees the tool guide: Claude Code's `Explore` skips project memory by design `[W]`, and the measured first-request context of sweet and native `Explore` subagents is identical to within 20 tokens (5,353 vs 5,346 tokens background; 8,532 vs 8,524 foreground) `[M]`. General-purpose subagents do receive the guide (+1,516 tokens, 11,265 vs 9,749) and use `ss-*` correctly from call 1 `[M]`. Guide-less `Explore` subagents hunt for the binaries (13 hunt calls, 12 rejected `--help` calls), invoke 200 of 215 `ss-*` calls by absolute path, and fail 14.0% of `ss-*` calls against 4.8% in the main thread `[M]`. The diluted spend is small: at most $0.0255 of the $1.30 sweet arm on the tab run, that is at most 2.0% of arm cost or $0.00039 per rollout `[M]`. The largest new facts are not cost facts. First, the runner pins `SWEET_SEARCH_PROJECT_ROOT` to the parent checkout while subagents run in a git worktree, so a sweet subagent's `ss-*` calls read the parent's uncommitted edits while its `Read` calls see the clean tree; in two subagents 6 of 22 `ss-*` results echoed the parent's own edit, and one subagent reported that edit back as "the likely intended behavior" `[M]`. Second, without that pin (production), `ss-*` resolves its index from `cwd` and would fail with "no Sweet Search index" inside every worktree subagent `[C]`. Two $0-checkable vehicles would put the guide in front of subagents without prose: a project-level `.claude/agents/Explore.md` override written by `init` (sweet-only, production), and `--append-subagent-system-prompt` (Claude Code >= 2.1.205; the box runs 2.1.218) in the bench runner. Their cost ceiling on claude-code is about 2% of the sweet arm; on codex and opencode it is zero because neither harness delegated once in the fresh pool `[M]`.

## 1. Scope, data, method

### 1.1 Runs and denominators

| run | arm | rollouts | delegating rollouts | delegating tasks | subagent transcripts |
|---|---|---:|---:|---:|---:|
| `fp-claudecode-tab-20260826` (primary) | native | 66 | 28 (42.4%) | 15/22 | 33 |
| `fp-claudecode-tab-20260826` | sweet | 66 | 9 (13.6%) | 6/22 | 11 |
| `fp-claudecode-none-20260826` | sweet | 66 | 9 (13.6%) | 6/22 | 9 |
| `fp-claudecode-pipe-20260826` | sweet | 66 | 6 (9.1%) | 2/22 | 7 |
| `rb-claudecode-20260824` | native | 39 | 20 (51.3%) | 9/13 | 20 |
| `rb-claudecode-20260824` | sweet | 39 | 0 (0.0%) | 0/13 | 0 |

All counts `[M]` from `subagent-census.mjs` + `subagent-report.mjs`. The none and pipe runs hold one native cell each (`ls agent-state | grep -c -- -native` = 1), so native denominators come from the tab run only. `fixval-claude-code-20260828` has 36 rows with `sidechainTurns = 0` in both arms and no `agent-state` cells on the box, so the brief's remark that the fixval claude cell was "inflated by delegation" is not supported by rows.json `[M]`. Pooled sweet delegation across the three fresh-pool forms: 24 of 198 rollouts (12.1%).

Delegating tasks, tab run. Native: absinthe, accenture, aiohttp, apigee, aws-actions, awslabs, axelrod, b2-113, b2-259, celestiaorg, moq, markup-it, spectator, ariadne, solhint. Sweet: protoactor, awslabs, b2-113, b2-259, fastify-cors, final-form. Sweet rollouts that delegated (task, rep): protoactor r1; awslabs r0, r2; b2-113 r1, r2; b2-259 r0, r1; fastify-cors r0; final-form r2.

### 1.2 Method

- Transcripts: `results/<run>/agent-state/<task>-<arm>/claude-home/projects/<slug>/<session>.jsonl` (main) and `<session>/subagents/agent-<id>.jsonl`. Rep from the slug (`-r<rep>-<n>`).
- Requests: grouped by `message.id`; the usage-bearing record wins (the ledger's rule in `harness/claude-code-accounting.mjs`). Tool calls deduplicated by block id (the e4 parser rule).
- Relaunched rollouts leave two main transcripts for one rep. Six such pairs exist in the tab run (aiohttp sweet r1 `4d458300`, r2 `6aba98e9`; fastify sweet r0 `14462bd2`; solhint native r2 `6cab3715`; solhint sweet r0 `46db02ec`, r2 `3e9be42b` were dropped). Match rule: keep the transcript whose main-plus-subagent call count equals `row.calls`, else the one whose ideal cost equals `row.idealCostUsd`. Never the longest.
- Cost: the ledger's `costFromTurns` from `harness/ideal-cost.mjs` at the registered luna price (in 0.10, cache 0.01, out 0.60 per million). "Ideal" = cache-normalized. Zero-usage requests are imputed from neighbouring requests (mean of the previous and next context size, median output of that subagent) and always labelled imputed.
- Subagent link to its `Agent` call: `toolUseResult.agentId` on the parent's tool-result record, or prompt-text equality.
- Scripts (part of the evidence): `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-claude-subagents/subagent-census.mjs` (runs on the box; writes `/tmp/wf-slatec/claude-subagents/census-<run>.json`), `subagent-report.mjs` (local; prints the tables), `subagent-extras.mjs` (box; pages waste, first-user-record shape, parent-edit echo). Census JSON copies are under `scripts-claude-subagents/data/`.

Note: the Claude Code version on the box is 2.1.218 in 6,291 transcript records `[M]`. The delegation tool is named `Agent` in this version, not `Task`.

## 2. Sweet-arm subagents (tab run: 11 transcripts; pooled fresh pool: 27)

### 2.1 Tools, first request, guide visibility, per subagent (tab run)

| task rep | agent id | type | bg | req (usage) | first-request context | ss calls (bare/abs) | hunt | `--help` | raw shell | Read | ss fails | pre-ss requests | pre-ss $ | subagent $ (imputed) | guide visible |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| protoactor r1 | a3d311866bfc0b7cb | Explore | yes | 14 (10) | 5,353 | 15 (0/15) | 1 | 2 | 3 | 5 | 0 | 5 | 0.003603 | 0.012902 | no |
| awslabs r0 | a0d415047c0776a3e | Explore | no | 11 (4) | 15,967* | 5 (0/5) | 2 | 3 | 4 | 9 | 1 | 7 | 0.004125 | 0.006693 | path only** |
| awslabs r2 | a484cf2677177e8ef | Explore | no | 15 (6) | 8,532 | 18 (0/18) | 1 | 3 | 3 | 0 | 2 | 4 | 0.003171 | 0.008548 | no |
| b2-113 r1 | abd536db90e42b25d | Explore | yes | 58 (37) | 5,360 | 49 (0/49) | 2 | 1 | 0 | 5 | 1 | 4 | 0.001370 | 0.084950 | no |
| b2-113 r2 | a41e46d3e2671aa14 | Explore | no | 34 (13) | 8,542 | 40 (0/40) | 2 | 1 | 1 | 18 | 1 | 4 | 0.001729 | 0.018362 | no |
| b2-259 r0 | a04ad28e63dd30186 | Explore | no | 54 (29) | 8,710* | 59 (0/59) | 1 | 0 | 0 | 1 | 2 | 1 | 0.000960 | 0.060623 | no |
| b2-259 r0 | a8d5f1d037a62e83b | general-purpose | no | 74 (36) | 11,268 | 57 (57/0) | 0 | 0 | 0 | 15 | 3 | 0 | 0 | 0.074067 | yes (inferred) |
| b2-259 r0 | a914bc3d20e9a67cc | general-purpose | no | 41 (24) | 11,265 | 32 (32/0) | 0 | 0 | 0 | 10 | 3 | 0 | 0 | 0.026250 | yes (inferred) |
| b2-259 r1 | abf1061910955a4c6 | Explore | yes | 30 (21) | 5,366 | 15 (15/0) | 3 | 0 | 5 | 11 | 1 | 4 | 0.001821 | 0.014418 | no |
| fastify r0 | a61852622b2fb2c36 | general-purpose | no | 18 (12) | 12,540* | 13 (13/0) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.009255 | yes (inferred) |
| final-form r2 | a38e681945774a613 | Explore | yes | 15 (7) | 7,581* | 13 (0/13) | 1 | 2 | 2 | 13 | 1 | 2 | 0.001416 | 0.012041 | no |

`*` The first request of that transcript carries no usage; the size shown is the first usage-bearing request and is larger than the true first request. `**` The only visible guide marker in any sweet subagent context was the path `.claude/rules/sweet-search.md` inside a `find /root -name 'ss-*'` listing; the guide text itself never appeared in any user-side record (delegation prompt, tool result, attachment) of any of the 27 sweet subagents across the three forms `[M]`. "yes (inferred)" for general-purpose rests on two measurements: the +1,516-token first request against a native general-purpose subagent with the same background flag, and correct bare `ss-*` syntax from call 1 with zero hunting.

Totals, tab run sweet subagents `[M]`: 364 requests (199 with usage, 165 zero-usage); Bash 385 = `ss-*` 317 + `--help` 12 + hunt 13 + raw shell 31 + git 11 + test 1; Read 87; SendMessage 17; Grep 0; Glob 0. `ss-*` invoked bare 117, by absolute path 200 (63%). Non-zero exit on 36 of 317 `ss-*` calls (11.4%). Delegation prompts: 11 of 11 mention `ss-*`, 5 of 11 say "per sweet-search rules" or "per repository instructions", 0 of 11 contain the guide (prompt lengths 176 to 293 characters; the guide file is 6,433 bytes) `[M]`. The guide's own sentence "Any sub-agent you delegate to must use these `ss-*` tools, with this system prompt verbatim" (`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md:24` `[C]`) was therefore half-obeyed 27 of 27 times across the three forms (26 prompts mention `ss-*`, 1 does not) and fully obeyed 0 of 27 times.

Split by subagent type, tab run `[M]`:

| type | n | ss calls | fails | fail rate | abs-path | bare | hunt | `--help` | raw shell | Read |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Explore (guide-less) | 8 | 215 | 30 | 14.0% | 200 | 15 | 13 | 12 | 31 | 62 |
| general-purpose (guide present) | 3 | 102 | 6 | 5.9% | 0 | 102 | 0 | 0 | 0 | 25 |
| main thread, for comparison (66 rollouts) | — | 777 | 37 | 4.8% | 0 | 777 | 0 | 0 | — | — |

Failure classes of the 36 subagent `ss-*` failures `[M]` (box one-liner, first line of each non-zero-exit result, no repository content): `--help` rejected as "unrecognised option" 10; `--in` not accepted by `ss-trace`/`ss-find` 7; an extra positional path "not consumed" 8 (the subagent passed its worktree path or a directory as an extra argument); grep-style flags `-iE`, `-E`, `-iname` 4; `--full` 3; `--start/--end` on `ss-read` 1; ENOENT 1; other 2. Every class is a syntax guess made without the guide. The general-purpose subagents' 6 failures were the positional-path and `--in` kinds, which the 2026-08-28 hygiene commit `36b802e` addressed after this run.

### 2.2 First-request context: where the guide does and does not go

Subagent first requests cluster by the background flag, because background subagents carry a reduced tool schema `[W]`: about 5,350 tokens (background) and about 8,530 tokens (foreground) for `Explore` in both arms. Within the same flag `[M]`:

| subagent type, flag | native first request | sweet first request | delta |
|---|---:|---:|---:|
| Explore, background | 5,346 to 5,366 (n=13) | 5,353 to 5,366 (n=3) | 0 |
| Explore, foreground | 8,524 to 8,562 (n=6) | 8,532 to 8,542 (n=2) | 0 |
| general-purpose, foreground | 9,749 (n=1) | 11,265 to 11,268 (n=2) | +1,516 |
| general-purpose, background | 6,578 to 6,592 (n=2) | — | — |
| main thread (first request) | 17,275 to 19,302, median 17,525 (n=66) | 18,845 to 20,872, median 19,095 (n=66) | +1,570 |

Reading: the main thread's +1,570 tokens are the guide (1,457 tokens per the brief) plus the appended override sentence. The general-purpose subagent's +1,516 is the same guide, delivered through the project rules file. `Explore` gets nothing. This matches the documentation: a non-fork subagent's context includes "every level of the CLAUDE.md hierarchy the main conversation loads, including ... project rules ... The built-in Explore and Plan agents skip this", and its system prompt is "the agent's own prompt plus environment details that Claude Code appends, not the Claude Code system prompt" `[W https://code.claude.com/docs/en/sub-agents]`. The runner's `--append-system-prompt` (the override sentence pointing at `.claude/rules/sweet-search.md`, `harness/claude-code-task-runner.mjs:52-58` `[C]`) therefore reaches no subagent of any type.

## 3. Native-arm subagents (tab run: 33 transcripts; rebaseline: 20)

Types, tab run `[M]`: Explore 30 (requested model haiku 19, sonnet 11; background 19, foreground 11), general-purpose 3 (sonnet; 2 background). All 33 ran in a git worktree under `<rundir>/.claude/worktrees/agent-<id>` with `isolation: "worktree"` set in the `Agent` call input; the frame, the runner, and the guide never mention worktrees `[C]`, so the choice is the model's and the tool schema's.

Delegation prompts, tab run, full text classified on the box `[M]`: 33 of 33 are read-only exploration requests ("find/inspect ... report exact files/functions and likely minimal fix ... do not edit"); 0 ask for edits; 2 use the phrase "hidden-test expectations" (the agent's own wording); lengths 116 to 329 characters. Examples (agent's words, truncated): "Find the source implementation and tests relevant to introspection rendering of input default values ... Report exact files/functions and likely minim" (absinthe r1, `aa2de5f7788e9a8e0`); "Search source for install/stage logic and <build>no handling. Identify likely bug and exact minimal source edit; do not modify files" (b2-113 r0, `aa5fe81bbe593a6bd`).

Requests and cost, tab run `[M]`: 519 requests, 314 with usage, 205 zero-usage (39.5%); no transcript is ledger-complete. Recorded ideal cost $0.2987; imputed $0.4210 (+41%). Per subagent: median $0.0110 imputed ideal (p25 $0.0091, p75 $0.0145), median 14 requests. Main-thread ideal cost of the native arm $1.0117; sidechain share 29.4%; per rollout main-only $0.015329, inclusive $0.021709 (brief: $0.021558 realized, labelled a lower bound). Tools inside native subagents: Bash 347 (raw shell 278, git 63, test 2, other 4), Read 590, SendMessage 67, WebSearch 7, WebFetch 4, TaskUpdate 2, Skill 2; Grep 0 and Glob 0 (Explore searched with Bash `grep`/`rg`/`find` and read with `Read`). Parent-side `toolUseResult` carries `totalTokens`, a `usage` block, and `toolStats` for 12 of 33 (foreground only); that `usage` is the subagent's last request, not a sum (`a2642f4b5a3101b3d`: 3 + 223 + 162,828 + 525 = 163,579 = `totalTokens`) `[M]`, so it cannot fill the zero-usage hole.

Rebaseline `rb-claudecode-20260824` `[M]`: native 20 subagents (Explore 19, general-purpose 1), 290 requests (103 zero-usage), imputed ideal $0.2353, sidechain share 30.5%, first `Agent` call at median call index 2; sweet 0 subagents in 39 rollouts.

Pages waste inside subagents (`subagent-extras.mjs`) `[M]`: native tab 120 failed `Read` calls with `pages: ""` in 33 subagents; 22 whole requests carried nothing else, $0.0186 = 4.4% of native sidechain spend = 1.3% of the native arm. Sweet tab: 18 failed Reads, 9 requests, $0.0058 (0.44% of the arm). Rebaseline native: 64 failed Reads, 9 requests, $0.0068. The `READ_PAGES_TOOL_NOTE` lives in the parent's `--append-system-prompt` (`claude-code-task-runner.mjs:43-58` `[C]`) and reaches no subagent; the PreToolUse hook is inert by the runner's own record.

## 4. Is sweet's lower delegation rate caused by `ss-search` substituting for an Explore subagent?

Yes for the bulk of the gap; a residual friction effect from the guide sentence cannot be excluded at $0.

Opening move, tab run, the 15 tasks where native delegated `[M]`:

| arm | rollouts | first substantive call (after `TaskCreate`/`TaskUpdate`/`run_tests`) |
|---|---:|---|
| native, delegating rollouts | 28 | `Agent` 22; raw shell (`pwd`/`find`/`ls`) 6; `Read` 0 |
| native, all rollouts on those tasks | 45 | raw shell 22; `Agent` 22; git 1 |
| sweet, all rollouts on those tasks | 45 | `ss-search` 39; `ss-grep` 4; `Agent` 2 |

Native's first `Agent` call sits at median call index 2 (min 1, max 17) in the 28 delegating rollouts; 26 of 28 had issued no `Read` and no `grep` before it. In other words native treats "understand the repo" as a coin flip between exploring itself with shell and delegating to `Explore`, and sweet answers the same need with one `ss-search` call 96% of the time. The native `Explore` prompts (section 3) ask for exactly the thing `ss-search` returns: the file, the function, the candidate fix location.

Sweet's nine delegations `[M]`: four were opening moves (protoactor r1 call 3, awslabs r2 call 2, b2-113 r2 call 3, final-form r2 call 3) and five were late fallbacks after 1 to 15 `ss-*` calls (b2-259 r1 call 4, b2-113 r1 call 7, awslabs r0 call 15 after two `Edit`s, fastify r0 call 15 after three `Edit`s, b2-259 r0 call 18). Four of the six delegating tasks (b2-113, b2-259, fastify-cors, awslabs) are hard or dead in every cell; sweet reaches for a subagent when `ss-*` exploration stalls.

Outcome and cost of sweet's delegations against sibling reps (inclusive, imputed ideal) `[M]`: protoactor r1* $0.0190 vs r0 $0.0044 and r2 $0.0042, all solved; awslabs r0* $0.0158 and r2* $0.0268 vs r1 $0.0070, all solved; final-form r2* $0.0216 vs $0.0058 and $0.0058, all solved; b2-113 r1* $0.1218 and r2* $0.0398 vs r0 $0.0276, all failed; b2-259 r0* $0.1946 and r1* $0.0439 vs r2 $0.0540, all failed; fastify r0* $0.0254 vs $0.0088 and $0.0124, all failed. Delegation changed no solve in 6 of 6 tasks and cost 2.5 to 4.5 times the siblings on the solved tasks.

Price of the two paths `[M]`+`[I]`: one native `Explore` subagent costs a median $0.0110 and 14 requests, about 75% of a whole sweet main-thread rollout ($0.0147). One `ss-search` in the main thread is one request; its result (about 1.7k tokens, `used=1769` in the sample header) is re-sent at the cache rate for the rest of the rollout, about $0.0005 including ingest `[I]`. The claude-code cell's sweet advantage, which the brief attributes entirely to native's subagent spend, is this substitution.

What this analysis cannot separate at $0: the guide's sentence "Any sub-agent you delegate to must use these `ss-*` tools, with this system prompt verbatim" adds friction to delegating. The model half-obeys it (26 of 27 prompts mention `ss-*`) and never fully obeys it (0 of 27 carry the guide). Sweet still delegates on hard tasks, so the friction is not absolute. Separating the two effects needs a guide ablation, which is a paid run. The rebaseline run (sweet 0 of 39, native 20 of 39) shows the same pattern on a different task pool `[M]`.

## 5. Diluted spend when sweet subagents lose the guide

Tab run, 11 sweet subagents `[M]`:

- Pre-first-`ss-*` phase (hunting, `--help`, raw shell, Read before the first working `ss-*` call): 31 requests, $0.0182 ideal (imputed) = 1.40% of the sweet arm's inclusive $1.3009.
- Requests whose every `ss-*` call failed after that: 15 requests, $0.0073 = 0.56% of the arm. The two sets can overlap (a rejected `--help` call is in both), so the union is at most $0.0255 = 2.0% of the arm = $0.00039 per rollout.
- Absolute-path invocation overhead: 200 calls times about 14 output tokens = about 2,800 output tokens = $0.0017 = 0.13% of the arm `[I]`.
- Pooled over the three forms (27 subagents): pre-`ss-*` $0.0332 + failed-`ss-*` $0.0215 over $3.5062 of sweet arm cost = at most 1.56% `[M]`.

The sidechain as a whole is 25.2% of the sweet arm ($0.3281 imputed; $0.1977 recorded), so the dilution is at most 8% of what sweet spends on subagents. Removing the dilution does not change the arm ranking; it lowers sweet's claude-code inclusive cost from $0.019710 to about $0.019324 per rollout `[I]`.

What a guided subagent looks like: the three general-purpose subagents that had the guide made 102 bare `ss-*` calls, 0 hunts, 0 `--help`, 0 raw shell, and failed 5.9% of calls, the same rate as the main thread `[M]`.

## 6. Side findings

### 6.1 Worktree isolation plus a pinned project root gives one subagent two views of the tree

The runner exports `SWEET_SEARCH_PROJECT_ROOT = rundir` for the whole `claude` process (`harness/agent-runner-shared.mjs:134-142` `[C]`). Every subagent ran in `<rundir>/.claude/worktrees/agent-<id>` (44 of 44 `[M]`). The worktree is a fresh checkout of the default branch; with no remote it falls back to local HEAD `[W https://code.claude.com/docs/en/worktrees]`; it has no `CLAUDE.md`, no `.claude/`, and none of the parent's uncommitted edits (the subagent's own `find . -maxdepth 2` listing shows this `[M]`, `a0d415047c0776a3e`). So inside a sweet subagent, `ss-search`/`ss-read` read the parent's working tree including its edits, while `Read` and `grep` see the clean worktree. In the two late-delegation subagents whose parent had already edited, 2 of 9 (awslabs r0, `a0d415047c0776a3e`, parent edits 2) and 4 of 13 (fastify r0, `a61852622b2fb2c36`, parent edits 3) `ss-*` results contained lines the parent had written with `Edit` before delegating `[M]` (`subagent-extras.mjs`, `circular`). The awslabs subagent's final report calls the parent's edit "a stale/alternate implementation of `MetricsContext` containing the likely intended behavior" and recommends it (parent record `toolUseResult.content`, `f6d0427f-f063-4441-83bd-3be0c6710a86.jsonl`) `[M]`. Both tasks ended as their siblings did (awslabs solved, fastify failed), so 0 solves changed; this is a coherence hazard, not a measured loss.

### 6.2 In production, `ss-*` has no index inside a worktree subagent

`eval/agent-read-workflows/bin/_ss-helpers.mjs:136-142` `[C]`: `PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd()`, then a hard error `[ss-*] no Sweet Search index at <root>/.sweet-search/codebase.db` when the file is missing. `_ss-env.sh` does not set the variable `[C]`. Real Claude Code users get worktree-isolated subagents whenever the model or a frontmatter asks for them; in those subagents every `ss-*` call fails at once, and the bench never saw this because the runner's pin masked it. Sweet-only product defect; static reading only, not reproduced live.

### 6.3 Zero-usage requests and the sidechain lower bound

205 of 519 native and 165 of 364 sweet subagent requests carry no usage in the tab run `[M]`. Neighbour imputation raises native sidechain spend from $0.2987 to $0.4210 (+41%) and sweet's from $0.1977 to $0.3281 (+66%). The parent-side `toolUseResult.usage`/`totalTokens` is the last request's usage, not a sum (section 3), so it cannot replace the missing records; it does bound every missing request's context from above. Inclusive per-rollout ideal cost with imputation: native $0.021709, sweet $0.019710 (sweet -9.2%); recorded-only: native $0.019854, sweet $0.017735; main-only: native $0.015329, sweet $0.014739 (-3.8%, a confounded cut because native's main threads are cheap where a subagent did the work) `[M]`.

### 6.4 The requested subagent model was priced at the backbone's rate

Native asked for `haiku` in 19 of 33 subagents (273 requests, $0.2375 imputed = 56.4% of native sidechain spend) and `sonnet` in 14; sweet asked for `haiku` in 6 of 11 ($0.1192 = 36.3%) `[M]`. The proxy resolved all of them to `openai/gpt-5.6-luna` (`resolvedModel` in `toolUseResult`) and the ledger priced them at luna's rate. On Anthropic list ratios (Haiku 4.5 at 0.2 times an Opus-class price or 0.33 times a Sonnet-class price per token), native's inclusive cost would be $0.01883 to $0.01930 per rollout and sweet's $0.01827 to $0.01850; sweet's margin narrows from -9.2% to -3.0% or -4.1% but keeps its sign `[I]`. The headline is therefore pricing-dependent but not sign-fragile.

### 6.5 Delegation exists only on claude-code in this bench

`fp-opencode-tab-20260826` and `fp-codex-tab-20260826` contain zero tool parts named `task`, `Task`, `agent`, `Agent`, or `subagent` in either arm `[M]` (opencode sweet tool census: bash 975, todowrite 237, apply_patch 122, glob 27, read 12). Every mechanism below is claude-code-only.

## 7. $0-checkable mechanisms

Owner rules respected: no new tool is proposed; the guide's guidance block is not trimmed; nothing here changes the gutter.

### M1. `init` writes a project-level `.claude/agents/Explore.md` that overrides the built-in Explore

- Mechanism: Claude Code resolves same-named subagents by location priority, project `.claude/agents/` above user and plugin definitions, and the documentation's own example overrides `Explore` `[W https://code.claude.com/docs/en/sub-agents]`. A custom agent's body is its system prompt, so the guide (1,457 tokens) plus a short "explore and report, do not edit" prompt would reach every Explore subagent as system text. Frontmatter: `tools: Bash, Read, Grep, Glob` (Bash is required for `ss-*`), `model: inherit`, no `isolation`.
- Vehicle: `scripts/init.js` via a sibling of `write-claude-rules.js`; today init writes only `.claude/rules/sweet-search.md` and the output style `[C]`. Sweet-only in the bench (only the sweet arm carries init artifacts) and in production.
- Harnesses: claude-code only.
- Ceiling per harness: claude-code at most 2.0% of the sweet arm ($0.00039 per rollout) if delegation frequency stays the same; likely smaller because a custom Explore loads the CLAUDE.md hierarchy (frame about 754 tokens `[C]` chars/4 of `FRAME_OPEN`+`FRAME_CLOSE`) and the guide on every request, about $0.0005 per subagent at cache rate against about $0.0032 of dilution saved per Explore subagent `[I]`. Codex and opencode: 0.
- $0 falsifier and pre-registered kill: re-run `subagent-census.mjs` on any new claude-code run and compute Explore-subagent `ss-*` failure rate, hunt and `--help` counts, and bare share; kill as a cost lever if pooled dilution stays under 1% of the arm (it already is 1.56% pooled, so treat M1 as hygiene, not a cost lever). Second falsifier before any paid run: confirm on a local Claude Code >= 2.1.218 that `.claude/agents/Explore.md` is listed as the active Explore definition (the `/agents` listing needs no model call).
- Register check: nearest F15 ("delegation for sweet on claude-code REJECTED"); different because M1 adds no delegation, it stops paying a tool-discovery tax when the model delegates anyway. Nearest B2/B3 (guide size or presence in the main thread); different because M1 changes where the guide reaches, not its length.
- Flags: `new_tool: false`; `needs_user_decision: no` for the file itself, but note it adds one file to the user's `.claude/agents/`.
- Risk: the override replaces the built-in Explore prompt; the fast-exploration wording must be re-supplied in the body. Whether the model's `isolation: worktree` argument still applies is unknown `[I]`.

### M2. Bench runner passes `--append-subagent-system-prompt`

- Mechanism: the flag appends text to every subagent's system prompt, nested subagents included, in `-p` mode; requires Claude Code >= 2.1.205 `[W https://code.claude.com/docs/en/cli-reference]`; the box runs 2.1.218 `[M]`. Two payloads: (a) sweet arm only, the override sentence plus the guide, so that bench subagents match what M1 gives production; (b) both arms, `READ_PAGES_TOOL_NOTE`, so that subagents stop wasting requests on `pages: ""` (native 22 requests, $0.0186, 1.3% of the arm; sweet 9 requests, $0.0058).
- Vehicle: `harness/claude-code-task-runner.mjs` `buildClaudeCliArgs`. Part (a) is sweet-only differential; part (b) is a shared harness setting with zero differential that lowers the native baseline, so it changes the headline against sweet.
- Harnesses: claude-code only. Ceiling: (a) as M1; (b) native -1.3%, sweet -0.44% of arm.
- $0 falsifier: none needed for existence (documented and version-gated); kill (a) if a bench run shows the guide text in subagent first requests and Explore failure rate unchanged.
- Register check: (b) extends D4 ("Read empty pages FIXED both arms"): not fixed inside subagents. (a) not on the register.
- Flags: `new_tool: false`; `needs_user_decision: yes` (harness change touching both arms' baseline; the runner's own comments record a settled position on the pages hook that a new vehicle would reopen).

### M3. Worktree-aware project-root resolution in the `ss-*` wrappers

- Mechanism: when `cwd` has no `.sweet-search/codebase.db` and `git rev-parse --git-common-dir` resolves to another checkout, use that checkout's index and print one header line stating which tree the index reflects; or refuse with a hint naming the main checkout. Fixes 6.2 (production: no index in worktrees) and makes 6.1 visible to the agent.
- Vehicle: `eval/agent-read-workflows/bin/_ss-helpers.mjs` PROJECT_ROOT resolution. Sweet-only product fix.
- Harnesses: claude-code (the only harness with worktree subagents here); any harness that runs agents in worktrees.
- Ceiling: correctness, not cost; 0 solves changed in the bench because the runner's pin hid the failure.
- $0 falsifier: static reading is already conclusive `[C]`; a no-model local reproduction (`git worktree add`, run `ss-grep` from inside) confirms the error text. Kill if Claude Code stops offering worktree isolation to subagents.
- Register check: nearest E2 (hygiene package); none of E2's six items concerns `cwd` or worktrees.
- Flags: `new_tool: false`; `needs_user_decision: no`.

### M4. `ss-* --help`/`-h` prints usage with exit 0, and the wrappers accept the aliases guide-less callers guessed

- Mechanism: today `--help` exits 2 with `[ss] unrecognised option "--help"` and prints usage anyway; `ss-read --help` says the flag "looks like a flag, but ss-read takes a file path first" `[M]`. Guide-less subagents spent 12 calls on `--help`, 7 on `--in` for `ss-trace`/`ss-find`, 4 on grep-style flags, 3 on `--full`, all rejected. A working `--help` is the cheapest self-description for any caller that never saw the guide.
- Vehicle: `eval/agent-read-workflows/bin/_ss-argparse.mjs`. Sweet-only.
- Harnesses: all three in principle; measured demand exists only on claude-code (0 delegations elsewhere).
- Ceiling: at most the failed-`ss-*` request cost, $0.0073 = 0.56% of the claude sweet arm.
- $0 falsifier: recount `--help` and unknown-flag failures with `subagent-census.mjs` after the change on the next run; kill if it removes fewer than half of them.
- Register check: an E2-class addition; `--help` is not among E2's items.
- Flags: `new_tool: false`; `needs_user_decision: no`.

Not recommended: rewording the guide's "with this system prompt verbatim" sentence. It is prose the model half-obeys today; instruction-following levers are recorded dead on this backbone (A1, A6), and the guidance block is owner-protected. M1 and M2 deliver the same content without asking the model to copy 6 kB into a prompt.

## 8. Novelty against the draft register

| # | finding | novelty | nearest register entry |
|---|---|---|---|
| F1 | `ss-search` occupies native's Explore slot (43/45 vs 22/45 opening moves); sweet's delegations are late fallbacks on dead tasks | extends | F15, E10 ("sweet's win is not needing to delegate") now has a measured mechanism |
| F2 | The guide never reaches built-in Explore subagents (identical first-request size, docs) and does reach general-purpose ones (+1,516 tokens) | new | none (B2/B3 concern the main thread) |
| F3 | Guide-less subagents: 63% absolute-path calls, 14.0% `ss-*` failure vs 4.8% main, 13 hunts, 12 rejected `--help`; dilution at most 2.0% of arm | new | none |
| F4 | Worktree isolation + pinned project root: two views of the tree; 6 of 22 `ss-*` results echoed the parent's own edit; production would see "no index" | new | E2 (hygiene) is the nearest class |
| F5 | `pages: ""` waste inside subagents both arms (native 22 requests, 1.3% of arm) | extends | D4 |
| F6 | Zero-usage requests: imputation +41% native / +66% sweet sidechain; parent `toolUseResult.usage` is last-request only | extends | G6 |
| F7 | 56% of native sidechain spend was on haiku-requested subagents priced at luna rate; margin -9.2% to -3.0/-4.1% under list ratios, sign kept | new (measurement trap) | G1/G6 |
| F8 | Sweet delegation changed 0 of 6 task outcomes and cost 2.5 to 4.5 times siblings on solved tasks | extends | F15 |
| F9 | Codex and opencode never delegated in the fresh pool | new (scope fact) | none |

## 9. Traps met in this study

1. The bench rundir path contains `.ss-eval`; any `ss-` substring test for tool hunting matches ordinary `find /root/.ss-eval/...` commands. My first census counted 35 phantom hunts in native subagents; the fixed regex requires `command -v ss-`, `-name 'ss-*'`, or a listing of the wrappers' `bin` directory.
2. A relaunched rollout leaves two main transcripts for one rep; six pairs in the tab run. Match by `row.calls` (main plus subagent calls) or `idealCostUsd`, never by length.
3. Subagent first-request sizes cluster by background flag (about 5.35k background, about 8.5k foreground). Compare arms within the same flag or the guide effect disappears into the tool-schema difference.
4. Parent-side `toolUseResult.usage` and `totalTokens` describe the subagent's last request only.
5. 39.5% (native) and 45.3% (sweet) of subagent requests have no usage; any "recorded" sidechain sum is a lower bound; say which bound you report.
6. The fixval claude run shows no delegation in rows.json and has no retained agent-state; do not attribute its cost gap to delegation.
7. `fp-claudecode-none/pipe` hold one native cell each; native denominators are tab-only (n=66).
8. The `Read` `pages: ""` note in the parent's system prompt does not reach subagents; failed Reads inside subagents inflate both arms' sidechain spend, native more.
9. `toolCounts.bash` in rows.json includes subagent raw-shell and hunting calls, which is why sweet's delegating rollouts show `bash` in the dozens.
10. The delegation tool is `Agent` in 2.1.218; scripts that look for `Task` find nothing.
11. Subagents requested as `haiku`/`sonnet` were served and priced as luna; the claude-code headline is pricing-dependent.

## 10. What I could not finish

- Subagent system prompts are not written to the transcripts; guide presence is inferred from first-request token deltas and behaviour, not read.
- Substitution and guide-sentence friction cannot be separated at $0; that needs a guide ablation (paid).
- I did not verify on a live Claude Code 2.1.218 that a project `.claude/agents/Explore.md` overrides the built-in; the documentation is current but does not give the version that introduced override-by-name.
- I did not reproduce the worktree "no index" failure live; the claim rests on `_ss-helpers.mjs:136-142`.
- I did not price the extra `Read` and raw-shell calls that guide-less Explore subagents made beyond the pre-`ss-*` phase (62 Read and 31 raw-shell calls in 8 Explore subagents vs 25 and 0 in 3 general-purpose ones); the cost above is a lower bound for the dilution and the 2.0% is the union bound of two measured sets.

## Appendix A. Exact paths and commands

- Runs: `/root/sweet-search-private/eval/task-completion-bench/results/{fp-claudecode-tab-20260826,fp-claudecode-none-20260826,fp-claudecode-pipe-20260826,rb-claudecode-20260824}`.
- Sample sweet subagent: `.../fp-claudecode-tab-20260826/agent-state/awslabs__aws-embedded-metrics-node-21-sweet/claude-home/projects/-root--ss-eval-runs-r0-36/f6d0427f-f063-4441-83bd-3be0c6710a86/subagents/agent-a0d415047c0776a3e.jsonl` (parent `f6d0427f-f063-4441-83bd-3be0c6710a86.jsonl`).
- Sample native subagent: `.../awslabs__aws-embedded-metrics-node-21-native/claude-home/projects/-root--ss-eval-runs-r1-46/167e8756-1551-4b1c-8529-826370b9707d/subagents/agent-a2642f4b5a3101b3d.jsonl`.
- Scripts: `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-claude-subagents/{subagent-census.mjs,subagent-report.mjs,subagent-extras.mjs}`; box copies and JSON under `/tmp/wf-slatec/claude-subagents/`; local JSON under `scripts-claude-subagents/data/`.
- Commands: `node subagent-census.mjs <run> /tmp/wf-slatec/claude-subagents/census-<run>.json` (box); `node subagent-report.mjs data/census-<run>.json` (local); `node subagent-extras.mjs <run>` (box).
- Code read: `harness/claude-code-task-runner.mjs:43-58,255-335`; `harness/agent-runner-shared.mjs:134-142,325-348`; `harness/claude-code-accounting.mjs`; `harness/ideal-cost.mjs:84-109`; `eval/agent-read-workflows/bin/_ss-helpers.mjs:136-142`; `eval/agent-read-workflows/bin/_ss-env.sh`; `scripts/inject-agent-instructions.js`; `scripts/write-claude-rules.js`; `scripts/install-claude-system-prompt.js:22-23`; `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md:24`.
- Web: `https://code.claude.com/docs/en/sub-agents` (what loads at startup; Explore/Plan skip CLAUDE.md; override by name; frontmatter; `--append-subagent-system-prompt`), `https://code.claude.com/docs/en/cli-reference` (flag requires v2.1.205), `https://code.claude.com/docs/en/worktrees` (`.claude/worktrees/<name>/`, default-branch base, HEAD fallback without a remote), `https://code.claude.com/docs/en/hooks` (SubagentStart runs in the parent), `https://code.claude.com/docs/en/memory` (CLAUDE.md hierarchy and `.claude/rules/`).
