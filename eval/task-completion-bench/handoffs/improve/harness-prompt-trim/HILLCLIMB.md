# Harness-prompt hill-climb (overnight loop, started 2026-09-27 03:40)

Goal (owner): cheaper at equal or better solves, by editing ONLY each harness's own system prompt /
tool descriptions / config, sweet arm only. Must generalise across task types — do not overfit to
the smoke tasks. Never change the product (`scripts/`), the sweet-search rules file, the frame, the
ss-* engine or native. No held-out-2 task, ever. Do not push the box; nothing here ships.

## Method

- Micro-smoke = one run-pilot per variant, distinct tasks x 1 rollout, all tasks at once
  (`scripts/hc-smoke.sh`, concurrency = task count), fresh baseline first in every cell.
- Validity fixes ON in every cell since round 2 (`BENCH_INCLUDE_UNTRACKED=1`,
  `RT_ATTACH_REQUIRE_SAME_DIFF=1`, ledger `results/bsmoke-ledger-fix/ledger.jsonl`). Never pool
  with round-1 (fix off) numbers.
- Variant texts: `harness/trim/batch-variants.mjs` (switches `CODEX_TRIM_BATCH`,
  `OC_HARNESS_TRIM=batch-*`, `CC_TRIM_BATCH`). Unset = byte-identical to the shipped form.
- $0 check before a new variant's first paid cell (instruction-file diff or request capture).
- Read: solves first (no variant may lose a solve the baseline has, in aggregate), then cost vs the
  SAME-cell baseline, then turns. One rollout per task is noisy (+-25% Codex baseline cost between
  identical runs), so:
  - **lead** = beats its same-cell baseline once;
  - **candidate** = beats it in 2 of 2 cells on rotation A;
  - **champion** = candidate that ALSO beats the baseline on a fresh rotation B (tasks it was not
    developed on). Only champions are promoted; the next climb starts from the champion.
- Rotations (confirm10 set, all DEV-RET, all gold-valid under the fixed code):
  - A = zlint-299 (go), super_editor-2516 (dart), eslint-plugin-ember-551 (js), bingo-271 (ts)
  - B = svgr-10 (js), maxgraph-365 (ts), brighterscript-1050 (ts), node-datadog-metrics-73 (js),
        fastify-cors-285 (js), jupytext-360 (python)
  - C (later) = new DEV-RET tasks need images + ledger; only if A/B are exhausted.
- Queue: `results/hc-queue.txt` run by `scripts/hc-queue.sh` (status `results/hc-queue.txt.status`).
- Next ideas come from (1) trace analysis by an Opus subagent over the latest cells, (2) web
  research. Keep lines general (no task, repo or benchmark wording).

## Current state (update every loop tick)

| harness | shipped/base | champion | candidates | leads | dead |
|---|---|---|---|---|---|
| Codex (v3, Luna code mode) | v3 | **pallyt** (A −2%, −16%, −14%; rotB −28%, −30%) — replaces pall (6 cells avg ≈ −7%) | pall (r2 −11% 3/4 v 2/4; r3 −13% 3/4 v 2/4; r4 −3% 3/4=3/4) | **pallyt candidate** (r5 −3%, r6 −16%; cheaper than pall both times), yield (r2 −7%) | unchain, dep, two, plan, yieldedit, yieldeditpall, pallyield (r4 +10%), pallfind (r5 +15%), pallyt1 (r7 +19%), pallyt1open (r7 +11%) |
| opencode (untrimmed, Luna) | untrimmed | **todoall** (rotB −18%, turns −38%, 0/6=0/6: cost-only on B) | todoall (r2 −10%, r3 −24%, r4 +1%; turns −25..−37% every time; 3/4=3/4); combo (r2 −12%, r3 −15%) | todoall2 (r5 −23%, 43 v 81 turns), comboall (r3 −16%) | unchain, dep, two, plan, todo, tododesc, todoallfit (r4 = todoall: Luna already uses ss-* almost only), todoall2find (r5, ss-find lines add cost), todoall2 (no consistent gain over todoall), todoall2diff (r7 flat) |
| Claude Code (product, Opus 5.5) | product (max-batch) | **shipped max-batch** (no variant generalises: all A wins lost on B) | **amp** (r2 −15%, r3 −12%, 3/4=3/4; r1 −2% fix off; rotB +8% but 2/6 v 1/6 — not promoted) | **saferangefinal** (r7 −23%), saferange (r7 −12%), ampsaferange (r5 −15%, r7 −3%, rotB +9%), ampsafe (r5 −6%), ssread (r2 −14%, r3 −4%) | two, plan, ampssread |

