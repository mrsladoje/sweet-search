# General engineering clauses — 13-task screen: the candidate is dead

**Executes:** [`CLAUSE-SCREEN-PREREGISTRATION.md`](./CLAUSE-SCREEN-PREREGISTRATION.md) and its
Amendment 1, both committed before the run (`3454123` line, amended before any rollout existed).
**Date:** 2026-08-21 → 2026-08-24. **153 rollouts, `$0.835`**, opencode /
`openai/gpt-5.6-luna`, 13 admissible tasks × 3 reps × 4 conditions.
**Artifacts:** [`clause-20260824/`](./clause-20260824/) — `report.txt`, three `rows-*.json`.
**Instrument:** [`clause-screen-report.mjs`](./phase1-scripts/clause-screen-report.mjs).

---

## 0. Verdict

**Both clause variants fail the pre-registered bar, and they fail in the flattest way
available: on the eight tasks not used to select them, every condition solves exactly
`3/8` tasks and exactly `9/24` rollouts. Not a small effect — no effect.**

| condition | majority-solved, all 13 | rollouts solved | `$`/rollout |
|---|---:|---:|---:|
| `NAT` native, no memory file | **7/13** | 21/39 | `$0.007648` |
| `C0` sweet, production memory file | 5/13 | 17/39 | `$0.007044` |
| `CG` sweet + family/surface/symmetry | 5/13 | 16/37 | `$0.007088` |
| `C14` sweet + family/minimal-change | 6/13 | 16/38 | `$0.007026` |

| bar | `CG` | `C14` |
|---|---|---|
| ≥ +2 tasks majority-solved | **+0** | +1 |
| zero regression | **`gradethis` regressed** | none |
| ≥ 1 gain among the 8 unused tasks | **0** | **0** |
| cost ≤ +10% | +0.6% ✓ | −0.2% ✓ |
| **result** | **FAIL** | **FAIL** |

The clauses are genuinely free — `+0.6%` and `−0.2%` per rollout against an expected `+5%`
from ~400 extra prompt tokens, absorbed by slightly shorter trajectories. Free and inert.

## 1. Delivery was verified live, so the null is real

This is the check the boundary smoke got wrong, and it was run twice here.

**Before the run, at `$0`:** `buildInstructionFile({sweet:true})` was called on each variant.
`CG` contained G1, G2, G3 and not G4; `C14` contained G1 and G4 and not G2/G3; and the
`sweet:false` build contained **no clause in any condition**, so native could not leak.

**After the run, from the recorded ledger** — mean first-turn input tokens per condition:

| condition | first-turn input | vs `C0` | expected from bytes |
|---|---:|---:|---|
| `NAT` | 6,653 | −1,457 | native gets no memory file at all |
| `C0` | 8,110 | — | — |
| `CG` | 8,488 | **+378** | +1,741 chars ≈ +380 tokens ✓ |
| `C14` | 8,333 | **+223** | +1,065 chars ≈ +240 tokens ✓ |

Every arm received exactly what it was supposed to receive. **The agents read the clauses and
did not act differently.**

## 2. The prior signal does not replicate, on its own tasks

The candidate came from a five-task rotation at four reps: `L0 11/20` against `GALL 15/20`,
with `teleport-291` going `0/4 → 3/4`. Those same five tasks, here, at three reps:

| selection task | `NAT` | `C0` | `CG` | `C14` | prior claim |
|---|---|---|---|---|---|
| `jashkenas__underscore-2757` | 3/3 | 1/3 | 2/3 | 2/3 | `2/4 → 4/4` |
| `teleporthq__teleport-code-generators-291` | 2/3 | 1/3 | **0/2** | **0/3** | `0/4 → 3/4` |
| `akinsho__nvim-bufferline.lua-173` | 3/3 | 3/3 | 3/3 | 3/3 | `4/4 → 4/4` |
| `rstudio-education__gradethis-161` | 3/3 | 3/3 | 1/2 | 2/3 | `3/4 → 3/4` |
| `pytask-dev__pytask-210` | 1/3 | 0/3 | 1/3 | 0/3 | `2/4 → 1/4` |
| **rollouts solved** | 12/15 | 8/15 | **7/13** | **7/15** | `11/20 → 15/20` |

**`teleport-291` — the single task that carried the original claim — moves the other way**,
from `1/3` at baseline to `0/2` and `0/3` under treatment. The aggregate on the selection
tasks goes down, not up.

The original write-up labelled that result *"not significant at n=20"* and called it a
candidate for a real screen. This is the real screen, and it says the `+4/20` was noise.

## 3. One confound, named, and why it does not change the answer

The first screen delivered the clauses through `problem_statement` — inside the issue text,
adjacent to the task. This screen delivered them through the **memory file**, which is the
only channel `ss init` actually ships. Those are different positions in the context, and the
non-replication could in principle be a delivery-position effect rather than a clause effect.

**That distinction does not change the product decision.** A rule that only works when
injected into the issue statement is not shippable: sweet does not write the issue. Spending
another 39 rollouts to separate the two would answer a benchmark question, not a product one,
so it was not spent.

## 4. Integrity

Three rollouts were lost to the harness — `CG/gradethis`, `CG/teleport`, `C14/codeception`,
one rep each. The pre-registered discard threshold was **more than 5**, so the run stands.
But two of the three land on `CG`, and **`CG`'s one recorded regression (`gradethis`) sits on
a 2-rep denominator**, which is exactly where a majority test is least trustworthy. That
regression should be read as weak, and it does not rescue `CG` regardless: `CG` gained zero
tasks and zero fresh tasks.

Controls behaved: `robot`, `scoringutils` and `parcels` are `3/3` in all four conditions, and
they got slightly **cheaper** under both treatments (`$0.005384 → $0.005319 / $0.005134`).
No control regressed, which was true of the first screen too and remains the one durable fact
about these clauses: they are safe. They are simply not useful.

## 5. What this screen says about the head-to-head, which is not what it was for

The base pilot is a clean 13-task, 3-rep, same-day comparison of sweet against native on the
current production prompt. It is worth recording plainly:

| | native | sweet | delta |
|---|---:|---:|---|
| tasks majority-solved | **7/13** | 5/13 | sweet **−2** |
| rollouts solved | **21/39** | 17/39 | sweet −4 |
| cost per rollout | `$0.007648` | **`$0.007044`** | sweet **−7.9%** |
| cost per solved task | **`$0.014203`** | `$0.016159` | sweet **+13.8%** |
| tool calls per rollout | 24.3 | **18.0** | sweet −26% |

**Sweet is cheaper per rollout and more expensive per solved task.** That is the standing
position restated on fresh reps, and it is the thing every remaining programme has to move.

## 6. Disposition

**The general-clause candidate is closed.** It was the cheapest lever on the table and the
only one needing no tool; it does nothing. Record it in the discard log so it is not
rediscovered:

> *General engineering clauses in the sweet memory file — family completeness, public
> surface, symmetry, minimal change. Delivery verified live in both directions. Zero movement
> on 8 unused tasks (`3/8`, `9/24` in every condition), and the originating signal reversed on
> its own five selection tasks. Free, safe, inert.*

The dev-200 escalation named in the amendment is **not** warranted. The amendment set the
condition explicitly — *"if it fails to replicate, the candidate is dead and no larger run is
needed"* — and it failed to replicate on the very tasks that produced it.
