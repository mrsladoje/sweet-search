# c01 adversarial verify — differential and measurability lens

Agent: c01-measurability. Date: 2026-09-02. Cost of this work: $0 (trace reading, source
reading, arithmetic). No model rollout was launched. HO2 was not opened. No grading log was read.

## 0. Verdict: REFUTED as a head-to-head lever. Confidence 0.82.

The measurements behind c01 are correct. I reproduced all six cells of `verify-tail.md` §5 to
the digit from the raw per-request census [M, §2 below]. The lever still fails on two grounds.

**Ground 1 — the differential is a configuration handicap, not a sweet-search capability.**
Native uses the plan tool *more* than sweet on all three harnesses (4.14 against 3.92 requests
per rollout on codex, 3.92 against 3.79 on opencode, 2.05 against 1.91 on claude-code) [M].
Applying the same config to both arms, which is the fair comparison, moves the headline the
wrong way: codex +0.35% → **+1.77%**, opencode +3.31% → **+5.39%**, claude-code unchanged
(−1.38% → −1.44% on the main-thread ledger) [M, my recomputation, §3]. The candidate reports
this inversion honestly. Register row **B17** (DEAD) killed the same class with the same
sentence — "shared harness config, zero differential once measured correctly" — after finding
the same both-arms inversion on claude-code [C `register/DEAD-LEVER-REGISTER.md:95`]. c01 is new
at the object level (no row names the plan tool) and not new at the class level.

**Ground 2 — where the effect is measurable the mechanism is unbuildable or expiring; where the
mechanism is clean the effect is inside the noise.** For a paired treated-versus-control smoke at
the planned size (22 tasks × 3 reps = 66 rollouts per cell), the claimed cost effect is 2.99
standard errors on codex, **1.72 on opencode and 0.51 on claude-code** [M, §4]. Codex is the only
harness where the smoke could see the effect, and codex is the harness whose vehicle the
candidate's own author could not verify at the pinned version, whose base prompt still names the
tool eight times, and where the vendor turned the tool off **for both arms** in 0.152.0, released
one day before this workflow [W, C, §5]. Claude-code's third measures a bench artifact: Claude
Code 2.1.233 already removed the task tools for modern Anthropic models, and the bench still has
them only because `luna` is not in the gated set [W `research/harness-changelogs.md` §1].

