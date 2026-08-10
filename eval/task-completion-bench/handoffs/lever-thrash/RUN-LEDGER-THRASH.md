# Run ledger — overnight loop: FAILED-TASK THRASH reduction (T1 / T3 / T2)

Operator: Claude (autonomous, user asleep). Backbone: **gpt-5.6-luna via codex ChatGPT-Max
subscription on the box** (flat-rate → no metered dollars). Successor to
`OVERNIGHT-LOOP-2026-08-07.md`; same house style. HO2 never touched — DEV-RET rotate18 only.

---

## PRE-REGISTERED BAR (written BEFORE any measurement — 2026-08-11, start of loop)

A lever proceeds from Gate 0 ($0 replay) to a live smoke **only if both hold**:

- **(a) Recoverable tail ≥ 15%** of in-scope FAILED-task spend on its positive site
  (break-priced / ideal column — for append-only codex trajectories these coincide, no cache breaks).
- **(b) False-positive rate on solved trajectories = 0.** A false positive is defined as:
  *the trigger fires at a turn strictly earlier than the turn that wrote the solving patch.*
  Conservative operationalisation: the solving patch = the LAST turn with a working-tree diff
  change in a SOLVED trajectory. Firing before it means the solve is lost.

Escalation rule, fixed in advance: **if FP > 0, RAISE the threshold (N / X / K) until FP = 0, then
re-measure the tail.** If the tail then falls below 15%, the lever is **DEAD for $0** — file it and
move on. **At least 2-3 thresholds must be tried before filing any lever as dead**
(Gate 4 discipline: neutral-on-rotation ≠ refuted).

Design rule inherited from the handoff and **not** up for renegotiation: **never trigger on an
absolute call/turn count** (difficulty-confounded). Progress signal only.

### Positive sites and controls (fixed in advance)
- T1 positive site: **mransan** (literal retrieval-thrash). T3 positive sites: **dart**, **litestar**.
- Controls that must show FP = 0: **statamic, oceanparcels, redboltz, scoringutils**
  (all clean 4/4 solves in run1).

### Instrument
`stats/thrash-census.mjs` — new, written for this gate. Reuses the poll-census raw-rollout parser
convention (one JSON event per line; `token_count.last_token_usage` per request; Luna rates
in $0.10/$0.01/$0.60 per M). Progress signals per turn: new file surfaced ∧ diff changed ∧
test-status changed. Source data: `results/luna-rotate18-run1`, 72 raw rollouts, mirrored locally.

---

## Baseline facts measured from run1 (72 rollouts, ideal cost)

| quantity | value |
|---|---|
| total ideal spend | $0.6542 |
| spend on fully-failed tasks (0/4 across both arms, both reps) | $0.3453 = **52.8%** |
| costliest failed tasks | dart $0.0795, mransan $0.0504, litestar $0.0496 |

This reproduces the GPT forensics framing (failed tasks dominate spend) on this run's own numbers.

---

## Run log (append per step)

### [INSTRUMENT] `stats/thrash-census.mjs` built + validated — $0
Parses the 72 raw codex rollouts (`agent-state/<cell>/codex-home/sessions/**.jsonl`), joins to
`rows.json` via `rolloutFile`, and reconstructs a per-turn progress timeline. Event order is
`reasoning → custom_tool_call → custom_tool_call_output → token_count`; each `token_count` is the
request that produced that turn's call (same attribution as `poll-census.mjs`).

Validation before any verdict was read:
- **Patch detection is complete on the population that matters.** All 34 solved rollouts report
  `patchFiles>0` in harness ground truth, and the detector found a patch turn in **34/34**
  (zero `lastPatch=-1`). Under-detection here would have *understated* the false-positive rate, so
  this is the load-bearing check.
- **Poll misclassification fixed.** A batched snippet that both execs and calls `write_stdin` was
  initially tagged a pure poll; a turn now counts as a poll only when it carried no real command.
- **The soft part of the instrument is path extraction**, so the ceiling is reported under three
  progress definitions (below). The conclusion does not depend on it.

