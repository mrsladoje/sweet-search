# EDIT_THRASHING — run-ready completion-tail controller (revision 2, 2026-07-31)

This is the primary cost-control plan for edit→test→edit tails. It is a companion to
`TURN_FIX_PLAN.md`, which defines dataset policy, structured batching, shared experiment cohorts,
statistics, and the final native-versus-Sweet comparison.

The goal is not to make agents stop sooner at any cost. It is to preserve the best valid work,
surface objective non-progress, and prevent long-context oscillation while retaining task completion.

## 0. Data and evidence policy

The former held-out-200 is now `DEV-RET`: retired, fully inspectable development data. Use all of it
for trajectory replay, threshold discovery, checkpoint reconstruction, tail selection, and live dev
experiments. The original dev set is `DEV-OLD` and is also unrestricted. The new
`select/tasks_heldout2.jsonl` set (`HO2`) remains frozen and unavailable for tuning.

Historical `DEV-RET` costs and solve totals remain pre-offline-frame observations, not a current
baseline. For controller fitting, stratify replay by era:

- pre-frame retired run;
- post-frame Stage 1; and
- fresh post-fix development runs.

Use task-level five-fold cross-validation when selecting thresholds from historical trajectories.
The eventual untouched-set claim comes only from `HO2`.

Established local evidence:

- eight retired tasks supplied +$16.70, 107.2% of the historical cost gap;
- Stage 1 held retrieval/test operations flat while edits rose 63% and test envelopes 43%;
- `thelounge` expanded from 11 to 28 turns and 5 to 17 edit envelopes while failing both arms;
- the variant performed substantially more post-edit retrieval than control, rejecting repair
  starvation as the explanation; and
- the identifier warning fired in 8/14 Stage-1 rollouts. Variant `thelounge` received four warning-
  bearing test outputs, and all six of its test commands piped `run_tests` through `tail`.

Research supports the direction, not our exact thresholds:

- Coherence Collapse found that capable agents often reach the right function and later corrupt it;
  exact mid-trajectory gold patches were recoverable by checkpointing.
- More with Less found large cost reductions from turn limits/reminders, but its no-reminder table
  was a retrospective truncation analysis, not an independently rerun reminder ablation. Its p75
  caps also reduced solve point estimates for two of three tested models.
- To Run or Not to Run found execution value concentrated and model-dependent. Its OpenCode result
  used Qwen2.5-Coder-32B and does not select a quota for Grok/OpenCode 1.18.4.
- EET is experience-driven early termination. Its 19–55% cost result motivates replay and staged
  control but does not validate a deterministic two-cycle rule here.

Therefore every controller component starts as telemetry, then advisory behavior, and only then—if
the safety gates pass—enforcement.

## 1. Phase 0a — remove the verified harness amplifier

### 1.1 Root defect

`harness/rt-condense-lib.mjs` extracts code-shaped identifiers from added lines and treats absence
from the project symbol index as evidence that the identifier is unresolved. That authority is
invalid for runtime globals (`Promise`, `AbortSignal`), local lexical bindings, some imported aliases,
and other language constructs.

`harness/rt-shim-runtime.mjs` then suppresses the authority banner whenever this warning exists and
appends the warning as the final line. A caller using `run_tests | tail` preferentially retains the
false warning and discards leading baseline/authority context.

### 1.2 Immediate fix

Do **not** add a growing runtime-global allowlist, and do not describe another project-index query as
an “index-aware fix”—the current implementation already queries that index. The safe Phase-0 change
is:

1. Disable the unresolved-identifier warning by default. Keep any experimental implementation
   behind an explicit default-OFF flag until a language parser/compiler can authoritatively resolve
   references.
2. Never condition authority rendering on a warning.
3. Append a compact, machine-parseable footer **after** raw test output so pipes preserve it:

```text
[run_tests verdict] status=PASS|FAIL|INFRA scope=full|targeted exit=N
[run_tests baseline-diff] verdict=PASS|FAIL|INFRA introduced_failures=N pre_existing_failures=N trustworthy=yes|no <bounded signatures>
[run_tests guidance] verdict=PASS|FAIL|INFRA action=<bounded controller text or none>
```