A third, weaker ground: the solve veto is unprotected. The support offered ("no within-arm
association between plan requests and solving") does not survive a median split. In four of six
cells, rollouts with more plan requests solved *more* often, not less (codex sweet 13/16 = 81%
against 26/50 = 52%; opencode sweet 5/5 against 36/61 = 59%) [M, §6]. That reading is confounded
by task difficulty and is not causal in either direction. It does mean the candidate has no
evidence that removing the plan tool is solve-neutral, and the ±6-of-66 bar cannot detect a solve
loss below about 9 percentage points.

What survives, and should be booked as such: the *fact* is real, priced and arm-symmetric. Every
plan call is its own billed request in all six cells, worth 10.9% to 13.1% of a codex or opencode
rollout at the counterfactual price [M]. As a **both-arms** product profile it is a genuine floor
cut of $0.0010 to $0.0016 per rollout for every user of that harness. As a sweet-only lever it
produces a number that inverts under fair application, and publishing it would repeat exactly the
error `readme-voice` and `paper-strategy` warn against.

---

## 1. What I checked and how

Box (read-only runs): `/root/sweet-search-private/eval/task-completion-bench/results/`
(`fp-codex-tab-20260826`, `fp-opencode-tab-20260826`, `rp-oc-tab-20260827`,
`fp-claudecode-tab-20260826`). Basis: the 7.3 MB per-request census
`/tmp/wf-slatec/verify-tail/tail-census.json` built by the sibling forensic agent, 396 rollouts,
66 per cell, canonical opencode sweet selection already applied.

My scripts (box scratch, `/tmp/wf-slatec/c01-measurability/`): `c01_check.py` (plan census and
per-cell cost moments), `c01_check2.py` (text-only baseline, paired-by-task arms arithmetic),
`c01_check3.py` (same-arm A/B power, solve split). Local copies of the same three files are in
the session scratchpad. I wrote nothing under `results/`. I edited no product or bench code.

Documents read: `slate-c/forensics/verify-tail.md` (§1, §4, §5, §6, §10, §11, §12),
`slate-c/forensics/phase-anatomy.md` (line 216 table row 7, S4 at line 309),
`slate-c/candidates/cost-structural.md` (§3.4, §3.5, §3.6, §4.1, §9),
`slate-c/research/harness-changelogs.md` (§1 claude-code, §2.2 codex, traps T5/T7/T8, §7),
`slate-c/register/DEAD-LEVER-REGISTER.md` (row B17), `slate-c/candidates/DEDUP.md`.

Code read (local repo): `eval/task-completion-bench/harness/agent-runner-shared.mjs:263-275`,
`harness/codex-task-runner.mjs:453-480`, `harness/opencode-task-runner.mjs:196-229,306-308`,
`harness/claude-code-task-runner.mjs:104-131,291,316`, `scripts/inject-agent-instructions.js`,
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`.

## 2. The candidate's measurements reproduce exactly [M]

`c01_check.py`, price vector $0.10 new input / $0.01 cached / $0.60 output per million.

| cell | plan requests / rollout | attributed $ share | counterfactual $ / rollout | counterfactual $ / request | counterfactual share | mean $ / rollout |
|---|---:|---:|---:|---:|---:|---:|
| codex native | 4.14 | 28.0% | 0.001615 | 0.000390 | 13.1% | 0.012287 |
| codex sweet | 3.92 | 27.4% | 0.001469 | 0.000374 | 11.9% | 0.012330 |
| opencode native | 3.92 | 26.5% | 0.001132 | 0.000289 | 12.6% | 0.008969 |
| opencode sweet | 3.79 | 23.2% | 0.001006 | 0.000266 | 10.9% | 0.009265 |
| claude-code native | 2.05 | 12.4% | 0.000605 | 0.000296 | 3.7% | 0.016542 |
| claude-code sweet | 1.91 | 15.6% | 0.000606 | 0.000318 | 3.7% | 0.016314 |

Every figure matches `verify-tail.md` §5. The mean cost per rollout also matches the BRIEF for
codex (0.012287 / 0.012330) and opencode (0.008969 / 0.009265). Claude-code differs from the
BRIEF because this census is main-thread only; sidechain spend is excluded.

Plan-request counts times 66 give 273 / 259 / 259 / 250 / 135 / 126, which equal the plan *call*
totals in `verify-tail.md` §5. So "every plan call is a standalone request" is confirmed
independently, in all six cells [M].

The counterfactual price is the honest one. It charges only the removed request's own output and
its own re-sent prefix, because the new tokens it ingests migrate to the next request
(`verify-tail.md` §11 trap 6). That is why the attributed share (27.4% on codex sweet) is more
than twice the counterfactual share (11.9%).

## 3. The fairness inversion, recomputed per task [M `c01_check2.py`]

Means over 22 tasks, each task averaged over 3 reps, arms paired on the task.

| harness | native $ | sweet $ | baseline delta | sweet-only removal | both-arms removal |
|---|---:|---:|---:|---:|---:|
| codex | 0.012287 | 0.012330 | +0.35% | **−11.61%** | **+1.77%** |
| opencode | 0.008969 | 0.009265 | +3.31% | **−7.91%** | **+5.39%** |
| claude-code (main only) | 0.016542 | 0.016314 | −1.38% | −5.05% | −1.44% |

The candidate's ceiling arithmetic is right (it quotes −11.6%, −7.9%, +1.8%, +5.4%). The
claude-code line in the candidate mixes units: it applies a main-thread saving ($0.000606) to a
sidechain-inclusive base ($0.020727) to get −2.9% and −6.7%. On one consistent ledger the numbers
are −3.7% of main-thread cost and −1.38% → −5.05% against native. Neither version is detectable
(§4), so the mismatch does not change the verdict.

The direction of the inversion has one cause: **native calls the plan tool more often than sweet
does, in every cell.** A config that removes it therefore takes more away from native than from
sweet. The sweet-only "win" is the difference between two floors, not a capability.

## 4. Detectability at the planned run size [M `c01_check3.py`]

For a paired smoke that runs the same 22 tasks × 3 reps twice in one arm (treated and control),
the standard error of the per-task mean difference is `sqrt(2) × s_within / sqrt(3) / sqrt(22)`,
where `s_within` is the pooled rep-to-rep standard deviation inside a task cell.

| harness (sweet cell) | rep-to-rep sd | paired per-task diff sd | SEM over 22 tasks | claimed effect | effect / SEM |
|---|---:|---:|---:|---:|---:|
| codex | 0.002818 | 0.002301 | 0.000491 | 0.001469 | **2.99** |
| opencode | 0.003363 | 0.002746 | 0.000585 | 0.001006 | **1.72** |
| claude-code | 0.006825 | 0.005573 | 0.001188 | 0.000606 | **0.51** |

Read plainly: at 66 rollouts per cell the cost effect is clear only on codex. On opencode it is
marginal (about p = 0.09 two-sided, before any behavioural response eats into it). On claude-code
it is invisible. The BRIEF's cost interval of about ±$0.001 to ±$0.005 per rollout is the same
message in a different unit.

The cheap high-power metric is the **request count**, not the dollar. Plan requests per rollout
have sd 0.80 (codex sweet), 0.56 (opencode sweet), 1.58 (claude-code sweet), against means of
3.92, 3.79 and 1.91 [M]. A drop to zero is unmistakable. So the mechanism gate ("≥90% fewer
plan-only requests") is well posed and cheap; the *cost* claim it is meant to support is not
measurable on two of three harnesses at this size.

## 5. The codex third: unverified at the pin, and already vendor-default upstream

Three facts, each from a different source, and they point the same way.

1. The config key parses at the pin. `codex-rs/core/src/config/mod.rs` at `rust-v0.146.1` has
   `update_plan_enabled` and `resolve_update_plan_enabled` defaulting to true, and the deployed
   binary carries the `ToolsToml` serde field table [C, box string probe, reported in
   `cost-structural.md` §3.4].
2. **Whether the pin acts on the key was not established.** The candidate's own §9.2 says: "I did
   not find the code that consumes `update_plan_enabled` when registering tools (the 0.146.1 tree
   moved `tools/spec.rs`; six candidate files had zero hits)." A key that parses is not a tool
   that leaves the request.
3. The base prompt at the pin still tells the model it has `update_plan`, eight times [C
   `codex-rs/core/gpt_5_2_prompt.md`]. Codex PR #41744, shipped in **0.152.0 on 2026-09-01**,
   is the change that removes that guidance *and flips the default to off* [W
   https://github.com/openai/codex/pull/41744, via `research/harness-changelogs.md` §2.2].

So the codex third has two branches and both are dead ends. Stay on 0.146.1: the vehicle is
unverified and the stale prompt invites calls to a tool that is not there, which costs requests
the ceiling does not price. Upgrade to 0.152.x: the tool is off in **both** arms by default, the
differential is zero, and trap T7 forbids pooling a 0.152 run with the 0.146.1 evidence base.

The candidate's JSON says the mechanism falsifier is "Done ... FALSE codex 0.146.1". That reads
as "the prompt is not dropped". The stronger and correct statement is "the tool-registration
consumer was not found at the pin, so the codex vehicle is unverified."

## 6. The solve veto is unprotected, and the observational support points the wrong way

Median split on plan requests per rollout, within each arm [M `c01_check3.py` §E]:

| cell | low-plan solved | high-plan solved |
|---|---|---|
| codex native | 26/44 (59%) | 15/22 (68%) |
| codex sweet | 26/50 (52%) | 13/16 (81%) |
| opencode native | 33/56 (59%) | 8/10 (80%) |
| opencode sweet | 36/61 (59%) | 5/5 (100%) |
| claude-code native | 32/43 (74%) | 11/23 (48%) |
| claude-code sweet | 29/44 (66%) | 11/22 (50%) |

Four of six cells associate more plan requests with more solving. Two associate the opposite.
Both readings are confounded: a longer, harder rollout has more of everything. The honest
conclusion is that the data supports no causal claim in either direction, and that the
candidate's stated support ("no within-arm association") is not what the split shows. The sibling
report already labelled its own version of this "a confounded within-arm reading, not a causal
one" [`phase-anatomy.md` S4]. With solve as the veto and a ±6-of-66 bar, a real loss of up to 9
percentage points would pass the gate unseen.

## 7. Corrections the synthesis must adopt

1. **The `$0` falsifier's missing baseline is now measured, and the kill condition built on it is
   mis-specified.** Text-only non-final requests per rollout: codex native 0.000 and sweet 0.000
   (0 of 132 rollouts), opencode native 0.000 and sweet 0.000 (0 of 132), claude-code native
   0.076 and sweet 0.045 (4 of 132 rollouts) [M `c01_check2.py` §A]. The candidate's quoted
   baseline of 0.06 is roughly right for claude-code and wrong for the two harnesses that carry
   the claimed saving. On codex and opencode a text-only non-final request is structurally
   impossible: a message with no tool call ends the loop. So "plan moves into text" cannot appear
   as a new request there. It would appear as longer assistant text inside requests that already
   exist. **Replace that kill condition with: output tokens per rollout rise more than 15%, or
   total requests per rollout fall by less than 3.0 on codex and opencode.**
2. **`ss init` writes no harness configuration today.** `scripts/inject-agent-instructions.js`
   writes `AGENTS.md`, `.claude/rules/sweet-search.md`, `GEMINI.md` and
   `.cursor/rules/sweet-search.mdc` only, and its header states that `CLAUDE.md` "is never
   created or modified" [C]. The bench injects `AGENTS.md` (codex, opencode) or
   `.claude/rules/sweet-search.md` (claude-code) and nothing else [C `codex-task-runner.mjs:475`,
   `opencode-task-runner.mjs:196`, `claude-code-task-runner.mjs:316`]. The phrase "the config
   file `ss init` already writes" (`cost-structural.md` line 16) is wrong. Writing three harness
   config files into a user's project is a **new product surface**, not a new line in an existing
   file, and it runs against that file's stated conservatism about user-authored content.
3. **Claude-code's third is a bench artifact.** Claude Code 2.1.233 removed the task-tracking
   tools for Opus 4.8, Sonnet 5, Fable 5, Mythos 5 and newer; the bench keeps them only because
   `luna` is not in that set [W `harness-changelogs.md` §1]. A real Anthropic-model user already
   has no plan tool to remove. Do not book claude-code value for this lever.
4. **State the both-arms number beside every sweet-only number.** codex +1.77%, opencode +5.39%,
   claude-code −1.44% [M]. Never publish −11.6% or −7.9% without it.
5. **Register the class, not the object.** The nearest row is B17, and its killing sentence
   ("shared harness config, zero differential once measured correctly") applies here unchanged.
   Add a row for the plan tool that carries the measured price, the standalone-request fact and
   the inversion, and mark it DEAD as a head-to-head lever, OPEN as a shared floor cut.
6. **Detectability belongs in the ceiling.** Write the ceiling as "codex −11.6% at 2.99 SEM,
   opencode −7.9% at 1.72 SEM, claude-code not detectable at 0.51 SEM", not as three percentages.
7. **Two small hygiene items if a smoke is ever built.** `gitDiffPatch` excludes only
   `.sweet-search`, `CLAUDE.md`, `AGENTS.md` and `.claude/rules/sweet-search.md`
   [C `agent-runner-shared.mjs:263-275`]; add `opencode.json`, `.claude/settings.json` and
   `.codex/config.toml` before injecting them, in case a task repo already tracks one. And the
   claude-code runner already writes its own `settings.json` and passes `--settings`
   [C `claude-code-task-runner.mjs:104-131`], so the in-bench claude vehicle is easy; the
   unverified part is the *product* path, a project `.claude/settings.json` in a user's repo
   (the candidate's §9.4 says the same).

## 8. Rule check

- Same-information compaction (BRIEF rule 7): **not violated.** The lever removes requests. It is
  admissible on that axis, and this is its one clear strength over the prompt-clause form, which
  would have had to fight A1's "luna is instruction-deaf" finding.
- Differential rule (rule 6): **violated in substance, not in letter.** The config does not reach
  both arms as proposed, so it is not literally a shared setting. Its effect is nonetheless a
  shared floor cut applied to one side, and the candidate concedes native can adopt it.
- HO2 (rule 4): not violated by the candidate or by this verification.
- Task identity, gold, hidden tests as runtime inputs (rule 10): not violated.
- Ranking-signal format gate (rule 8): not applicable; no ranking signal changes.
- Owner decisions (rules 11 and 12): correctly flagged `needs_user_decision`. The decision is
  larger than the candidate states: it is not only "is this fair", it is "may `ss init` write
  harness configuration into a user's project at all".
- Solve veto (rule 9): unpriced, and the observational data leans against the lever (§6).

## 9. What I could not finish

- I could not verify that Claude Code 2.1.218 removes a denied tool from the request roster. That
  claim rests on the documentation [W code.claude.com/docs/en/permissions] and on a string read
  of the bundle reported by the candidate. A local `claude -p` probe would settle it, and that is
  a model call, so I did not run it.
- I could not settle whether codex 0.146.1 acts on `tools.update_plan.enabled`. That needs the
  Rust tool-registration path at the tag; six candidate files had zero hits for the candidate's
  author and I did not repeat the search.
- I did not estimate the cost of codex calling a tool the prompt names but the request omits. No
  rollout in the evidence base has that condition, so there is no measurement to make at $0.
- I did not check whether any fresh-pool task repository already tracks `opencode.json`,
  `.claude/settings.json` or `.codex/config.toml`. `git diff HEAD` shows tracked files only, so
  an untracked injected config cannot leak into `model_patch`; the risk is limited to a repo that
  already tracks one of those paths, which I judge unlikely for this task population but did not
  confirm.