### [$0 GATE] T1 / T3 / T2 — ALL THREE DEAD. No live cell authorized.
**5 trigger families × 32 threshold/variant combinations, replicated on 2 independent runs.**

#### The structural finding that decides all three levers
**There is no long doomed tail on this backbone.** The portfolio assumed failed tasks burn tokens
after becoming doomed. They do not:

| | run1 (rotate18, 72 rollouts, pre-longyield) | screen18 (36 rollouts, **shipped** config) |
|---|---|---|
| exitReason | `model_stopped` 72/72 | `model_stopped` 36/36 |
| reached the 60-call cap | **0** | **0** |
| failed-task turns min/median/max | 8 / 15 / 30 | 6 / 12 / 21 |
| **turns AFTER last progress** | 1 / **2** / 5 | 1 / **1** / 4 |
| failed-task spend | $0.3697 (52.8%) | $0.1426 (44.9%) |
| **ORACLE ceiling** (spend after last progress, failed tasks) | **13.4%** | **13.3%** |

Luna self-terminates roughly one to two turns after its last progress event. The oracle ceiling —
what a *perfect, clairvoyant* trigger with no confirmation delay could recover — is **13.4%**,
already **below the pre-registered 15% bar before any trigger exists**. Any real trigger needs
confirmation turns and so recovers strictly less.

Robustness of that ceiling (run1 → screen18), stripping out the heuristic part of the instrument:

| progress definition | run1 | screen18 |
|---|---|---|
| newFile ∨ diff ∨ test (default) | 13.4% | 13.3% |
| diff ∨ test only (ignores file novelty) | 20.5% | 21.8% |
| diff only (harshest) | 22.4% | 24.4% |

Only the harshest definition exceeds the bar on ceiling — so it was tested directly (T3d below)
rather than argued away.

#### Threshold sweep — the tail and the veto move in lockstep
Every combination that recovers a material tail costs solves; every FP-clean combination recovers
nothing. Selected rows (full sweep in the tool output; FP is *fires strictly before the solving patch*):

| lever | param | run1 tail% | run1 FP/solved | screen18 tail% | screen18 FP/solved |
|---|---|---|---|---|---|
| T1v1 strict zero-novelty | N=2..5 | 0.0% | 0/15 | 0.0% | 1/7 → 0/7 at N≥3 |
| T1v2 consecutive-among-searches | N=2 | 4.3% | **1/15** | 0.0% | **1/7** |
| T1v2 | N=3 | 4.3% | 0/15 | 0.0% | 0/7 |
| T1v3 low-novelty | N=2,M≤2 | **21.0%** | **3/15** | 0.0% | **3/7** |
| T1v3 | N=3,M≤2 | 4.3% | 0/15 | 0.0% | 1/7 |
| T3 no-progress | X=3 | 7.2% | **5/34** | 2.8% | **1/17** |
| T3 | X=8 | 0.0% | 0/34 | 0.0% | 0/17 |
| T3g **guarded** (needs a patch ∧ a test first) | X=2 | 0.2% | **1/34** | 3.3% | **2/17** |
| T3g | X=4 | 0.0% | 0/34 | 0.0% | 0/17 |
| T1g guarded | N=1,M≤2 | 2.4% | **1/15** | 3.9% | **2/7** |
| T3d **diff-only progress** | X=4 | **69.9%** | **25/34** | **68.0%** | **14/17** |
| T3d | X=8 | **18.8%** | **5/34** | 4.7% | **5/17** |
| T3d | X=12 | 3.6% | 0/34 | 0.0% | 1/17 |
| T2 failed-edit streak | K=2 | 0.0% | **1/34** | 2.7% | **1/17** |
| T2 | K=3,4 | 0.0% | 0/34 | 0.0% | 0/17 |

- **Best FP=0 recoverable tail across all 32 combinations: 4.3% (run1), 0.0% (screen18).** Bar: 15%.
- The only combinations clearing 15% (T1v3 N=2/M≤2 at 21.0%; T3d at 18.8–69.9%) buy that cost by
  destroying solves — up to **25 of 34** solved trajectories cut before their solving patch.