4. Put optional diagnostics above those final lines. Nothing may render after the guidance line.
5. Preserve the raw test output and existing result condenser; the footer summarizes rather than
   replaces the authoritative evidence.

### 1.3 Required tests

- `Promise`, `AbortSignal`, locally declared names, import aliases, comments, and strings never
  suppress or displace the verdict.
- PASS, FAIL, baseline-only FAIL, introduced FAIL, infra error, targeted fallback, and deduplicated
  responses all end with the three footer lines.
- `run_tests | tail -n 3` and `tail -n 30` retain the complete footer. Fixtures for the common
  existing PASS/FAIL `rg ... | tail` filters retain the verdict and baseline counts because every
  footer line carries the verdict; arbitrary user filters are not claimed safe.
- Footer status agrees with raw exit status and baseline-diff classification.
- Feature-disabled output contains no unresolved-identifier warning.
- Existing authority, baseline, dedup, pattern, integrity, and result-retention suites remain green.

This changes the harness config hash. Explicitly reopen the frozen files, disclose the comparability
break, and re-sweep the golden ledger before any model run.

## 2. Phase 0b — observe state without steering behavior

Add a controller ledger before adding controller prose. One cycle is:

> one or more source edits since the previous comparable test, followed by a `run_tests` result.

The initial clean reproduction is cycle 0, not an attempted repair. Multiple edit tool calls before
one test remain one cycle.

For every test invocation, append one JSONL record outside the graded workspace containing:

- task, arm, run, model turn, cycle number, timestamp, and controller version;
- exact test scope: full or normalized targeted pattern;
- diff hash, binary patch hash, untracked-source fingerprint, patch files, and patch size;
- normalized raw failure signature, introduced-failure set, and pre-existing-failure set;
- target/build status and deterministic build-stage code when available;
- dedup/cache decision and whether the suite actually executed;
- candidate-best and verified-best checkpoint identifiers;
- trigger count, advisory text emitted, and subsequent action class; and
- raw result/checkpoint retention path.

Retain every distinct source patch needed for offline grading. A checkpoint bundle must contain a
binary diff plus validated copies/manifests for untracked source files, stored under runner state—not
inside the repository. Paths are repository-relative, traversal-safe, and exclude benchmark,
instruction, test, `.sweet-search`, and runner-state files.

Telemetry-only mode emits no new model-visible text and changes no stopping behavior. Validate that
its output bytes are unchanged except for the Phase-0 footer correction.

## 3. Deterministic state and progress definitions

### 3.1 Comparable cycles

Two results are comparable only when they use the same normalized test scope and the baseline label
is trustworthy. Results from different targeted patterns may be recorded but never ranked against
one another. A full-suite result dominates targeted evidence for verified checkpoint selection.

An infra error, timeout, tamper signal, untrusted baseline, or non-executed dedup response is not a
progress or non-progress observation.

### 3.2 Objective progress

For comparable results, progress is one of:

- the introduced-failure set becomes a strict subset with no new introduced signature;
- the issue-relevant failing test changes from fail to pass;
- a deterministic build pipeline advances to a later stage; or
- the first trustworthy full-suite validation establishes a better canonical state.

The following are **not** progress:

- a changed diff hash by itself;
- a new command, probe, or diagnostic by itself;
- model confidence or a new explanation;
- changing the targeted-test pattern;
- eliminating a pre-existing failure unrelated to the issue; or
- obtaining the same normalized failure set from a different patch.

A genuinely new diagnostic is an allowed recovery action, not a way to reset the progress counter.

### 3.3 Non-improvement and oscillation

A non-improving cycle is a trustworthy comparable cycle after a source change that satisfies none of
§3.2. Consecutive means consecutive comparable cycles; infra/unsupported results pause rather than
reset the count.

Record separately:

- exact-state repeat: same diff hash and failure signature;
- failure-state repeat: different diff, same normalized failures;
- A↔B oscillation: a previously seen diff/failure state recurs; and
- degradation: new introduced failures or an earlier build stage.

## 4. Checkpoint policy

### 4.1 Candidate and verified checkpoints

- **Candidate checkpoint:** any distinct source patch after a trustworthy targeted or full result.
- **Verified checkpoint:** candidate observed under the canonical full `run_tests` scope with a
  source edit, no prohibited-file changes, and trustworthy baseline classification.

