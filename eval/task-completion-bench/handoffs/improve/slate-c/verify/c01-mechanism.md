# Verify c01 (mechanism lens): remove the harness plan tool in the sweet arm through `ss init` config files

Date: 2026-09-02. Agent: c01-mechanism (Slate C adversarial verify). Spend: $0. Nothing under `results/` was written. Box scratch: `/tmp/wf-slatec/c01-mechanism/` (`c01_census.py`, `census-output.txt`). No grading log was opened. No HO2 task was read.

Tags: **[M]** measured (script named) · **[C]** read from code · **[W]** web, URL given · **[I]** inferred, arithmetic shown.

## 0. Verdict

**Not refuted on the mechanism lens. Confidence 0.78.** The traces show the mechanism exactly as claimed, and the ceiling arithmetic is right to the last digit on opencode and claude-code. My independent census over the same 396 rollouts reproduces every plan-request number in the candidate: plan calls sit in a request of their own in all six cells (0 of 1,203 plan requests share a request with a working call), and the per-rollout counterfactual savings are $0.001469 codex sweet, $0.001006 opencode sweet, $0.000610 claude-code sweet [M `c01_census.py`]. The harness-code claims also hold: opencode 1.18.4 drops a tool from the request when a project `opencode.json` sets `tools.todowrite=false` [C], Claude Code's documentation says a bare-name deny rule "removes the tool from Claude's context entirely" and "Deny rules block in every mode, including `bypassPermissions`" [W], and codex 0.146.1 gates the plan tool on `update_plan_enabled` at `spec_plan.rs:736` [C] — a fact the candidate listed as unfinished and which I closed.