## Results log (cost vs same-cell baseline; solves variant/baseline)

- R1 (fix OFF, 22:04-00:22): no batching line helped anywhere. Generic "batch" wording made agents
  read more (opencode two +41%, plan +60%).
- R2 (fix ON): Codex pall −11% (3/4 v 2/4), yield −7%, yieldedit −9% (2/4), all3 +5%.
  opencode todo +4% (turns −15%), tododesc −4%, todoall −10%, combo −12% (turns −35%).
  Claude Code amp −15%, ssread −14%, ampssread +9% (baseline had a degenerate re-run).
- R3: Codex pall −13% (3/4 v 2/4). opencode todoall −24%, combo −15%, comboall −16%.
  Claude Code amp −12%, ssread −4% (bingo flagged degenerate in every Claude Code baseline: noise, both sides).
- Rotation B ledger: all 10 confirm10 tasks gold-valid under the fixed code (04:00).
- R4: Codex pall −3% (3/4 = 3/4; stronger baseline). Codex totals R2-R4: pall 9/12 v base 7/12, never dearer.
- R4 opencode: todoall +1% (turns 49 v 68), todoallfit +2%. Codex pallyield +10% (pragma without write_stdin does not help).
- rotB-codex-1: pall −11% ($0.086 v $0.097), 0/6 = 0/6 (Luna solves none of rotation B under Codex; cost evidence only), turns 91 v 103. -> Codex CHAMPION = pall.
- rotB-opencode-1: todoall −18% ($0.066 v $0.080), turns 58 v 93, fewer turns on all 6 tasks, 0/6 = 0/6. -> opencode CHAMPION = todoall.
- rotB-claudecode-1: amp 2/6 v 1/6 (gained svgr), cost +8% ($0.885 v $0.816; brighterscript +$0.09), turns 44 = 44. Cost saving did NOT transfer -> amp NOT promoted; Claude Code champion stays the shipped product prompt. amp remains a candidate (R5 tests amp+safe lines).
- R5 Codex (rotation A): base $0.078 (72 turns); pall $0.084 (+8%); pallyt $0.076 (−3%, 66 turns, waits 6 v 13, template used in 9 test cells); pallfind $0.090 (+15%); pallytfind $0.076 (65 turns). All 3/4. The wait-safe test-cell template is the only line that helps; ss-find/alternation lines add nothing. pall over 5 cells: −11, −13, −3, +8 (A), −11 (B) — small, likely real, noisy.
- Queue: r6-codex (base pall pallyt), rotB-codex-2 (base pallyt).
- R5 opencode (rotation A): base $0.087 (81 turns); todoall $0.086 (72); **todoall2 $0.067 (−23%, 43 turns)**; todoall2find $0.076 (49). All 3/4. The ss-find/alternation lines cost money in BOTH Luna harnesses -> dead. todoall over 5 cells: −10, −24, +1, −1 (A), −18 (B).
- Queue: r6-opencode (base todoall todoall2), rotB-opencode-2 (base todoall2).
- R5 Claude Code (rotation A): base $0.792 (36 turns); amp $0.731 (−8%); ampsafe $0.743 (−6%); **ampsaferange $0.672 (−15%, 29 turns; super_editor −40%)**. All 3/4. amp on A with fix on: −15, −12, −8 (3/3), rotB +8% (2/6 v 1/6).
- Queue: rotB-claudecode-2 (base ampsaferange), r6-claudecode (base amp ampsaferange).
- R6 Codex (A): base $0.099 (109 turns); pall $0.088 (−11%, 89); **pallyt $0.083 (−16%, 75)**. All 3/4. pallyt is a CANDIDATE (cheaper than base and pall in 2/2 cells); rotB-codex-2 decides champion.
- rotB-codex-2: pallyt $0.078 v $0.109 (−28%), turns 77 v 101, cheaper on 4/6 tasks (longest test suite $0.046 -> $0.018), 0/6 = 0/6. -> Codex CHAMPION = pallyt.
- Trace analysis 3 (08:20): pallyt's template returns the verdict in 1 turn in 15/15 cells that use it, but 0/14 FIRST test cells use it (the agent copies yield_time_ms onto exec_command). todoall2: solo todo turns 17 -> 1; post-test review turns remain (10-13% of cost). amp lost rotB because 'work out every read' makes read batches bigger; ampsaferange's A gain is mostly one large whole-file read (super_editor), so it may not generalise. No removals proposed for Codex/opencode (past trims lost solves).
- R6 opencode (A): base $0.074 (70 turns); todoall $0.062 (−16%, 45); todoall2 $0.072 (−3%, 45). All 3/4. todoall2 v todoall: −22% (r5), +16% (r6) -> no consistent gain; todoall stays champion (7 cells, avg ≈ −11%, never lost a solve).
- rotB-opencode-2: todoall2 $0.071 v $0.082 (−13%), turns 57 v 93, 0/6 = 0/6. todoall (−18% on B) stays champion: simpler, better record.
- rotB-claudecode-2: ampsaferange $0.855 v $0.787 (+9%), 2/6 = 2/6 (jupytext +$0.09). Same pattern as amp on B -> not promoted. Claude Code champion stays the shipped prompt; saferange (no 'work out every read') tests the fix in R7 + rotB-3.
- R7 Codex (A): base $0.072 (74 turns); pallyt $0.062 (−14%, 55); pallyt1 $0.086 (+19%): first test cell still 0/4 with the pragma -> the 'every run, first included' line does not reach the first cell; pallyt1 dead; pallyt1open $0.080 (+11%) dead. Every line added on top of pallyt raised cost (pallfind, pallytfind, pallyt1, pallyt1open): Codex climb CONVERGED at pallyt. pallyt on A: −3, −16, −14; B −28; never dearer, never lost a solve.
- R7 opencode (A): base $0.068 (61 turns); todoall2 $0.078 (+15%, 56); todoall2diff $0.069 (+1%, 46). Lines on top of todoall cut turns but not cost (todoall2: −22, +16, +15 v todoall/base; todoall2diff flat): opencode climb CONVERGED at todoall.
- R7 Claude Code (A): base $0.767 (34 turns); ampsaferange $0.746 (−3%); saferange $0.675 (−12%); **saferangefinal $0.587 (−23%, 27 turns; cheaper than base on all 4 tasks)**. All 3/4. The removal of 'work out every read' helped as predicted; the short-final line adds a further −13%.
- rotB-claudecode-3: base $0.806 (1/6, 42 turns); saferange $0.841 (+4%, 2/6); saferangefinal $0.875 (+9%, 1/6, 51 turns). Every Claude Code line that won on rotation A lost on rotation B (amp +9, ampsaferange +9, saferange +4, saferangefinal +9): the Claude Code gains were OVERFIT to the 4 rotation-A tasks. Claude Code champion stays the SHIPPED max-batch prompt. Climbing Claude Code further on rotation A is not useful; any new Claude Code line must be screened on B first.
- rotB-codex-3: pallyt $0.075 v $0.107 (−30% realized, −31% ideal), turns 80 v 115, 0/6 = 0/6. pallyt beat base in 5/5 cells (A −2, −16, −14; B −28, −30), never lost a solve.