Only a verified checkpoint can be automatically restored. Targeted results can recommend which
candidate deserves a full verification but cannot outrank a verified checkpoint.

Rank verified checkpoints lexicographically:

1. issue-relevant tests pass;
2. fewer introduced failures;
3. later deterministic build stage;
4. no prohibited or test-file edits; and
5. smaller source patch as a tie-breaker only.

Pre-existing failures are neutral. Model prose and historical gold patches are never inputs to the
online score.

### 4.2 Grade before restore

Before enabling restore or termination behavior, write both final and selected-best patches to dev
predictions and grade both with the real evaluator. Report:

- best wins / ties / losses versus final;
- how often the selector chose a grader-worse patch;
- whether a successful final trajectory would have been interrupted before its first passing patch;
  and
- checkpoint storage/restore failures.

No hard restore is permitted until the development evidence has **zero observed grader regressions**
and enough trigger exposures that the one-sided 95% upper bound on regression risk is below 5%.
With zero regressions, that requires at least 59 independent triggered tasks. If exposure is smaller,
remain advisory regardless of apparent precision.

## 5. Maximal $0 replay on development histories

Replay all reconstructible `DEV-RET`, `DEV-OLD`, and Stage-1 trajectories. Missing intermediate
patches are reported missing; never impute a best checkpoint.

For candidate trigger thresholds of 2, 3, and 4 consecutive non-improving cycles, calculate per
cross-validation fold:

- tasks and cycles exposed;
- eventual solve rate after the trigger;
- fraction of eventually solved tasks triggered before their first passing patch;
- remaining turns, edits, tests, input tokens, and realized dollars after the trigger;
- best-versus-final offline grades where reconstructible;
- exact/failure-state/A↔B/degradation composition; and
- pre-frame versus post-frame estimates.

Choose the advisory threshold using cross-validated development utility, not the full-data apparent
fit. Do not choose an enforcement threshold from precision alone: a “95% failure predictor” can still
terminate one recoverable task in twenty.

Replay exit gate:

- classifier fixtures cover every state transition;
- fold assignment and threshold-selection rule are fixed;
- no `HO2` input was read;
- advisory trigger has enough exposure to justify a live behavior test; and
- enforcement remains OFF unless §4.2 is already satisfied.

## 6. Advisory progress controller

The first model-visible controller is a footer appended only after trustworthy `run_tests` results.
It is correctly described as **per-cycle feedback**, not per-turn injection.

Let `H` be the advisory threshold selected in §5 from the fixed candidates `{2, 3, 4}`. The
pre-replay default candidate is 2, but live text and behavior use the selected, hashed value of `H`:

1. After `H` consecutive non-improving comparable cycles, report the unchanged failure state,
   current-versus-best checkpoint, and remaining recovery allowance. Permit one recovery step:
   re-read the failing span, run one targeted diagnostic/probe, or perform one fresh-context review.
   Do not instruct another blind edit.
2. If the next comparable cycle (`H + 1`) still does not improve, recommend restoring the
   verified-best checkpoint and submitting/reviewing from it. In advisory mode the agent remains in
   control.
3. When issue-relevant tests pass and only pre-existing failures remain, allow one bounded review
   turn of the issue, diff, and test evidence. A further edit requires a concrete missing requirement
   named in the ledger; otherwise submit.

The footer is bounded, machine-parseable, and tail-safe. It does not repeat full failure logs or
resident instructions.

Advisory mechanism gates on `DISCOVERY-20`:

- at least 80% of triggered next actions are recovery, restore, or submission rather than another
  ungrounded edit;
- blind-edit cycles and p90 post-trigger turns decrease;
- no recurring controller-induced task-completion failure appears; and
- operations and context-width gates from `TURN_FIX_PLAN.md` pass.

These are behavior gates, not solve non-inferiority claims.

## 7. Turn budget — a separate, true per-turn treatment

A test footer is not a per-turn reminder. Use the benchmark-local request-hook design and pinned-
version preflight in `TURN_FIX_PLAN.md` §4.5. The candidate seam on OpenCode's current V2 API is
`ctx.session.hook("request")`, which can mutate request messages immediately before model dispatch;
`tool.execute.after` is not an injection substitute. Load the plugin explicitly from generated
per-run config, never from a task repository, and use the same plugin bytes in both arms. The V2 API
is beta, so lack of compatible support in pinned OpenCode 1.18.4 makes this arm **NO-GO**, not a
reason to change the benchmark binary.

