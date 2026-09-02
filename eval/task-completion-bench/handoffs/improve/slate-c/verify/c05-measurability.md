# c05 — adversarial verify, DIFFERENTIAL and MEASURABILITY lens

**Verdict: REFUTED as a lever. Confidence 0.94.**

The mechanism is admissible in class. It is not a re-rendering. It does not use task identity.
Its vehicle is sweet-only on two of three harnesses. It fails on three measured grounds.

First, the headline exposure number is a tuning artefact, not a property of the world. The
candidate reports "fires 15 of 390 cells, all on one task". I re-ran the predicate against the
candidate's own `census.json`. The underlying signal fires on **45 of 390 cells across 4 tasks**
`[M]`. One internal gate — the face refuses to print when the edited function name resolves
ambiguously — suppresses 30 of those 45 cells and 3 of the 4 tasks `[M]`. Exposure therefore
swings between 1 task in 22 and 4 tasks in 22 on a single design choice that has never been
screened.

Second, the pre-registered kill condition cannot fire. Falsifier (a) kills the face at "more than
5 flagged functions per repository on more than 4 of 22 goldens". The measured distinct flagged
functions per firing task are 1, 2, 1 and 1 `[M]`. Both the narrow and the wide setting pass that
gate, so the gate is non-binding by construction. The cost kill condition ("+1% on non-firing
tasks") needs about **80,325 rollouts per arm** for 80% power `[I from M]`. One cell of the
recommended paid run is 81 rollouts, so that is about 990 times a cell.

Third, the claimed effect is one fifth of the bench's measurement floor. I computed the paired
(McNemar) resolution of the fresh pool, which is more powerful than the unpaired count the ±6 bar
was written against. The head-to-head signal on each harness rests on **6 discordant pairs on
codex, 5 on claude-code, 2 on opencode** `[M]`. The minimum detectable paired effect at 80% power
is **6.8 rollouts of 66** `[I from M]`. The candidate claims +1.

A fourth fact makes even a successful flip uninterpretable. The single firing task is the only
task in the whole 22-task pool where the test shim returned an infrastructure verdict, in every
arm and every harness `[M]`. I verified that independently and found no other task with one.

---

## 1. What I checked

| item | path or command |
|---|---|
| brief, draft register | `slate-c/BRIEF.md`, `slate-c/DEAD-LEVER-REGISTER-DRAFT.md` (read in full) |
| candidate source | `slate-c/candidates/resolution-computed-facts.md` §3.1–3.8, §6.A, §6.B, §6.E |
| the face's own predicate | `slate-c/candidates/scripts-resolution-computed-facts/census_edited_functions.py:292, 342, 367, 380` |
| the face's own output, re-counted | box `/tmp/wf-slatec/resolution-computed-facts/census.json` (390 cells, 588 function records) |
| solves, cost mean, cost SD, calls | box `results/fp-{codex,opencode,claudecode}-tab-20260826/rows.json`, `results/rp-oc-tab-20260827/rows.json` |
| paired discordance | `/tmp/wf-slatec/c05-measurability-v2/mcnemar.mjs` |
| marginal price of one call | `/tmp/wf-slatec/c05-measurability-v2/marg.mjs` (OLS of `costRealizedUsd` on `calls`, per cell) |
| codex tool surface, all 66 sweet rollouts | `find … -path "*-sweet/codex-home/sessions/*" -name "rollout-*.jsonl" \| xargs grep -oh '"name":"[a-z_]*"' \| sort \| uniq -c` |
| infrastructure verdict census | `grep -rl "status=INFRA" <run>/agent-state` over all 4 fresh-pool runs |
| grade definition | `harness/evaluator-runtime.mjs:11–20` |
| opencode plugin preflight | `harness/opencode-task-runner.mjs:69–77, 98` |
| per-arm isolation | `harness/claude-code-task-runner.mjs:289–293`; `harness/codex-task-runner.mjs:451–466` |
| the one hook this program deployed | `harness/claude-code-task-runner.mjs:59–85`, `:105–131` |
| graph expansion gating | `core/search/search-postprocess.js:496`, `:788` |
| pre-registered bar | `handoffs/improve/FRESH-POOL-RESULTS.md:46` |

Box scratch: `/tmp/wf-slatec/c05-measurability-v2/`. Nothing written under `results/`. HO2 untouched.
No grading log opened. No hidden test name and no gold patch content read or printed. Spend `$0`.

## 2. Where the candidate is clean

I state this first so the synthesis does not over-kill.

- **Not the banned rendering class.** It prints new computed text. No span carries a bound argument
  expression plus an emptiness flag. Rule 7 is satisfied.
- **No task identity at runtime.** The face reads a file path and a method name from the agent's own
  edit. Rule 10 is satisfied.
- **The cached prefix does not move.** A hook is configuration, not a tool schema. Injected context
  lands after the cached prefix, so it does not invalidate the cache. Register A4's prefix problem
  does not apply.
- **Per-arm isolation is real on codex and claude-code.** Both runners build a rollout label as
  `${task.id}-${arm}` and derive the agent home from it `[C claude-code-task-runner.mjs:289–291;
  codex-task-runner.mjs:451–462]`. A hook written into those homes reaches the sweet arm only.
- **Hook discovery demonstrably works on claude-code.** The runner's own record shows a `PreToolUse`
  hook ran 189 times `[C claude-code-task-runner.mjs:59–72]`. That closes the "does a hook fire at
  all" question on one harness. It leaves open whether `PostToolUse` `additionalContext` reaches the
  model on the pinned build.

## 3. The decisive finding: exposure is a tuning artefact and the falsifier cannot fire

### 3.1 One internal gate moves exposure by 3× `[M]`

The census records, per edited function, a raw count `nFlaggedCallSites` and a boolean `ambiguous`.
The summary column the candidate quotes applies both: `not ambiguous and nFlaggedCallSites >= 1`
`[C census_edited_functions.py:367, 380]`.

I recomputed both readings over the same 390 cells:

| predicate | cells | tasks | sweet cells | sweet solved | sweet lost |
|---|---:|---:|---:|---:|---:|
| `nFlaggedCallSites >= 1` **and** `not ambiguous` (candidate's headline) | 15/390 | 1 | 6 | 4 | 2 |
| `nFlaggedCallSites >= 1` (raw signal) | **45/390** | **4** | 21 | 16 | 5 |

The 30-cell, 3-task gap is entirely the ambiguity gate `[M]`. The suppressed tasks are
`aio-libs__aiohttp-8038` (9 cells), `asynkron__protoactor-dotnet-1909` (18 cells) and
`apigee__registry-961` (3 cells). Across the whole census, 212 of 588 function records are marked
ambiguous, which is 36.1% `[M]`.

Two things follow. The claim "0 on other 21 tasks" is not a fact about the code base. It is a fact
about one threshold. And "fires on 1 file in 152,270", the F3 shape the register warns about, is
not established either: the raw fact exists on 4 of 22 tasks, which is 18%.

### 3.2 The pre-registered kill number is non-binding `[M]`

Falsifier (a) kills the face if it exceeds "5 flagged functions per repository on more than 4 of 22
goldens". Measured distinct flagged functions per firing task:

| task | distinct flagged functions |
|---|---:|
| `accenture__sfmc-devtools-1974` | 1 |
| `aio-libs__aiohttp-8038` | 2 |
| `asynkron__protoactor-dotnet-1909` | 1 |
| `apigee__registry-961` | 1 |

Every value is at or below 2, against a bar of 5. The wide setting fires on 45 of 390 cells and
still passes. The narrow setting fires on 15 and passes. **The gate cannot separate them.** A
falsifier that both settings pass is not a falsifier.

Falsifier (a) also counts the wrong denominator. The hook fires per **edit event**, not per final
patch. The census evaluated one function per cell, 390 in total. Across the 66 codex sweet
rollouts the only tool names in the whole transcript set are `exec_command` (924), `update_plan`
(259) and `write_stdin` (45) `[M]`. So a codex matcher fires 14.0 times per rollout, not once.
On claude-code the `Edit` tool is called 245 times across 66 sweet rollouts, 3.7 per rollout
`[M rows.json toolCounts]`. The operative rate — flagged given an edit event — has never been
measured, and there are 3.7 to 14 times more chances to print than the census counted.

Three different denominators appear in the candidate: cells (measured), functions per repository
(the falsifier, never run), and edit events (the real one, never defined).

## 4. The one firing task is confounded with an infrastructure failure

I grepped for the shim's infrastructure verdict across all four fresh-pool runs' `agent-state`
directories `[M]`:

```
fp-codex-tab-20260826       accenture…-sweet 3, accenture…-native 3
fp-opencode-tab-20260826    accenture…-native 5, accenture…-sweet 4
fp-claudecode-tab-20260826  accenture…-sweet 3, accenture…-native 3
rp-oc-tab-20260827          accenture…-sweet 5
```

No other task in the 22-task pool produced one, on any harness, in either arm. The candidate's
§3.7 claim is correct and I confirm it independently.

The grade fields say what the six addressable cells lost on. All six carry `f2pFrac = 1` with
`resolveStatus = "NO"` `[M rows.json]`. The grader sets `FULL` only when `f2pFrac === 1` **and**
`p2pOk` `[C evaluator-runtime.mjs:13–19]`. So these cells satisfied every fail-to-pass assertion
and broke at least one previously passing test. They are collateral-damage losses, not the
"missed hidden assertion" class the brief names as modal.

That is exactly the failure a working test signal catches. The lever's whole exposure therefore
sits on cells where an arm-universal bench defect removed the verification the agent needed. A
free, arm-symmetric fix (the candidate's own item E) addresses the same cells. Two consequences:

1. A future flip on this task cannot be attributed to the certificate rather than to the changed
   infrastructure.
2. If item E ships, candidate A's exposure falls to zero. The two items cannot both stand.

## 5. Differential: what actually reaches the sweet arm

| leg | reaches sweet only? | measured obstacle |
|---|---|---|
| claude-code `PostToolUse` | yes, per-arm `claudeHome` `[C:289–291]` | the runner installs its existing hook for **both** arms unconditionally `[C:293]`, so an arm-conditional install is a change to shared bench code |
| codex `PostToolUse` | yes, per-arm `codexHome` `[C:451–462]` | **no edit tool exists to match**: 66 sweet rollouts contain only `exec_command`, `update_plan`, `write_stdin` `[M]`. The matcher must fire on every shell call and parse heredocs |
| opencode `tool.execute.after` | blocked | preflight throws `ambient OpenCode plugin detected` when `resolved.plugin.length !== 0` `[C opencode-task-runner.mjs:74–76]`; `buildMainOpencodeConfig` hard-codes `plugin: []` `[C:98]` |
| `ss-trace` bindings section | yes | agent-invoked; the candidate's own demand figure is 0.2–0.6 calls per rollout |

The opencode leg is dead weight three times over. The preflight blocks it. The ledger records
`toolCounts.edit = 0` for both opencode arms across 129 rows `[M]`, so there is no recorded tool
name to match. And opencode has **0** addressable sweet losing cells at the narrow setting `[M]`.

The precedent for hooks in this program is one deployment and it was inert. The runner carries the
finding in a 30-line comment: the hook ran on 189 calls that needed nothing and never ran on the
110 that all needed it `[C claude-code-task-runner.mjs:59–72]`. That comment is about argument
validation order, so it does not transfer to `PostToolUse`. It does establish the rule: a string in
a binary is not a working hook.

## 6. Measurability: the effect sits below every floor

### 6.1 Paired resolution of the fresh pool `[M]`

| harness | pairs | sweet-only | native-only | discordant | difference | 95% CI half-width | McNemar exact p |
|---|---:|---:|---:|---:|---:|---:|---:|
| codex | 66 | 2 | 4 | 6 | −2 rollouts | ±4.8 rollouts | 0.6875 |
| opencode | 63 | 0 | 2 | 2 | −2 rollouts | ±2.8 rollouts | 0.5000 |
| claude-code | 66 | 1 | 4 | 5 | −3 rollouts | ±4.4 rollouts | 0.3750 |

At the observed 9% discordance rate the minimum detectable paired effect at 80% power is
**6.8 rollouts of 66** `[I from M]`. This re-derives the pre-registered ±6 bar from the data, using
the more powerful design. The candidate's +1 is **15% of that floor**. The unpaired cross-check
agrees: a +1-of-66 solve difference needs about **16,430 rollouts per arm per harness** at 80%
power, which is about 200 cells of the recommended run `[I from M]`.

Post-lever at a 100% flip of every addressable sweet cell: codex 40 against native 41
(McNemar p = 1.000), claude-code 41 against 43 (p = 0.6875) `[M]`. **The lever does not reach
parity on either harness even when every cell flips.** The program's goal is "solve at least as
many". This lever cannot deliver it.

At the wide setting the addressable sweet losing cells are 5, split codex 2, opencode 1,
claude-code 2 `[M]`. Codex would reach 41 against 41. Three of those 5 cells are `aiohttp` cells
with `f2pFrac = 0`, meaning the fix never satisfied the target behaviour `[M]`. The flagged
function there is `__init__` with 64 call sites, 2 flagged, and an ambiguous name.

### 6.2 Cost resolution `[M]`

| cell | n priced | mean $/rollout | SD | SE of the mean | SE as % of mean |
|---|---:|---:|---:|---:|---:|
| codex sweet | 66 | 0.012330 | 0.008820 | 0.001086 | 8.8% |
| codex native | 66 | 0.012287 | 0.008024 | 0.000988 | 8.0% |
| opencode sweet | 63 | 0.009201 | 0.007731 | 0.000974 | 10.6% |
| claude-code sweet | 57 | 0.015127 | 0.011330 | 0.001501 | 9.9% |

A +1% cost effect on codex sweet is $0.000123, which is 0.11 standard errors. Detecting it at 80%
power needs about **80,325 rollouts per arm** `[I from M]`. The recommended paid run is 486
rollouts in total and 81 rollouts per cell (register G5), so the requirement is about 990 cells.
The gate is unfalsifiable at this bench's resolution. The smallest cost effect the recommended run
can see on one codex cell is about **±10%** (1.96 standard errors of the mean, two cells).

### 6.3 The cost lands where the gate does not look `[M]`

I regressed rollout cost on call count inside each cell:

| cell | USD per extra call | share of a mean rollout |
|---|---:|---:|
| codex sweet | 0.000923 (SE 0.000032) | 7.5% |
| opencode sweet | 0.000558 (SE 0.000028) | 6.1% |
| claude-code sweet | 0.000744 (SE 0.000031) | 4.9% |

The injection itself is cheap. A 120-token certificate costs $0.000031 on codex sweet, 0.25% of a
rollout, using the registered prices and the 15.9 re-sends per ingested token `[I from M]`. The
candidate's amortised figure (under 0.1% of a cell) is arithmetically right.

"Requests unchanged" is right only while the certificate is ignored. The mechanism's success
condition is that the agent revises an edit it has already made. That costs at least one call, and
realistically an edit plus a verify. On codex that is 7.5% to 19% of the firing rollout. The
pre-registered gate excludes firing cells by construction, so it declines to measure the only
channel where this lever's cost lands.

### 6.4 The sign of the effect is set by an unmeasured parameter `[M/I]`

The face fires on already-solved cells more often than on losing ones.

| setting | sweet cells fired on | already solved | losing (addressable) | ratio |
|---|---:|---:|---:|---:|
| narrow | 6 | 4 | 2 | 2.0 : 1 |
| wide | 21 | 16 | 5 | 3.2 : 1 |

Let `f` be the flip rate on addressable losing cells and `d` the rate at which the extra content
breaks an already-solved cell. Narrow: net = 2f − 4d, break-even at d = f/2. Wide: net = 5f − 16d,
break-even at d = 0.31f. At the hint ladder's realistic f = 0.5, a disturbance rate of 25% (narrow)
or 16% (wide) makes the lever negative. Widening the face makes this worse, not better.

`d` is not measurable at `$0`. It is the recorded B12 failure mode: the same program measured
whole-file span expansion at replay −1.6/−2.1/−4.7% and live **+4.78/+19.79/+11.72%**. The
pre-registered kill condition covers a solved cell *contradicted*. It does not cover a solved cell
*disturbed*.

The sampling noise on the firing set is also larger than the claim. Six firing sweet cells at an
even flip rate have a binomial standard deviation of 1.22 cells `[I]`.

### 6.5 The exposure lottery `[M/I]`

At the narrow setting the firing rate is 1 task in 22. The Wilson 95% interval is [0.8%, 21.8%].
The probability that a fresh 22-task pool contains **zero** firing tasks is **36%** at the point
estimate and **84%** at the interval's lower bound `[I]`. The most likely single outcome of the
recommended paid run is a lever with no exposure. That is an unmeasurable result, not a null one.

To move one harness by the ±6 bar at a 100% flip needs about 9 firing tasks of 22 `[I]`. At a 50%
flip rate it needs about 18 of 22.

## 7. Rule checks

| rule | verdict |
|---|---|
| 6 differential | Passes on codex and claude-code. The opencode leg needs a bench-code change that trips the run's own integrity gate `[C]`. |
| 7 no same-information compaction | **Passes.** New computed lines, not smaller renderings. |
| 8 ranking-signal gating | **Part B needs a screen the candidate does not ask for.** `search-postprocess.js:496` runs `expandResults(graphDb, …)` whenever a graph index exists and the query is not confidently lexical. There is no `_isAgentFormat` gate on that path; `isAgentFormat` is first computed at `:788` for a different purpose `[C]`. Adding JavaScript `#private` entities and Elixir call edges changes graph content for ordinary natural-language queries. GCSN and the other retrieval benchmarks can move. Part B's "solve risk: none, correctness only" is wrong as stated. |
| 9 solve is the veto | Not violated. Also unproven: nothing measured shows the printed fact changes a choice. |
| 10 no task identity, gold or hidden tests at runtime | Passes. |
| 11 new tool | Correctly flagged. Add that a harness hook is a non-CLI contact surface, the family excluded for MCP (register A4). |
| 12 owner decisions | None reopened. |
| HO2 | Untouched. |

## 8. Corrections the synthesis must adopt

1. Replace "flagged face fires 15/390, all accenture, 0 on other 21 tasks" with: "**the raw signal
   fires on 45 of 390 cells across 4 tasks; one ambiguity gate suppresses 30 cells and 3 tasks;
   36.1% of all edited-function records are ambiguous**" `[M]`.
2. Replace "6 addressable losing cells" with "**6 losing cells at the narrow setting, of which 4 are
   native and unreachable by a sweet-only hook; the sweet-only ceiling is 2 of 198 sweet rollouts
   (1.0%), or 5 of 198 (2.5%) at the wide setting**" `[M]`.
3. Replace "realistic ~+1 solve, below ±6" with "**+1 rollout of 66 per harness at a 100% flip;
   the paired minimum detectable effect is 6.8 rollouts of 66, so the claim is 15% of the floor;
   even at 100% sweet still trails native 40-41 and 41-43**" `[M/I]`.
4. Mark falsifier (a) **non-binding**: measured distinct flagged functions per firing task are 1, 2,
   1, 1, all at or below a bar of 5, so both the narrow and the wide setting pass it `[M]`. It must
   be replaced before any build. Replace it with two numbers: an **exposure floor** (the face must
   fire on ≥9 of 22 tasks to have any path to +6 on one harness at a 100% flip) and a
   **precision-at-edit-event rate** measured on the real denominator.
5. Mark the cost kill condition ("+1% on non-firing tasks") **unfalsifiable**: about 80,325 rollouts
   per arm, roughly 990 times the 81-rollout cell of the recommended run `[I from M]`. The smallest
   visible cost effect on one codex cell is about ±10%. Re-scope it to firing cells.
6. Delete "requests unchanged". Replace with "**requests are unchanged only while the certificate is
   ignored; a successful revision costs at least one call at $0.000558–$0.000923, which is 4.9–7.5%
   of a rollout on the firing cell**" `[M]`.
7. Add the disturbance channel with its break-even numbers: **narrow 4 solved sweet cells against 2
   losing (break-even disturbance 25% at a 50% flip rate); wide 16 against 5 (break-even 16%)**.
   Widening makes the ratio worse `[M/I]`.
8. Add the confound: **`status=INFRA` appears on exactly one task of 22, in every arm and every
   harness, and on no other task** `[M]`. State that the six addressable cells carry `f2pFrac = 1`
   with `resolveStatus = "NO"`, which by the grader's own definition means a previously passing test
   broke `[M/C]`. Relabel them: collateral-damage losses, not "missed hidden assertion" wrong-fix.
   State that items A and E are mutually exclusive.
9. Add the vehicle facts: **opencode is blocked** by `opencode-task-runner.mjs:74–76`; **codex has
   no edit tool** — across all 66 sweet rollouts the tool names are `exec_command` (924),
   `update_plan` (259), `write_stdin` (45) `[M]`; **claude-code installs its existing hook for both
   arms unconditionally** (`:293`), so an arm-conditional install is a shared-bench-code change
   `[C]`. Raise the codex build-cost estimate above "half a day".
10. Add the retrieval caveat to part B: graph expansion is not format-gated
    (`search-postprocess.js:496`), so the code-graph fixes need a GCSN-class regression run before
    they ship `[C]`. Keep part B as a correctness bug with ceiling 0 solves and 0 cost. Never count
    it toward the lever's ceiling.
11. Add the exposure lottery: **36% chance of zero firing tasks on a fresh 22-task pool** at the
    point estimate, 84% at the interval's lower bound `[I]`.

## 9. What I could not finish

- I did not install or fire a hook on any of the three pinned binaries. That check costs `$0` and
  is the prerequisite the candidate supports only with string counts in a binary.
- I did not verify the graph-extractor claims in source (JavaScript `#private` entity emission,
  Elixir call-edge extraction). I verified the consumer side instead: graph expansion is ungated,
  which is what changes part B's shipping requirements.
- I did not run falsifier (a) as written. I showed by measurement that it cannot fire, which makes
  running it pointless.
- I did not measure the flagged rate per edit event. That needs a per-edit replay, which is `$0` but
  larger than this pass. It is the number the build depends on.
- I did not open any grading log, any hidden-test material, or HO2. The `f2pFrac`/`resolveStatus`
  reading above comes from numeric fields in `rows.json` plus the grader's source.