## FINAL (2026-09-27 10:55) — loop stopped, queue empty
| harness | champion | evidence |
|---|---|---|
| Codex (Luna) | **pallyt** (v3 + Promise.allSettled line + wait-safe test-cell template; +715 chars) | 5/5 cells cheaper: A −2/−16/−14%, B −28/−30%; solves never lower |
| opencode (Luna) | **todoall** (todo-in-same-turn line + 2 phrases removed from the todowrite description; +75 chars) | A −10/−23/+1/−1/−16%, B −17%; solves never lower |
| Claude Code (Opus 5.5) | **shipped max-batch, unchanged** | every A-winning line (amp, ampsaferange, saferange, saferangefinal) cost +4..+9% on B |
Rules file, frame, ss-* engine, native and product untouched throughout. 
## Mechanism audit (3 Opus agents, 2026-09-27 ~12:00; notes in scratchpad mech-codex/, mech-opencode/, mech-cc/)
| harness | winner | (a) retrieval shift | (b) prompt-size saving | (c) batching / fewer turns | honest size | verdict |
|---|---|---|---|---|---|---|
| Codex | pallyt | none (ss-* ≥94% in every arm, untrimmed included) | untrimmed→v3: −3.7k first-request tokens = ALL of v3's −8.6%; pallyt adds +181 tok (+0.5%) | wait-safe template real: waits 3.7→1.6, relaunches 0.83→0.21, verdict in-turn 24/24 when used; Promise.all line ~no effect (pall −5%, p=0.27) | −7% (template) to −13% (per-task median); pooled permutation −14.6% p=0.008. rotB −28/−30% driven by 2 baseline fix-fail loops (−4/−9% without) — DO NOT publish | PARTLY |
| opencode | todoall | none (native 1.9% of calls; Grep/Task 0) | +18 tok, neutral | real: turns −29% (24/26 pairs, p<0.001); 40% solo-todo, 60% single retrieval turns turned parallel; saving = cache re-reads from fewer turns (r=0.83) | ≈ −8% (range −23..+1%); super_editor gives half | PARTLY |
| Claude Code | shipped max-batch | ss-* share 18→59% before first edit but cost effect ≈ 0 | prefix cut explains >100% of the saving, cheaper on 10/10 tasks | batching line: −16% turns v max via fewer test/edit loops, not chaining | −18.9% (kept, turn-1 normalised) / −15.3% (with discarded re-runs); ~3 pts of −22% was a cache artefact | MECHANISM-DRIVEN |
Tonight's Claude Code variants: A wins = noise + task mix (range line only helps whole-file-read tasks; bingo degenerate-inflated baselines); no variant merits another micro-screen. Solve risk: none measured anywhere; one flag — 2/36 Codex template rollouts edited after the last test run and claimed PASS (both resolved).
Open: Codex template-only variant (drop the Promise.all line) never run — simpler and better founded; opencode v3 trim + todoall plausibly ≈ −5% more (prefix arithmetic), eslint solve risk unmeasured.