Append one ephemeral user-role countdown message per eligible request and log session ID, model-step
index, reminder hash, limit, remaining turns, and preceding-observation type. An isolated
request-capture fixture must show exactly-once outbound injection, no cumulative persistence, and
reconciliation with model-step records. Coverage below 99% in either arm fails preflight.

Initial faithful adaptation:

- derive pooled p50 and p75 turns from the fresh repaired-harness development baseline;
- use the same numeric limits on native and Sweet;
- define one budget unit as a completed assistant model step; provider/transport retries are logged
  and costed but do not create a second agent decision or decrement the task budget;
- announce the p50 initial budget from the start and show exact remaining turns every model step;
- if the task is unfinished at p50, automatically grant one extension to p75—do not initially make
  extension conditional on the progress classifier;
- reserve the final three turns for canonical validation, best-checkpoint restoration if necessary,
  and submission; and
- at p75, preserve the verified-best patch and request finalization rather than discarding the
  workspace with no answer.

The p75 value is a hard ceiling on completed assistant model steps, not a suggestion. The
finalization instruction begins when three steps remain and must finish inside the cap. When the cap
is exhausted, the runner starts no new model request, retains the current patch plus every captured
checkpoint, and runs ordinary grading. `budget_exhausted` is a treatment outcome—not an infra
exclusion—and its full cost and solve result remain in the assigned pair. Automatic restoration at
that boundary remains disabled until §4.2's checkpoint-safety gate passes.

Automatic extension is intentionally separated from experience-driven early termination. A later
progress-gated extension is a new treatment and must pass its own dev experiment.

Run the countdown/budget arm separately from the advisory controller on `DISCOVERY-20`. Advance only
if reminder coverage, finalization behavior, integrity, and completion tripwires pass. Do not call
the paper's cross-model cost range our expected Grok effect.

## 8. Test execution budget — optional separate arm

Do not use “unused budget is wasted”; it can encourage consuming the quota. First measure the fresh
baseline distribution of non-deduplicated suite executions among solved tasks.

If a quota experiment is justified:

- set shared `K = ceil(p75)` from the pooled fresh baseline, identical across arms;
- reserve one execution for final canonical validation;
- show `executions used / K` only after test results;
- existing identical-state dedup calls do not consume K;
- infra errors and unsupported targeted patterns do not consume K;
- start with a soft advisory counter; and
- test hard refusal as a later independent treatment only after solve-safety evidence.

Quota-1/Quota-3 results from other agents do not select K here. If the progress controller already
removes non-informative test loops, the quota may add no value and should be dropped.

## 9. Syntax pre-gate — correctness infrastructure, not generic lint

Before an expensive suite execution, optionally run a deterministic syntax/parser adapter on changed
source files:

- use a project/language-native parser only when its invocation and dependencies are known;
- unsupported language/file/config means abstain and run the suite normally;
- compare against baseline where the parser can surface pre-existing errors;
- never run a broad style lint as a universal gate;
- return the parse error quickly without consuming a suite execution; and
- do not auto-rollback in the first implementation.

Automatic rollback is a later feature requiring an exact last-edit delta and a verified checkpoint;
it must never erase earlier valid work. The syntax gate is arm-symmetric and independently flagged.

## 10. Optional Wave 2 — atomic edit/test and rollback tools

`apply_patch_and_test` can safely collapse an edit→test pair because sequencing occurs inside one
tool execution:

1. validate and apply a bounded source patch;
2. run the requested supported targeted test or canonical suite;
3. return patch status plus the standard tail-safe verdict; and
4. retain pre/post checkpoints for recovery.

It must be available identically to both arms, rejects test/harness/protected paths, and remains OFF
for the headline comparison until separately approved. It changes the stock-agent-runtime claim.

A syntax-failing atomic patch may roll back only the patch applied by that invocation. Never restore
or delete unrelated user/agent changes.

## 11. Live development experiment sequence

Use the cohorts and statistics defined in `TURN_FIX_PLAN.md`.

