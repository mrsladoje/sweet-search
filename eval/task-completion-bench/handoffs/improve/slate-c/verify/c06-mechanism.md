# Verify c06 (mechanism lens): runtime execution-path certificate ("which implementation runs for the issue's input")

Date: 2026-09-02. Agent: c06-mechanism (Slate C verify, second pass; this file replaces the first pass at the same path). Spend: $0. Nothing under `results/` was written. Box scratch: `/tmp/wf-slatec/c06-mechanism-r2/` (three read-only scripts, copied to `verify/scripts-c06-mechanism/`). Grading logs were not opened in this pass. No hidden test name and no gold content appears here. No HO2 task was read.

Tags: **[M]** measured (script or command named), **[C]** read from code, **[W]** web, **[I]** inferred.

## 0. Verdict

**Refuted.** Confidence 0.85.

The traces show the information gap the candidate describes. They do not show that closing it flips a cell. Ten of the 16 moq losers edited `Match<T>.Equals`, a method that never runs on the override path [M][C]. That part of the story holds. But four of the eight sweet losers edited the deciding method or the override-marking site itself and still lost [M]. Across both arms, seven cells edited that site and two won [M]. So a certificate that names the site converts at about 2 in 7, on the recorded evidence. The candidate's "13/16 patched the non-deciding path" is a file-level class that counts `ExpressionComparer.cs`, which is on the deciding path (`MethodExpectation.cs:253`) [C].

The ceiling arithmetic is wrong by more than a factor of two. The claim is +8 sweet cells at a 100% flip and about +4 at a borrowed rate, "the only face that could reach ±6". The pre-registered bar is ≥ +6 rollouts per harness [C]. Sweet moq losers are codex 2, opencode 3, claude-code 3 [M]. At a 100% flip no harness moves more than +3. Adjusted for what the certificate can actually tell an agent, the redirectable sweet cells are four, and at the observed 2/7 conversion the expected gain is about +1.1 solves pooled across three harnesses [I from M]. markup-it adds 0 by the candidate's own account.

The cited markup-it evidence is misread. "18/18 cells reproduced parse-only" should read: the library never loaded in any agent shell. The `require` calls failed on the library's own runtime dependencies (`slate`, `immutable`) in five of six task-cells, and the sixth ran regex probes only [M]. No cell reproduced the issue in either direction.

The reproduction cannot run where the candidate wants to trace it. The agent shell has no .NET toolchain and no `node_modules` [M]. The test container executes both suites offline, but the agent reaches it only through the parameter-free `run_tests` broker [C]. A tracer there needs a new broker verb, which is bench code (brief rule 3) and, if sweet-only, a rig privilege rather than a tool (brief rule 6).

Solves are not traded for cost here; the fact is descriptive and rejects nothing. The cost side is simply unpriced: one extra request at the final moq context costs about $0.0009 [M], the tracer payload is unknown, and moq is already the slowest family in the pool (median 402 s against a pool median of 103 s) [M].

## 1. What I re-derived

### 1.1 The 18 moq cells, from the raw patches

Script: `verify/scripts-c06-mechanism/moq_cells.mjs`, run on the box over `<run>/<arm>/patches.json` (rep 0) and `<run>/<arm>/rep-N/patches.json` (reps 1, 2) for `fp-codex-tab-20260826`, `fp-opencode-tab-20260826` (native only; the sweet rows are superseded), `rp-oc-tab-20260827` (opencode sweet), `fp-claudecode-tab-20260826`. Hunk counts matched `rows.json.patchHunks` in 18 of 18 cells [M].

| count | set | cells |
|---:|---|---|
| 18 | canonical moq cells (3 harnesses × 2 arms × 3 reps) | solved 2: `c:n1`, `c:s2` |
| 16 | losers | sweet 8 (codex 2, opencode 3, claude-code 3); native 8 |
| 13 | losers touching `Match.cs` or `ExpressionComparer.cs` (the census class behind "13/16") | — |
| 12 | losers touching `Match.cs` | 10 of them edit inside `Match<T>.Equals` (lines 202–230); `cc:s1`, `cc:s2` edit only the `RenderExpression` lines (168, 242) |
| 8 | losers touching `ExpressionComparer.cs` | on the deciding path via line 253 |
| 8 | losers touching `MethodExpectation.cs` | `c:s1 c:n0 o:n0 o:n1 o:n2 o:s0 o:s2 cc:n0` |
| 4 | losers editing inside the deciding method `Equals` (201–260) or the override-marking `Add` (43–51) | `c:s1` (207), `o:s0` (207), `o:s2` (250), `cc:s0` (`SetupCollection.cs:45`); all sweet |
| 4 | losers editing neither `MethodExpectation.cs`, `SetupCollection.cs` nor `ExpressionComparer.cs` (strictly off the path) | `c:s0` (`MatcherFactory.cs`), `o:s1`, `cc:s1`, `cc:s2` (`Match.cs` only); all sweet |
| 0 | cells adding a file, touching a test path, or with a non-empty `strippedTestPaths` | — |