Next step (owner): decide whether pallyt / todoall go into the product/bench defaults and whether to confirm them on a larger set.
- Queue: rotB-codex-3 (base pallyt) — second rotation-B cell for the Codex champion.
- Round 7 queued: Codex pallyt1 (template for EVERY test run), pallyt1open (+ first tests and searches in one cell); opencode todoall2diff (git diff in parallel with the final test run); Claude Code saferange (ampsaferange minus 'work out every read' — a removal), saferangefinal (+ short final message); rotB for the two Claude Code variants. r6-claudecode folded into r7.
- Trace analysis 2 (04:40): opencode todoall acts as intended (solo todo turns 31 -> 12, todo calls unchanged);
  Codex pall mostly NOT via Promise.all (baseline already used it) — saving is fewer lost-verdict relaunches;
  Claude Code amp shows no behaviour change (saving mostly on the unsolved bingo). Remaining sinks: Codex
  test cell without write_stdin loses the verdict; opencode opener/closing solo todo turns; Claude Code
  whole-file reads (35-40% of a task's cost), `cd subdir; ss-read relative` ENOENT (12 in 28 rollouts),
  `run_tests | grep` lost the verdict 4/16 (`| tail` 0/51). Round 5 lines built from these.
- Queue: rotB-codex-1 (base pall), rotB-opencode-1 (base todoall), rotB-claudecode-1 (base amp), then R5 on
  rotation A: Codex pall/pallyt/pallfind/pallytfind, opencode todoall/todoall2/todoall2find, Claude Code
  amp/ampsafe/ampsaferange.

## Queue plan

1. (running) Claude Code R3 base/amp/ssread -> Codex R4 base/pall/pallyield -> opencode R4
   base/todoall/todoallfit (todoallfit = todoall + opencode's "prefer Glob and Grep" bullet replaced
   by an ss-* line: sweet-search fit).
2. Rotation B promotion cells for each harness's candidate (6 tasks, concurrency 6).
3. New trace analysis on R2-R4 to find the next lines per harness; climb from the champions.

## Phase 2 (owner decisions 2026-09-27 ~13:00)
Audits (scratchpad solve-wins/, trim-audit/, research-2/):
- Solve gains: ALL luck. Codex eslint = a judgement call on "no test edits" v a local test-file-per-rule check (both failing baselines broke working code to make the local suite pass — a FRAME mechanism, not a variant one; frame untouched); CC svgr = keep-CSS v remove-<style> design coin flip (saferangefinal, which contains saferange's text, failed it in the same cell). No solve loss with fixes on.
- Trims are NOT conflict-only. The SHIPPED Claude Code product denies web search/fetch, Skill, NotebookEdit, worktrees, TaskStop/SendMessage/ListAgents, cron/schedule, Workflow, ReportFindings, the Plan agent, auto memory and git instructions, and drops safety/confirm/formatting/hooks guidance. Codex/opencode trims (bench-only) also cut user items (ask-user, skills, frontend, formatting, review).
- Winner lines carry bench flavour: Codex template can hang on non-terminating commands; CC batching example pushes script edits (skips Edit's diff/approval); opencode todo line lets visible progress go stale. General rewordings drafted.
- Research: strongest measured levers = REMOVING "double-check/think deeply/be thorough" text, a bounded-efficiency line (−19% CC in a preregistered study), scope discipline; Karpathy-style CLAUDE.md −3..−10% cost, quality flat.
Owner decisions: (1) rebuild the shipped Claude Code harness CONFLICT-ONLY, restoring every user capability (first request ≈15.5k tok v 7.7k lean, 18.9k stock) and re-measure its saving; (2) rebuild all three harnesses as conflict-only trims, screen each v untrimmed (opencode first, eslint repeated), then stack general reworded winners + research levers, then test sweet rules OUTSIDE v INSIDE the system prompt. Rotation A + B each step.

## Owner rules for phase 2 (standing; check before every queued variant)
1. Cheaper at EQUAL OR BETTER solves; keep climbing until a decisive win.
2. No bench overfit: general wording only; must help or be neutral in repos without tests, interactive use, non-coding tasks.
3. Never remove user functionality; trim ONLY sweet-search-conflicting text + pure bloat.
4. Solve gains count when a visible, sensible mechanism causes them (check traces); flips without a mechanism are noise.
5. Verify every win by mechanism (Opus trace audit): (a) tool use, (b) prompt size, (c) fewer turns.
6. Realized cost first (ideal as a check); solves first.
7. Micro-smokes, fresh same-cell baseline, max useful concurrency; rotate tasks; promote only winners that also win on fresh tasks.
8. Research (web + traces) before inventing variants.
9. Final per harness: sweet rules OUTSIDE v INSIDE the system prompt (inside = seamless-UX goal).
Phase-2 baselines: Codex/opencode = UNTRIMMED stock harness; Claude Code = stock (and the conflict-only product rebuild).
Concurrency: cells run all tasks at once (4-6); 10-task A+B cells are tried at concurrency 10 once the queue2 cells finish — drop back to 6 if run_tests INFRA/timeouts appear.

## Phase 2 log
- 12:53 queue2 started (opencode trims, eslint repeats, Codex conflict).
- Claude Code product rebuilt conflict-only (merge 7485e10) + memory/git-context guidance restored as paraphrase with computed memory dir (merge e45e567, "product v2.1"). First request: stock 12,619 tok; old lean 4,730; v2 11,653; **v2.1 12,409 (−1.7% v stock)**. Removed v stock: only "prefer dedicated file/search tools", Explore + claude subagent types, bypass-mode cat/grep steer, token reminder, gitStatus snapshot (model told to run git status itself). Rules reach main, general-purpose AND Plan subagents (stock Plan gets none). Expected cost effect ≈ 0 (prefix nearly equal; retrieval shift cost-neutral in audit). Bench product mode now keeps web like native (old product denied it on sweet only — do not pool pre/post). Cells p2-cc-A/B (stock v product v2.1) queued.
- opencode phase-2 baseline (untrimmed, A): 3/4, $0.084, 80 turns.
- p2-oc-trim-A (A, 4 tasks): untrimmed $0.084 (80 turns); conflict $0.086 (+2% real, +1% ideal, 70 turns); **conflict-noglob $0.075 (−11% real, −12% ideal, 67 turns)**; all 3/4, eslint solved by all. Removing glob keeps the capability (bash find/ls lists files by name).
- p2-oc-trim-eslint-1: untrimmed $0.021 (20 turns), conflict $0.022 (18), conflict-noglob $0.015 (15); all SOLVED (old trims lost eslint).
- Queued p2-oc-stack-A (conflict-noglob + todoall / todo2 / todo2eff) ahead of the Codex cells.
- p2-oc-trim-B (B, 6 tasks): untrimmed $0.081 (95 turns); conflict $0.077 (−5% real, −7% ideal, 76); conflict-noglob $0.077 (−5%, −5%, 80); all 0/6.
- p2-oc-trim-eslint-2: untrimmed $0.020, conflict $0.024, conflict-noglob $0.025; all SOLVED. eslint across A + 2 repeats: both trims 3/3 solved — the old trims' eslint loss does not recur.
- opencode trim verdict so far: conflict-noglob −11% (A), −5% (B) → trim CANDIDATE (−598 tok first request; measured prefix effect ≈ −1% — audit mech-oc2 corrects the earlier −4..−5% estimate); conflict +2% (A), −5% (B). Next: stack todo lines on conflict-noglob (p2-oc-stack-A running).
- SWEET_RULES_PLACEMENT switch merged (a4dc681; hc-smoke suffix '@system'). $0 captures: rules move once, byte-identical, into the system/developer prompt incl. subagents; instruction file = frame only (= native's). Caveats: (1) Claude Code's locked 298-char override names `.claude/rules/sweet-search.md`, which does not exist under 'system' — OWNER DECISION needed before a Claude Code placement cell (override text is owner-locked); (2) opencode already carries AGENTS.md inside its single system message, so there 'inside' = position/frame-bracket change only; Codex is the true user-message -> system move; (3) stock CC Plan/Explore subagents would gain the rules under 'system'. Queued p2-place-cx/oc A+B (untrimmed outside v inside).
- p2-oc-stack-A base $0.077 (81 turns); conflict-noglob $0.078 (+1%, 67 turns). conflict-noglob over 3 cells: −11, +1 (A), −5 (B) ≈ −5% — matches prefix arithmetic.
- p2-oc-stack-A: **conflict-noglob+todoall $0.067 (−13% real, −14% ideal, 47 v 81 turns)**, 3/4 = 3/4. Queued p2-oc-stack-B (rotation B) ahead of the Codex cells.
- p2-oc-stack-A complete: conflict-noglob+todo2 $0.078 (+1%, 56 turns, 120 calls — marking steps in_progress adds calls); **conflict-noglob+todo2eff $0.063 (−18% real, −20% ideal, 46 turns, 95 calls)** — the general efficiency line removes todo2's extra calls, so it saves money AND keeps visible todo progress real-time (todoall saves −13% but updates the list less often: owner UX trade-off). p2-oc-stack-B (rotation B, 3 stacks) running.
- p2-oc-stack-B (B, 6 tasks, all 0/6): untrimmed $0.088 (96 turns); +todoall $0.071 (−19%); +todo2 $0.095 (+8%); **+todo2eff $0.069 (−22% real, −22% ideal, 61 turns), cheaper on 6/6 tasks**.
- **opencode LEADER = conflict-noglob+todo2eff**: A −18%, B −22%, solves equal; trim = conflict-only (find/ls still list files), todo list stays real-time, efficiency line general. Opus mechanism audit (mech-oc2/) running before promotion (rule 5).
- Audit mech-oc2 (opencode leader): MOSTLY MECHANISM-DRIVEN. Pooled −19.8% (95% bootstrap −28..−12%, sign-flip p=0.001); −16pp from fewer turns (todo-only turns 37→12, single-retrieval turns 62→11), prompt cut only −0.7pp. No verification loss (test runs 26 v 25, identical final verdicts, patch sizes equal, 0 edits after last test). Todo list stays current. Honest expected saving −10..−18% (central −14%). Fixes before promotion: todo wording leaves the last step in_progress (todo3 adds "mark the last step completed together with your final check"); efficiency line wording risks for interactive/questions/no-test repos (EFFICIENCY_LINE_2: complete the change incl. edits elsewhere, re-check after each fix, answer questions from evidence). Queued p2-oc-v3-A/B: todo2eff v todo3eff v todo3eff2.
- p2-cx-A (Codex, A): untrimmed $0.098 (2/4, 88 turns); conflict $0.100 (+2%, 3/4, 100); **conflict/yt2 $0.078 (−20% real, −21% ideal, 2/4, 63 turns)**; conflict/yt2eff $0.090 (−8%, 3/4, 77). Conflict trim alone ≈ 0 (≈90 tok cut); the saving is the general wait-safe template (yt2). eslint flips (conflict, yt2eff) are single-rollout judgement flips — not counted. p2-cx-B running.
- p2-cx-B (Codex, B, all 0/6): untrimmed $0.105 (105 turns); conflict $0.084 (−20%); conflict/yt2 $0.092 (−12%; jupytext 25 v 18 turns, not a hang); conflict/yt2eff $0.089 (−15%).
- **Codex CANDIDATE = conflict/yt2**: A −20%, B −12% (mean −16%), solves equal; mechanism = the general wait-safe template (proven in phase 1). conflict alone +2/−20 = noise (≈90 tok cut, no mechanism). yt2eff −8/−15 — efficiency line adds nothing on Codex. Next: Opus mechanism audit on conflict/yt2 before promotion; check the maxgraph/no-exit-command wording holds.
- Audit mech-cx2 (Codex conflict/yt2): PARTLY. Pooled −15.8% (95% −31..+9%); template-class turns −7.3pp (A −10.3, B −4.4 — same as phase-1 pallyt −6.9); rest = noise (conflict, with no mechanism, also shows −6.2pp there). The mechanism is write_stdin adoption (test cells with write_stdin 67% -> 100%, verdict-less waits 9 -> 0, relaunches 0.8 -> 0/rollout); the 600 s pragma was used in only 5/28 cells, first test cell 0/10. No hang (longest pragma cell 39 s; no dev server/watch command ever appeared, so the exclusion is untested), no solve/verification loss, 0 edit-after-last-test. Honest saving ≈ −7% (−4..−10). conflict trim ≈ 0 (keep on principle, no credit); yt2eff +5% v yt2 -> dead on Codex. New variant 'poll' = the poll instruction only (no pragma, exclusion widened to commands that wait for input): same mechanism, no 10-minute cell risk. Queued p2-cx-poll-A/B: untrimmed v conflict/yt2 v conflict/poll.