| stage | treatment | cohort | purpose |
|---|---|---|---|
| T0 | telemetry/checkpoint retention, no footer | Phase-1 `DISCOVERY-20` baseline | validate state capture and grade candidate checkpoints |
| T1 | advisory progress footer only | `DISCOVERY-20` | test trigger precision and behavior change |
| T2 | true per-turn dynamic p50→p75 budget only | `DISCOVERY-20` | test urgency/finalization independently |
| T3 | soft test counter only, if justified | `DISCOVERY-20` | test whether quota adds information beyond T1/T2 |
| T4 | combine only passing components | `DISCOVERY-20` 2×2 | estimate interaction with native versus winning Sweet surface |
| T5 | frozen two-arm confirmation | `CONFIRM-28`, then `EXPAND-32` on predeclared triggers only | establish cost reduction; gross solve-safety screen (powered non-inferiority at n≥60 or `HO2`) |
| T6 | frozen headline comparison | `HO2` | untouched aggregate milestone only |

Do not combine T1–T3 in their first live run. If a component changes after seeing T4/T5 outcomes, it
returns to development discovery before another confirmation.

Budget rules (user, 2026-07-31): a screen may run its arms sequentially — Sweet first, native only
after the Sweet arm passes its behavior gates. Reuse the Phase-1 baseline as the control/OFF cells
whenever every non-treatment config hash matches; rerun it otherwise. T2 runs only if the plugin
preflight passes AND T1 alone leaves the tail alive. T3 stays skip-by-default.

The repaired-harness Phase-1 baseline may serve as the common control for T0–T3 only when task list,
model/provider, prompt, search surface, runner, and every non-treatment config hash are identical.
Otherwise rerun the control; never compare cells separated by an unrecorded config change.

T5 controller enforcement may be enabled only if the offline checkpoint safety gate already passes;
otherwise T5 tests the advisory controller and turn budget, with checkpoint retention but no forced
restore.

## 12. Kill and fallback rules

- **Warning/footer fix:** mandatory correctness repair; failure of tail-safe fixtures blocks all runs.
- **Telemetry:** any lost/corrupt patch, path escape, workspace mutation, or result mismatch blocks
  model-visible controller work.
- **Advisory controller:** kill or recalibrate if it induces a recurring completion failure, fails to
  alter post-trigger behavior, or inflates operations/context beyond the shared gates.
- **Hard restore/termination:** remain OFF without §4.2's safety exposure and fresh confirmation
  non-inferiority. Advisory mode is the fallback.
- **Turn budget:** kill if per-turn coverage is below 99%, finalization loses the best patch, or the
  powered solve interval crosses the −5pp margin. A larger shared cap is a new preregistered arm.
- **Test quota:** drop if it does not reduce non-deduplicated executions/cost or if any repeatable
  quota-caused completion loss appears.
- **Syntax gate:** abstain on uncertainty; never convert unsupported parsing into a task failure.
- **Combined controller:** no `HO2` run unless the final development contract in
  `TURN_FIX_PLAN.md` passes.

## 13. Implementation acceptance checklist

Before paid execution:

- controller flags default OFF and are recorded in every result row;
- ledger schema/version, exact reminder/footer text, thresholds, budgets, and checkpoint selector
  are hashed;
- unit tests cover comparable scopes, progress/non-progress, infra abstention, oscillation,
  checkpoint ranking, path validation, and finalization reserve;
- replay tests cover known `thelounge` oscillation plus successful long trajectories that must not
  be cut;
- both native and Sweet receive byte-identical harness policy;
- raw streams, DB/WAL, turn logs, controller ledgers, and checkpoint patches survive retention;
- boolean grading admission, integrity checks, `escape=0`, green ledger, and
  `PREFLIGHT_ONLY=1` all pass; and
- no production M± change, commit, push, or paid run occurs without explicit authorization.

## 14. Intended outcome

The controller succeeds only if it turns expensive tails into one of two safe outcomes:

1. the agent uses objective feedback to recover and complete the task sooner; or
2. the agent preserves and submits its best verified patch instead of corrupting it through further
   edits.

Merely terminating failures cheaply is not success. Completion retention and lower cost must both
survive the powered development confirmation and then the untouched `HO2` evaluation.