Three corrections must be adopted. **First, the codex leg has no clean delivery path and must not be carried as a −11.6% head-to-head headline.** At the pin the switch removes the tool, but the recorded base instructions still carry a `## Planning` section that names `update_plan` 9 times [M], and codex answers a call to an unregistered tool with a billed error result `unsupported call: update_plan` [C `registry.rs:775`]. The request reduction at the pin is therefore unknown, between 0 and 100 percent. From codex 0.152.0 (PR #41744, merged 2026-08-31) the tool is off by default in both arms, so the differential is zero [W]. State codex as "0 to −11.9% of the sweet cell, unpriced; zero after the next codex upgrade". **Second, the kill condition "text-only non-final requests rise by more than 0.5 per rollout" is structurally unreachable on codex and opencode**, because both harnesses end the turn on a response with no tool call; displaced planning can only appear as more output tokens in adjacent requests or as other bookkeeping requests. Kill on paired total requests per rollout and total output tokens per rollout against native on the same tasks instead. **Third, the cited example rollout's plan positions are mis-indexed:** `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0` has plan requests at 0-indexed positions 0, 5, 9, 20 of 22 (1-indexed 1, 6, 10, 21), not "0, 6, 10, 21" [M]. The fact behind it (4 plan requests of 22: first, two mid, second-to-last) holds.

Revised ceiling, zero solve effect assumed, stated against the fresh-pool cells: opencode −$0.001006 per rollout = −10.9% of the sweet cell, head-to-head +3.3% → −7.9%; claude-code −$0.000610 = −2.9% of the inclusive $0.020727 (−3.7% of the main thread), −3.9% → −6.7%; codex 0 to −11.9%, unpriced at the pin and zero after upgrade. Applied to both arms the lever moves codex +1.8% and opencode +5.4% the wrong way, as the candidate says [I, re-derived]. Solve effect is unmeasured; the within-arm screen shows no positive association between plan requests and solving but is confounded. Solve stays the veto.

## 1. What I re-derived from the raw traces [M]

Script: `/tmp/wf-slatec/c01-mechanism/c01_census.py` (copy at `slate-c/forensics/` is not made; the script is 190 lines and independent of `tail_census.py`). Same alignment rules as the sibling, re-implemented: codex `function_call` items between `token_count` events belong to the later event; opencode one `step_finish` is one request; claude-code one `message.id` is one request, usage from the record with the largest input+output, `tool_use` blocks deduplicated by id, main thread only. Canonical opencode sweet set: `fp-opencode-tab-20260826` for the 11 non-repair tasks plus `rp-oc-tab-20260827` for the 11 repair tasks (`/root/fresh-run/repair-tasks.txt`). Price vector $0.10 / $0.01 / $0.60 per million; claude-code cache writes at 1.25×.

Validation: request counts equal `idealTurns` on all 264 codex and opencode rows (0 mismatches); the per-request cost sum equals `costRealizedUsd` (codex, opencode) or `costRealizedMainOnlyUsd` (claude-code) on every cell to four decimals; solved counts reproduce the brief (41/39, 41/41, 43/40).

| cell | rollouts | requests | multi-call requests | plan calls (by tool) | requests carrying a plan call | plan + working call in one request | plan-only per rollout | share of requests | first request is a plan | saving per plan-only request | saving per rollout | share of cell $ |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/native | 66 | 1,244 | 0 | 273 (`update_plan`) | 273 | 0 | 4.14 | 21.9% | 63/66 | $0.000390 | $0.001615 | 13.1% |
| codex/sweet | 66 | 1,294 | 0 | 259 (`update_plan`) | 259 | 0 | 3.92 | 20.0% | 66/66 | $0.000374 | $0.001469 | 11.9% |
| opencode/native | 66 | 1,077 | 271 | 259 (`todowrite`) | 259 | 0 | 3.92 | 24.0% | 66/66 | $0.000289 | $0.001132 | 12.6% |
| opencode/sweet | 66 | 1,300 | 105 | 250 (`todowrite`) | 250 | 0 | 3.79 | 19.2% | 66/66 | $0.000266 | $0.001006 | 10.9% |
| claude-code/native | 66 | 1,604 | 103 | 135 (TaskCreate 55, TaskUpdate 79, TaskList 1) | 135 | 0 | 2.05 | 8.4% | 40/66 | $0.000296 | $0.000605 | 3.7% |
| claude-code/sweet | 66 | 1,529 | 17 | 127 (TaskCreate 52, TaskUpdate 72, TaskList 2, TaskGet 1) | 127 | 0 | 1.92 | 8.3% | 47/66 | $0.000317 | $0.000610 | 3.7% |

Saving per plan-only request = output tokens × $0.60/M + cached prefix tokens × $0.01/M; the request's new ingest is excluded because the next request would ingest it. Mean output 281 tokens and mean cached prefix 20,602 tokens on codex sweet; 176 and 16,001 on opencode sweet; 161 and 22,055 on claude-code sweet [M].

Differences from the candidate: claude-code sweet has 127 plan calls, not 126, because the sibling's tool list omitted `TaskGet` (1 call); the saving per rollout is $0.000610, not $0.000606. Immaterial. No `todoread` call exists in 132 opencode rollouts, and 1.18.4 registers only `TodoWriteTool` under the id `"todowrite"` [C `tool/todo.ts:14-15`, `tool/registry.ts:100`], so `tools.todowrite=false` covers the whole opencode plan family. Claude-code subagents: 2 native and 1 sweet `TaskUpdate` calls across 44 subagent transcripts [M `grep` over `subagents/*.jsonl`]; a project deny rule would remove those too; the change to the claude-code saving is negligible.

Standalone check on the cells where it means something: opencode has 271 (native) and 105 (sweet) multi-call requests and claude-code 103 and 17, yet none pairs a plan call with a working call [M]. On codex the fact is structural (0 multi-call requests in 2,538).

## 2. The cited rollout, request by request [M]

`fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0`, file `agent-state/aws-actions__configure-aws-credentials-42-sweet/codex-home/sessions/2026/08/26/rollout-2026-08-26T23-09-22-01a04055-d702-7941-98a0-e4ea49bbc186.jsonl`, `idealTurns` 22, `costRealizedUsd` 0.011004, solved.

| request (0-indexed) | call | new input | cached | output+reasoning | realized $ | counterfactual saving if removed |
|---:|---|---:|---:|---:|---:|---:|
| 0 | `update_plan` | 15,527 | 0 | 165 | 0.001652 | 0.000099 |
| 5 | `update_plan` | 333 | 19,139 | 129 | 0.000302 | 0.000269 |
| 9 | `update_plan` | 788 | 21,313 | 585 | 0.000643 | 0.000564 |
| 20 | `update_plan` | 361 | 27,533 | 94 | 0.000368 | 0.000332 |

Total counterfactual saving for this rollout $0.001264 of $0.011004 (11.5%) [I, sum]. Two lessons the synthesis should carry. The first request is a plan in 66 of 66 codex sweet rollouts and carries the whole preamble ingest; removing it saves only its output (about $0.0001) because the ingest moves to the next request. The census formula handles this correctly (cached = 0 on request 0), so the per-rollout figure $0.001469 already accounts for it. The per-removed-request saving therefore ranges from about $0.0001 (first request) to about $0.0006 (late request); nobody should multiply 3.92 by a late-request price.

The plan call and its result stay in the prefix and are re-sent on every later request. Request 0 → 1 grows by 148 input tokens [M]. With remaining requests 21, 16, 12 and 1 for the four plan calls, the re-sent plan text is about 50 request-resends × ~140 tokens = 7,000 tokens × $0.01/M ≈ $0.00007 per rollout (0.6%) [I]. The candidate's "below $0.00002" understates this term about 3×; the direction is favourable to the lever and the term stays second-order.

## 3. Harness-code claims, verified

**Codex 0.146.1** [C, sparse clone of `openai/codex` at tag `rust-v0.146.1` in my scratchpad]:
- `codex-rs/core/src/tools/spec_plan.rs:736-738`: `if turn_context.config.update_plan_enabled { planned_tools.add(PlanHandler); }`. The switch is consumed at the pin. This closes the candidate's unfinished item 2.
- `codex-rs/core/src/config/mod.rs:1034, 2551-2556, 3610, 4142`: the field, its resolver (default true, `[tools.update_plan] enabled = false` turns it off), and its load path.
- `codex-rs/config/src/loader/mod.rs:64-76`: `PROJECT_LOCAL_CONFIG_DENYLIST` holds provider, notify, profile and telemetry keys; `tools` is not on it. Lines 104-106: the cwd, tree `./.codex/config.toml` and repo `.codex/config.toml` layers are "loaded but disabled when the directory is untrusted". The bench seeds each per-rollout codex home from `/root/.codex/config.toml`, which holds `[projects."<rundir>"] trust_level = "trusted"` for every run directory [M `cat /root/.codex/config.toml`; C `codex-task-runner.mjs:462-467`].
- `codex-rs/core/gpt_5_1_prompt.md`, `gpt_5_2_prompt.md`, `prompt_with_apply_patch_instructions.md`: 8 `update_plan` mentions each; no code in `core/src` strips the `## Planning` section when the tool is off (0 hits for "Planning") [C]. The recorded `session_meta.base_instructions` of the cited rollout (21,084 chars) contains 9 `update_plan` mentions and the `## Planning` section verbatim [M].
- `codex-rs/core/src/tools/registry.rs:775`: an unregistered tool name yields `unsupported call: {tool_name}` as the tool result [C]. So a model that follows the prompt and calls `update_plan` pays a full request for an error string.
- PR #41744 "Make the update_plan tool opt-in", merged 2026-08-31T00:55Z, body: default `tools.update_plan.enabled` to false and "Remove bundled `update_plan` guidance from model … prompts when the tool is disabled" [W https://github.com/openai/codex/pull/41744 via `gh api`]. In 0.152.0 per the sibling changelog report [W `research/harness-changelogs.md` §2.2].

**OpenCode 1.18.4** [C, raw files at `https://raw.githubusercontent.com/anomalyco/opencode/v1.18.4/packages/opencode/src/...`]:
- `config/config.ts:396-409`: load order global → `OPENCODE_CONFIG` → project `opencode.json*` files unless `OPENCODE_DISABLE_PROJECT_CONFIG`; later merges win. The runner sets `OPENCODE_CONFIG` to a runner-owned file and does not set the disable flag [C `opencode-task-runner.mjs:229`].
- `config/config.ts:553-563`: `tools.<name>: false` becomes `permission.<name> = "deny"` via `mergeDeep(perms, result.permission)`.
- `permission/index.ts:183-194` (`fromConfig`): a string permission value becomes `{permission: key, action, pattern: "*"}`; lines 207-217 (`disabled`): a `*`-pattern deny rule puts the tool in the hidden set; `session/llm/request.ts:208-213` (`resolveTools`): hidden tools are filtered out of the request. `agent/agent.ts:119-145` builds the agent ruleset from `cfg.permission` with `fromConfig`.
- `session/system.ts:26-38` (`provider`): a model id containing `gpt` but not `codex` gets `prompt/gpt.txt`; the bench model is `openai/gpt-5.6-luna` [M rows]. `gpt.txt` has 0 `todo` mentions; `anthropic.txt` has 12 and `beast.txt` (gpt-4/o1/o3) has 6 [M `grep -c` over the raw files]. No prompt-tool mismatch on opencode for this backbone; a claude or gpt-4-family backbone would reintroduce a codex-style mismatch.
- `validateMainOpencodePreflight` checks only the pinned version and `resolved.plugin.length === 0` [C `opencode-task-runner.mjs:69-77`]; a `tools` or `permission` key passes. The per-rollout `resolvedConfigSha256` is recorded, not gated.

**Claude Code** [W, fetched 2026-09-02]:
- https://code.claude.com/docs/en/permissions: "A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never sees it." "`deny` and `ask` rules aren't affected [by workspace trust], since they only restrict." Project settings and hooks "load from the current working directory's `.claude/` folder".
- https://code.claude.com/docs/en/permission-modes: "Deny rules block in every mode, including `bypassPermissions`. … Allow rules have no effect in `bypassPermissions`."
- The runner runs `claude -p … --permission-mode bypassPermissions` with `cwd: rundir` and already writes `<rundir>/.claude/rules/sweet-search.md` in the sweet arm [C `claude-code-task-runner.mjs:95, 312-317, 371`], so `<rundir>/.claude/settings.json` is the project settings file. The runner's private `~/.claude/settings.json` (the Read normalizer hook) is user scope and coexists.
- Box binary 2.1.218 contains the template string "Use … to plan and track work. Mark each task completed as soon as it's done; don't batch." at 2 offsets with an interpolated tool name [M python probe over the binary], consistent with the candidate's claim that the sentence is emitted only when a task tool is present. I did not verify the conditional beyond the string. The docs describe the current version; project-settings loading inside the jail on 2.1.218 was not exercised (a model call). The candidate's unfinished item 4 stands.

## 4. Ceiling arithmetic, re-derived [I on M inputs]

| harness | sweet cell | saving | sweet after | native | head-to-head | both arms: native after | both arms head-to-head |
|---|---:|---:|---:|---:|---|---:|---|
| codex | 0.012330 | 0.001469 | 0.010861 | 0.012287 | +0.3% → −11.6% | 0.010672 | +1.8% |
| opencode | 0.009265 | 0.001006 | 0.008259 | 0.008968 | +3.3% → −7.9% | 0.007836 | +5.4% |
| claude-code (inclusive) | 0.020727 | 0.000610 | 0.020117 | 0.021558 | −3.9% → −6.7% | 0.020953 | −4.0% |

All figures match the candidate within rounding. The ceiling is stated against the fresh-pool production cells (n = 66 per cell). The candidate correctly uses the counterfactual saving (11.9% on codex sweet), not the attributed request cost (27.4%). The codex row is arithmetic only; see §5 for why it is not deliverable as stated.

## 5. Where the mechanism is weaker than the candidate's headline

1. **Codex at the pin.** The tool leaves the request, but the prompt keeps telling the model it has `update_plan` (9 mentions), and an attempted call returns a billed `unsupported call` error. Whether luna keeps calling a tool the prompt names but the schema lacks is unmeasured, so the codex request reduction is between 0 and 100 percent. The candidate's own kill line (unknown-tool error requests > 0.3 per rollout) is the right gate, but the synthesis must not present −11.6% as the codex expectation. From 0.152.0 the tool is off by default in both arms, so the codex differential is zero on upgrade. A sweet-arm base-instructions override (`model_instructions_file`) could remove the Planning prose at the pin, but that replaces the whole harness prompt and is a far larger change; it would need its own user decision.
2. **Kill condition.** A text-only response ends the turn on codex and opencode, so "text-only non-final requests" cannot rise there. The measurable displacement channels are (a) more output tokens in adjacent requests, (b) other bookkeeping requests (`git status`, a written plan file). Kill on paired totals: requests per rollout and output tokens per rollout against native on the same tasks, plus the codex error-request count.
3. **Zero solve effect is an assumption.** My census's within-arm distribution (plan-request count → rollouts, solved): codex sweet 2: 3, 2; 3: 15, 5; 4: 32, 19; 5: 16, 13; codex native 0: 2, 2; 3: 7, 5; 4: 35, 19; 5: 20, 13; 6: 2, 2; opencode sweet 3: 19, 12; 4: 42, 24; 5: 5, 5; claude-code sweet 0: 19, 12; 2: 24, 17; 3: 18, 8 [M]. No positive monotone association; rollouts with more plan updates are longer rollouts. Confounded, not causal, and it says nothing about removing the tool.
4. **Traces cannot show the removal itself.** No recorded rollout ran without the plan tool. The mechanism "no tool → no calls → no requests" is a structural inference from the 100% standalone fact plus the harness code; it is sound for opencode and claude-code and undermined on codex by the prompt.

## 6. Register and fairness (outside this lens, stated for the record)

No register row names the plan tool; B17 (redundant-tool retirement, DEAD) removed schema tokens, not requests, and reached the same both-arms inversion on claude-code; A1/A6 do not apply because nothing is asked of the model. The differential exists only because sweet ships the config profile and native does not; applied fairly to both arms it is a shared floor cut that moves codex and opencode the wrong way. That is a user decision, as the candidate says, and it does not change the mechanism verdict.

## 7. Build notes the candidate did not state

- `gitDiffPatch` runs `git diff HEAD` [C `agent-runner-shared.mjs:264-270`], which omits untracked files, so a new `opencode.json`, `.claude/settings.json` or `.codex/config.toml` stays out of `model_patch`. If a task repository already tracks one of these files, the injected edit lands in the graded patch unless excluded like `AGENTS.md`; the injector must check and exclude.
- The opencode preflight will pass a `tools` key; the sweet arm's `resolvedConfigSha256` will differ from native's. Record it; do not read it as tampering.
- Claude-code: deny `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` only; `TaskOutput` and `TaskStop` manage background subagents (native used them 3 times) and must stay.

## 8. What I could not finish

- No `$0` way exists to price the codex prompt-tool mismatch; it needs a model call.
- Project-settings loading on Claude Code 2.1.218 inside the jail was not exercised (model call). The docs quoted are current-version docs.
- The conditional emission of the "Use … to plan and track work" sentence was checked only as a template string at two offsets in the 2.1.218 binary.
- The prefix re-send term was estimated from one rollout, not summed over all 396.

## 9. Evidence checked

Box (read-only): `/root/sweet-search-private/eval/task-completion-bench/results/{fp-codex-tab-20260826,fp-opencode-tab-20260826,rp-oc-tab-20260827,fp-claudecode-tab-20260826}/rows.json`, `agent-state/**` (codex `codex-home/sessions/**/rollout-*.jsonl`, opencode `opencode-retained/*/attempt-1.stdout.ndjson` and `opencode.generated.json`, claude `claude-home/projects/*/*.jsonl` and `*/subagents/*.jsonl`); cited rollout `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0`; `/root/.codex/config.toml`; `/root/.local/share/claude/versions/2.1.218`; `/root/fresh-run/repair-tasks.txt`; versions `codex-cli 0.146.1`, claude `2.1.218`, opencode `1.18.4`.

Local: `slate-c/BRIEF.md`, `DEAD-LEVER-REGISTER-DRAFT.md`, `register/DEAD-LEVER-REGISTER.md` (B17, D4b), `candidates/cost-structural.md` §3-4, `candidates/DEDUP.md` (c01), `forensics/verify-tail.md` §5, §10, `forensics/phase-anatomy.md` S4, `forensics/scripts-verify-tail/{tail_census.py,tail_extras.py,tail-extras-output.md,harness_prompt_check.py}`, `research/harness-changelogs.md` §2.2, T3, T7; `eval/task-completion-bench/harness/{codex-task-runner,opencode-task-runner,claude-code-task-runner,agent-runner-shared}.mjs`; `scripts/init.js`, `scripts/inject-agent-instructions.js`, `scripts/write-claude-rules.js`.

Web: https://github.com/openai/codex/pull/41744 (`gh api`); `openai/codex` tag `rust-v0.146.1` (sparse clone: `codex-rs/core/src/tools/spec_plan.rs`, `tools/registry.rs`, `config/mod.rs`, `codex-rs/config/src/loader/mod.rs`, `core/*.md`); https://raw.githubusercontent.com/anomalyco/opencode/v1.18.4/packages/opencode/src/{session/llm/request.ts,config/config.ts,permission/index.ts,tool/todo.ts,tool/registry.ts,agent/agent.ts,session/system.ts,session/prompt/*.txt}; https://code.claude.com/docs/en/permissions; https://code.claude.com/docs/en/permission-modes.