Notation: `c:` codex, `o:` opencode, `cc:` claude-code; `s`/`n` sweet/native; digit = rep.

### 1.2 What the on-path sweet losers did (agent patches, read with `moq_hunks.mjs`) [M]

- `c:s1` (`fp-codex-tab-20260826/sweet/rep-1`): built an `ExpressionComparer` mode that skips capture evaluation, but wired it into `Match.cs`, not into line 253. Inside `Equals` it added a generic-type-argument check (the issue's second half) and an `IsMoreSpecificThan` helper. Lost.
- `o:s0` (`rp-oc-tab-20260827/sweet` rep 0): added the same generic-type-argument check at `Equals` line 207. Its capture handling went through `Match.cs` and `ExpressionComparer.cs`. Lost.
- `o:s2` (`rp-oc-tab-20260827/sweet/rep-2`): wired a no-capture comparer at the deciding comparison (line 250–253) behind a gate `argumentMatchers[i] is Matchers.LazyEvalMatcher`. `It.Is` yields `Match<T>` (`It.cs:139–151` → `Match.Create`; `MatcherFactory.cs:156–160`), so the gate never fires. Lost.
- `cc:s0` (`fp-claudecode-tab-20260826/sweet` rep 0): inserted `if (setup.IsConditional) return;` into `SetupCollection.Add` at line 45, the exact override-marking site the winner `c:s2` edited. The issue's setups are not conditional. Lost.
- Winners for contrast: `c:n1` returns false in the `Equals` compare loop when both matchers are `Match` instances and not the same reference, plus a generic-argument check. `c:s2` skips override marking in `Add` when any argument matcher is non-constant, plus a specificity rule in `InterceptionAspects.cs`.
- `o:n0` (native, `fp-opencode-tab-20260826/native` rep 0) edited the compare loop at line 227 behind the same `LazyEvalMatcher` gate. Lost.

Conversion at the deciding site, both arms: 7 cells edited `Equals` (201–260) or `Add` (43–51) — `c:s1 c:n1 o:n0 o:s0 o:s2 cc:s0 c:s2` — and 2 won. **2/7 ≈ 29%** [M].

### 1.3 The deciding path in the base tree [C]

Golden: `/root/.ss-eval/golden/devlooped__moq@6c7e7a103381b25324be1675a97a533082bce226/src/Moq/`.

1. `SetupCollection.cs:43–51`: `Add` calls `this.activeSetups.Add(setup.Expectation)` on a `HashSet<Expectation>` (line 13) and, on a duplicate, `MarkOverriddenSetups()`. Equality is `MethodExpectation.Equals`.
2. `MethodExpectation.cs:201–260`: `Equals` compares method and argument count, fills `partiallyEvaluatedArguments = PartiallyEvaluateArguments(Arguments)` (215–223), then per argument calls `ExpressionComparer.Default.Equals(...)` (253). `argumentMatchers` is not consulted in `Equals`; it is used in `IsMatch` (136) and `SetupEvaluatedSuccessfully` (151).
3. `MethodExpectation.cs:262–278`: `PartiallyEvaluateArguments` calls `arguments[i].PartialMatcherAwareEval()` (274).
4. `ExpressionExtensions.cs:439–458`: `PartialMatcherAwareEval` runs `Evaluator.PartialEval` with a predicate that refuses `Parameter` nodes, `MatchExpression`, matcher-attributed calls, and any node whose `IsMatch` is true. `IsMatch` (67–79) compiles and invokes the sub-expression and asks a `MatcherObserver` whether a matcher was created. For `this.patternKey`, a string field access, no matcher is created, so the predicate returns true.
5. `Evaluator.cs:85–135`: the `Nominator` visits bottom-up and nominates `this.patternKey` (its only child is a closure constant). `Evaluator.cs:42–79`: the `SubtreeEvaluator` replaces the nominated node with `Expression.Constant(current value)`. The visitor descends through `Quote` and `Lambda` by default. Both setups therefore carry `It.Is<string>(y => y == "")` before any comparer runs.
6. `ExpressionComparer.cs:21–118`: compares the folded trees structurally; it handles `Quote` (56–59) and `Lambda` (98–99); `EqualsConstant` (158) returns `object.Equals("", "")`. Its own `EvaluateCaptures.Rewriter` step (36–44) is a second fold of the same kind.
7. `Match.cs:202–230`: `Match<T>.Equals` is not reached from steps 1–6.

So the candidate's example line — "`MethodExpectation.Equals` runs; `Match.Equals` is not on the path" — is true. The two facts that decided the losses are different: the capture fold happens at step 4–5, before the comparer, and `It.Is` produces `Match<T>`, not `LazyEvalMatcher`. A call-path listing would contain the frames `PartiallyEvaluateArguments` → `PartialMatcherAwareEval` → `Evaluator.PartialEval` and, during setup construction, `It.Is` → `Match.Create`. Whether an agent reads those two facts out of a frame list is untested [I].

### 1.4 What the traces show and do not show

- Shown [M]: 10 of 16 losers modified `Match<T>.Equals`, which never executes during `Add`. That is a real information gap, consistent with the candidate's mechanism.
- Not shown [M]: any cell that had the path fact and won because of it. The four sweet losers who edited the deciding method or site are the closest proxy for "had the fact". They lost. The observed conversion at the site is 2/7.
- Not shown [M]: any reproduction ever running. 0 `dotnet` invocations in 21 moq transcripts (`grep -o "dotnet (test|build|run|restore|tool|trace)"`); `run_tests` verdicts in every cell (`status=FAIL`, "Total tests: 1686"; rows `testResults=1681`), 0 `INFRA` mentions; `strippedTestPaths=[]` in every row; 0 new files in 18 patches.

## 2. markup-it: the cited reproduction never ran

Grep over the 18 transcripts under `agent-state/gitbookio__markup-it-56-{sweet,native}/` in the three TAB runs, subagent files excluded [M]:

| cell | `Cannot find module` hits (module) | `shift is not a function` | what ran |
|---|---|---:|---|
| codex sweet | `slate` 2, `./html` 2 | 0 | `require('./src')` failed on `slate` (rollout `01a040af…`, record 71); regex probes |
| codex native | `./html` 4, `immutable` 2 | 0 | regex probes; library load failed |
| opencode sweet | `./html` 8, `immutable` 2 | 0 | library load failed |
| opencode native | none | 0 | only `node -e 'const re=/^<!--…'` regex probes in all three sessions |
| claude sweet | `slate` 6, `./html` 4, `immutable` 2 | 0 | library load failed |
| claude native | `immutable` 6, `babel-core/register` 2 | 0 | library load failed |

The working copy has no `node_modules` (golden `GitbookIO__markup-it@e06072d6…`, `ls node_modules` → no such file) [M]. Inside the test container the suite runs: "233 passing" appears in every cell's `run_tests` output [M]. So the container can execute, the agent shell cannot, and no cell ran the issue's input through the library in either direction. The candidate books markup-it at 0 solves, so the ceiling does not change; the evidence sentence must.

The issue text itself (problem statement only) is one fenced markdown line plus an error shown as an image [M]. There is no code and no error text to trace against.

## 3. Ceiling against the fresh-pool cells

Brief §1 cells: codex sweet 39/66 vs native 41/66; opencode 41 vs 41; claude-code 40 vs 43. Bar: "A superiority claim requires ≥ +6 rollouts of 75" per harness (`FRESH-ROTATION-PREREGISTRATION.md` line 45; "Sweet-vs-native superiority needs the same margin", lines 119–120); applied per harness at n=66 in `FRESH-POOL-RESULTS.md` lines 45–47 [C].

| harness | sweet moq losers | sweet at 100% flip | native | delta | reaches +6? | redirectable cells (§1.1) | at 2/7 conversion [I] | at borrowed 2/4 [I] |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| codex | 2 | 41/66 | 41/66 | 0 | no | 1 (`c:s0`) | +0.3 | +1.0 |
| opencode | 3 | 44/66 | 41/66 | +3 | no | 1 (`o:s1`) | +0.3 | +1.5 |
| claude-code | 3 | 43/66 | 43/66 | 0 | no | 2 (`cc:s1`, `cc:s2`) | +0.6 | +1.5 |
| pooled | 8 | 128/198 | 125/198 | +3 | not the registered reading | 4 | +1.1 | +4.0 |

"The only face that could reach ±6" is false on the per-harness bar at any rate. The pooled +8 is the sum of three cells; even there the sweet-minus-native margin is +3.

The borrowed 2/4 rate is an upper bound, not a central estimate. `HINT-LADDER-RESULTS.md` lines 105–120 and 228–238: the codeception runtime fact was appended to the issue text before turn 1, on top of a blind static certificate that already named the file, the verb and the mechanism, on opencode sweet, 4 reps. c06 would deliver a bare frame list mid-task. The recorded mid-task delivery channel (register A6) was ignored three times for instructions and has never been tested for facts.

The information-adjusted figure (+1.1 pooled) is more than a factor of two below the candidate's realistic figure (+4) and more than seven times below its headline (+8).

## 4. Cost side

- One extra request at the final moq context (turns files, last rep, `cost_fence.mjs`): codex sweet ≈ $0.00096 (in 74,083, cached 73,695, +300 out); opencode sweet ≈ $0.00090; claude-code sweet ≈ $0.00075 [M]. Median request cost on those rollouts: $0.00072 / $0.00072 / $0.00065 [M]. Against the cell means ($0.012330 / $0.009265 / $0.020727) one added request is 4–10% of a mean rollout; against the moq rollouts themselves ($0.036–0.049 codex sweet) it is 2–3%.
- The tracer payload is unpriced. Any injected context carries the B12 precedent (replay said cheaper; live cost +4.8 / +19.8 / +11.7%).
- moq wall time: median 401.5 s per rollout against a pool median of 102.6 s (`rows.json.wallMs`, `fp-codex-tab-20260826`) [M]. A build-and-trace per rollout lands on the slowest family.
- Sweet must earn back 7–10% before it can be cheaper (brief §1.1). An unknown positive cost with an expected +1.1 solves pooled cannot meet the bar.

Solve veto: the fact is descriptive and rejects nothing, so no solve is traded for cost. The problem is that the gain is below noise on every harness and the cost sign is negative.

## 5. Feasibility on this bench (mechanism precondition)

- Agent shell: `dotnet` is not on the host PATH [M]; the markup-it working copy has no `node_modules` [M]; the frame tells both arms "Your shell does NOT have the repository's dependencies installed" (`harness/codex-task-runner.mjs` lines 109–110, byte-identical across adapters) [C].
- Test container: the suites run there (moq 1,686 tests, markup-it 233 passing) [M]. The agent reaches it only through `run_tests`: "the agent has no docker socket, so the only way to a test result is a parameter-free request through the IPC dir" (`harness/agent-runner-shared.mjs` lines 86–88); the shim parses argv as an optional test pattern plus `--ss-full` (`harness/rt-shim-runtime.mjs` lines 196–213); the jail masks the docker socket, the client and every layer store (`harness/agent-jail.mjs` lines 100–113) [C].
- Therefore "run the reproduction under a tracer in the test container" needs a new broker verb. That is bench code (brief rule 3). If it were sweet-only it would be a rig privilege, not a tool (brief rule 6). A production user's shell does have the dependencies, so the tool could exist as a product feature, but it cannot be measured on this bench as built.
- Trigger population: 0 reproduction files in 18 moq patches; the issue snippet references `this.settingsServiceMock`, `this.patternKey`, `this.exeKey` with no declarations and cannot compile alone [M]. The "c05 first-edit hook" is an unbuilt component of a separate candidate.

## 6. The $0 falsifier

The candidate's falsifier asks whether the moq and markup-it goldens "build and execute their reproduction offline in the bench container image". The record already answers both readings, in opposite directions. In the test container, both suites execute (1,686 and 233 tests) [M], so the kill condition cannot fire. In the agent shell, 0 of 39 recorded moq and markup-it rollouts ever executed the library or the toolchain [M], so the kill condition fires at the maximum. Neither reading tests the mechanism.

Re-specified $0 falsifier, in two parts. (a) Take the eight recorded moq sweet loser patches and the certificate text ("`Add` → `MethodExpectation.Equals` → `PartiallyEvaluateArguments` → `Evaluator.PartialEval` → `ExpressionComparer.Equals`; `Match<T>.Equals` not entered; matcher class `Match<T>`"). Count how many losers already acted on the information in it. My read: 4 of 8 (§1.2). Pre-register: kill if more than 3 of 8. It fires today. (b) Show that a call-path tracer can run in the task image without a network fetch and that its output names the `PartialMatcherAwareEval` frame. Not runnable in this workflow (no image on the box: `docker images` lists none for moq or markup-it [M]).

## 7. Corrections the synthesis must adopt

1. Replace "13/16 moq losers patched the non-deciding path" with: 13 of 16 losers touched `Match.cs` or `ExpressionComparer.cs`; `ExpressionComparer.Default.Equals` is on the deciding path (`MethodExpectation.cs:253`); 10 of 16 edited `Match<T>.Equals`, which is off the path; 4 of the 8 sweet losers (`c:s1`, `o:s0`, `o:s2`, `cc:s0`) edited the deciding method or the override-marking site and lost; conversion at that site is 2/7 across arms.
2. State the deciding facts as the base tree gives them: the capture fold happens in `PartialMatcherAwareEval` (`ExpressionExtensions.cs:439–458` via `Evaluator.PartialEval`) before any comparer runs, and `It.Is` yields `Match<T>`, not `LazyEvalMatcher` (`It.cs:139–151`, `MatcherFactory.cs:156–160`). A path listing shows frames, not these two facts.
3. Ceiling per harness against the ≥ +6 bar: codex +2 → 41 vs 41 (0); opencode +3 → 44 vs 41; claude-code +3 → 43 vs 43 (0). Delete "the only face that could reach ±6". Information-adjusted: 4 redirectable sweet cells × 2/7 ≈ +1.1 pooled (+0.3 / +0.3 / +0.6). The borrowed 2/4 rate (+1.0 / +1.5 / +1.5) is an upper bound: issue-text delivery, before turn 1, on top of a full static certificate, opencode only, 4 reps.
4. Replace "18/18 markup-it cells reproduced parse-only" with: 0 of 18 cells loaded the library in the agent shell (`slate`, `immutable`, `babel-core/register` missing; no `node_modules`); the runs were regex probes against the inline-HTML pattern plus failed `require` calls; 0 of 18 transcripts contain the round-trip crash message. markup-it stays at 0 solves.
5. Replace "Container blocks dependency installs, so .NET restore is likely INFRA — untested" with: the moq suite builds and runs 1,686 tests in the test container in 21 of 21 rollouts with 0 `INFRA`; the agent shell has no `dotnet`; the container is reachable only through the parameter-free `run_tests` broker.
6. Trigger: 0 reproduction files in 18 moq patches; the issue snippet is a class fragment; the c05 hook is unbuilt. The candidate is not independently triggerable on its ceiling task.
7. Cost line: one extra request at the final moq context ≈ $0.00096 / $0.00090 / $0.00075 (codex / opencode / claude-code sweet); tracer payload unpriced; moq median wall time 401.5 s vs pool 102.6 s.
8. Falsifier: replace the "can the container execute" question (already answered both ways) with the two-part form in §6; part (a) fires today.
9. Register check: keep F5 PARKED (the F5 gate §4 already booked "0 extra solves until a live pilot shows otherwise" and scoped to "one process, one language"); add A6 (mid-task delivery untested for facts), B12 (context inversion), F2 (reproduction-harness synthesis), E14 (where-facts have about zero headroom). E10 and F6 are correctly distinguished.

## 8. What I could not finish

- No tracer was run, and no task image was pulled. The "fold before comparer" reading is static (base tree), not a runtime trace ($0 rule).
- The 2/7 conversion rate is a small-sample observation on one task; I did not read the reasoning text of the seven cells to learn why they chose their edits.
- I did not separate the seven "comparer mode wired into `Match.Equals`" cells from the three `RenderExpression` cells by reading every `Match.cs` hunk; the classification rests on hunk line ranges (202–230 vs 168/242).
- The per-request cost figures come from the turns files, which hold the last rep only; I did not rebuild per-rep usage from the raw traces.
- I did not check the web for .NET 6 offline tracing options; the feasibility finding rests on the host PATH, the jail code and the broker code.
- Grading logs were not opened in this pass; the "single extra failure" loser signature is taken from `wrongfix-facts.md` §2.6.

## 9. Evidence opened

Local: `slate-c/BRIEF.md`; `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`; `slate-c/candidates/resolution-computed-facts.md` (full); `slate-c/candidates/DEDUP.md` (c06 lines); `slate-c/forensics/wrongfix-facts.md` (full); `slate-c/forensics/scripts-wrongfix-facts/{README.md, data/census-output.txt}`; prior `slate-c/verify/c06-{mechanism,history,measurability}.md` and `c06_moq_recount.mjs` (read, then re-derived independently); `handoffs/improve/W0-P6-GATE-RESULTS.md` (full); `HINT-LADDER-RESULTS.md` lines 50–70, 105–125, 226–240; `FRESH-ROTATION-PREREGISTRATION.md` lines 38–48, 115–122; `FRESH-POOL-RESULTS.md` lines 40–50; `harness/agent-runner-shared.mjs` 70–125; `harness/codex-task-runner.mjs` 105–140; `harness/rt-shim-runtime.mjs` 190–262; `harness/agent-jail.mjs` 92–122.

Box (read-only), `results/`: `rows.json` of `fp-codex-tab-20260826`, `fp-opencode-tab-20260826`, `fp-claudecode-tab-20260826`, `rp-oc-tab-20260827` (moq and markup-it rows; `wallMs`); `fp-codex-tab-20260826/sweet/tasks.json` (`instance_id`, `base_commit`, `language`, `image_name`, `install_config`, `problem_statement` only); patches for all 18 moq cells (`<run>/<arm>/patches.json`, `<run>/<arm>/rep-{1,2}/patches.json`); `turns/devlooped__moq-1262-{sweet,native}.jsonl` in the four runs.

Transcripts: codex moq sweet `rollout-2026-08-27T00-{21-58-01a04098,27-41-01a0409d,34-45-01a040a4}-*.jsonl`, native `rollout-2026-08-27T00-{41-28-01a040aa,48-38-01a040b0,51-36-01a040b3}-*.jsonl`; opencode moq native `session-1787762{148033,279204,643157}-*`, sweet (rp) `session-1787859{310161,509865,832153}-*`; claude moq sweet `{a0ea3568,ab216beb,e4b03e5c}-*.jsonl`, native `{d88312ba,796011d6,ed35f3bd}-*.jsonl`; codex markup-it sweet `rollout-2026-08-27T00-{47-04-01a040af,49-04-01a040b1,50-56-01a040b2}-*.jsonl`, native `rollout-2026-08-27T00-{53-31-01a040b5,56-10-01a040b7,58-19-01a040b9}-*.jsonl`; opencode markup-it sweet `session-1787762{379728,554489,733434}-*`, native `session-1787762{887244,989863}-*`, `session-1787763082138-*`; claude markup-it sweet `{be079d3a,6bf93cb8,76689b5f}-*.jsonl`, native `{26944860,0eee0e85,63d1bc75}-*.jsonl`.

Golden `/root/.ss-eval/golden/devlooped__moq@6c7e7a103381b25324be1675a97a533082bce226/src/Moq/{SetupCollection.cs, MethodExpectation.cs, ExpressionExtensions.cs, Evaluator.cs, ExpressionComparer.cs, Match.cs, It.cs, MatcherFactory.cs, Matchers/}`; golden `GitbookIO__markup-it@e06072d6a2a585c99c635cabbea979b4011eab5f` (`node_modules` absent). Host: `which dotnet`, `docker images`.

## 10. Artifacts

- This report: `eval/task-completion-bench/handoffs/improve/slate-c/verify/c06-mechanism.md`.
- Scripts: `eval/task-completion-bench/handoffs/improve/slate-c/verify/scripts-c06-mechanism/{moq_cells.mjs, moq_hunks.mjs, cost_fence.mjs}` (run on the box from `/tmp/wf-slatec/c06-mechanism-r2/`).
- Rules honoured: $0; nothing written under `results/`; no product or bench code edited; HO2 untouched; no grading log opened in this pass; no hidden test name or gold content reproduced.