- **Guarding did not rescue it**, and the reason is mechanical: a guard can only make the trigger
  fire *later*, which pushes the tail toward zero. It removed some false positives and the recovery
  with them. This is the pre-registered escalation rule playing out exactly as written.
- T1's specific premise is also false in the data: **strict zero-novelty never fires at any N.**
  ss-* searches essentially always surface at least one previously-unseen path. mransan's 24-call
  tour is 24 legitimately-novel searches — consistent with the lever #5 census (0 exact dups, 3%
  repeat-hit share). **Retrieval-thrash is broad exploration, not redundant retrieval.**

#### Verdict — ranked go/no-go
| rank | lever | recoverable tail @ FP=0 | FP rate at any tail ≥15% | verdict |
|---|---|---|---|---|
| 1 | **T1** novelty-stall | 4.3% run1 / 0.0% shipped | 3/15 solved (20%) | **NO-GO — dead for $0** |
| 2 | **T3** no-progress abort | 0.0% both runs | 5/34 → 25/34 solved | **NO-GO — dead for $0** |
| 3 | **T2** failed-edit streak | 0.0% both runs | never reaches 15% at all | **NO-GO — dead for $0** |

No lever cleared Gate 0, so **no live smoke ran and $0 was spent** — there are no break-priced cost
deltas to report, which is the correct outcome, not a gap. Production is unchanged.

#### What this closes
The trajectory-cutting cost frontier is **closed**. Combined with polls (shipped, −71%) and
eviction/fusion/preamble (no-go), the context-side and now the trajectory-side cost levers are both
exhausted for this backbone. Remaining failed-task spend is incurred by trajectories that are still
making progress right up to the turn the model voluntarily stops. Cutting them cannot be done on a
progress signal, because there is no no-progress period to detect.

**Do not reopen without a backbone change.** The finding is a property of *this* backbone: a model
that runs to a turn cap, or one that loops after going doomed, would re-open all three levers
immediately. The instrument (`stats/thrash-census.mjs`) is committed and re-runnable against any
future run's `agent-state/` + `rows.json`, so re-testing costs one command.

### [$0 FOLLOW-UP] Where failed-task spend actually goes — and why no cut can find it
`thrash-census.mjs --mode spend`. If the money is not in a doomed tail, it has to be somewhere.
It is spread evenly, and **failed trajectories are shaped like solved ones**:

| category | FAILED share (screen18) | SOLVED share (screen18) | FAILED (run1) | SOLVED (run1) |
|---|---|---|---|---|
| read | 22.7% | 19.1% | 20.4% | 18.7% |
| edit | 20.9% | 17.2% | 19.9% | 18.6% |
| run_tests | 17.7% | 17.0% | 14.7% | 18.2% |
| ss_search | 13.1% | 12.9% | 10.8% | 10.2% |
| model_message | 9.0% | 13.3% | 12.4% | 11.5% |
| other_shell | 7.6% | 9.8% | 6.0% | 6.7% |
| native_search | 6.6% | 6.5% | 4.7% | 6.8% |
| poll | 2.4% | 4.1% | 11.2% | 9.2% |
| **phase: explore / repair** | **47% / 53%** | **51% / 49%** | 45% / 55% | 44% / 56% |

Two things follow.

1. **There is no waste signature to trigger on.** Failed and solved trajectories spend their money
   in the same proportions, in the same phases, at the same $/turn. A doomed trajectory is not a
   productive one plus waste — it is the same process that arrived at a wrong answer. This is the
   cost-side confirmation of the known **universal wrong-fix floor**
   (`project_resolution_floor_universal_wrongfix`), and it explains mechanically why all three
   levers failed: no progress-based detector can separate the two populations, because on every
   spend axis measured they are the same population.
2. **No dominant bucket remains.** The largest single category is `read` at ~21-23%, and everything
   else sits between 2% and 21%. There is no successor to the poll lever (which was 15.9% of
   *total* spend concentrated in one mechanical behaviour). Spend is now flat.

Sanity check that fell out of this: **poll share dropped 11.2% → 2.4% of failed-task spend** between
run1 and the shipped configuration, independently reproducing the −71% poll result from lever #1
on a different statistic. The instrument agrees with the one lever that did ship.
