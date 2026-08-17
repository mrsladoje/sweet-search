# SLATE B Phase 0 — evidence-integrity repair results

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §9 Phase 0<br>
**Date:** 2026-08-17 — **Model spend: `$0`** (no agent rollout was launched; the only compute
was 8 grading runs of an already-recorded gold patch)<br>
**Protected state:** no existing file under remote `results/` was modified; new artifacts live in
`results/phase0-reverify-20260817/` and are copied into `handoffs/improve/phase0-reverify-20260817/`.
HO2 untouched.

---

## 0. Verdict

**Phase 0 is complete, and it cost the scoreboard most of its headline.**

The task-completion set carried **four tasks that cannot measure anything**, and those four were
carrying sweet's cost advantage. On the admissible 13, Claude goes from `−9.4%` to `−0.3%` — a
dead heat. That is the finding of this phase; everything else is plumbing.

| SLATE-B Phase 0 item | status coming in | status now |
|---|---|---|
| **D1** YARP gradeable or removed | root cause fixed, second defect open | **REMOVED** — the deflake was tried and it fails out of sample (§2) |
| **D2** terminal parsed test verdicts | built, tested, **never committed**, never in effect | **committed** (§3); box deployment still pending and gated |
| **D7** subagent spend in the ledger | done under SLATE-A D-2 | closed, no work needed |
| **D3** degeneration marked consistently | detector shipped; the declared **retry rule was never implemented** | **implemented** (§4) |
| **D4** `ss-grep --in` multi-scope | fixed after the 2026-08-11 run | closed, no work needed |
| **D5** `ss-trace` cross-file edges | premise refuted at `$0` (`FIX-REPORT.md` §4) | closed, no work needed |
| **mransan** repaired or excluded | neither | **excluded** by an enforced blocklist (§5) |

Three defects were found that the plan did not list, all in §6.

---

## 1. The admissible scoreboard

Four tasks are now blocked from admission (§5). All four were present in the 2026-08-11 runs, so
the denominator falls from 17 to **13**.

Reproduced by [`p0c-admissible-ledger.mjs`](./phase1-scripts/p0c-admissible-ledger.mjs). The
`all tasks` row of every harness matches the published table **to the last digit**, which is what
makes the admissible row trustworthy rather than merely different.

| harness | view | n | native | sweet | delta | solve |
|---|---|--:|---:|---:|---:|---|
| codex | all tasks | 17 | `$0.144666` | `$0.135322` | `−6.5%` | 9 vs 10 |
| codex | **admissible** | 13 | `$0.112373` | `$0.101768` | **`−9.4%`** | 7 vs 8 |
| opencode | all tasks | 17 | `$0.135444` | `$0.111390` | `−17.8%` | 9 vs 9 |
| opencode | **admissible** | 13 | `$0.106840` | `$0.090495` | **`−15.3%`** | 7 vs 7 |
| claude-code | all tasks | 17 | `$0.239224` | `$0.216651` | `−9.4%` | 9 vs 9 |
| claude-code | **admissible** | 13 | `$0.178703` | `$0.178122` | **`−0.3%`** | 7 vs 7 |

Claude is sidechain-inclusive (`rows-sidechain-inclusive.json`); costs are per-task means on the
`idealCost` column, the aggregation `RESULTS-2026-08-13.md` §9.3 settled on.

**Why Claude collapses.** The four blocked tasks were sweet's four best Claude cells:

| harness | native on the 4 blocked | sweet on the 4 blocked | delta |
|---|---:|---:|---:|
| codex | `$0.032293` | `$0.033554` | `+3.9%` |
| opencode | `$0.028604` | `$0.020894` | `−27.0%` |
| claude-code | `$0.060522` | `$0.038529` | **`−36.3%`** |

PHASE-0-RESULTS.md reported that pricing delegated subagents "closes 62% of the Claude gap". That
correction was real and stands. What it bought, on the tasks that can actually measure something,
is **`−0.3%`** — indistinguishable from zero, and consistent with the sign instability
`SLATE-B-UBER.md` §0 already flagged for this harness.

Codex moves the other way, to `−9.4%`, because its invalid tasks slightly favoured native. Codex
keeps its one-task solve lead (8 vs 7).

**No solve number changed.** All four blocked tasks were unsolved by both arms, or ungradeable.

---

## 2. D1 — YARP: the deflake was attempted, and it failed

`PHASE-0-RESULTS.md` §2.3 established that grading `dotnet__yarp-2825`'s **own gold patch** eight
times failed the `PASS_TO_PASS` gate in **4 of 8** runs, derived an 11-test flaky set from those
gold runs, and reported "gold grades FULL 8 of 8 after exclusion".

**That 8/8 was in-sample.** The set was fitted on exactly the runs it was then checked against, so
it was guaranteed to fit them. It said nothing about the next run.

[`p0b-yarp-reverify.mjs`](./phase1-scripts/p0b-yarp-reverify.mjs) froze that 11-test set — never
re-deriving it — and graded gold on **8 fresh runs**:

| | result |
|---|---|
| gold FULL after the frozen exclusion | **5 of 8** |
| further tests that failed gold **outside** the frozen set | **5** |
| `FAIL_TO_PASS` | 1/1 in all 8 — the target test is not the problem |
| recovered test results | 2150–2153 per run |

The five escapees include `Yarp.Kubernetes.Controller` tests the first batch never touched
(`BackgroundHostedServiceTests.StartAndStopUnderWebHost`, two `Rate.Tests.LimiterTests`), so this
is not a near-miss on the same cluster of WebSocket tests.

**The flaky tail is open-ended.** Each fresh batch surfaces new names, so every batch would need a
wider exclusion fitted to it — which is the in-sample error again, with more steps. A single
grading of this task remains a coin flip of unknown bias.

**Decision: blocked, not deflaked.** The `excludeP2P` override was written, then reverted when the
re-verification came back. Blocking also parks `SLATE-B-UBER.md` Q1 (cardinality simulation),
whose entire ceiling rested on this task — Q1 is now dead rather than quarantined, unless a
different YARP-shaped task is recruited.

Evidence: `handoffs/improve/phase0-reverify-20260817/` (summary, per-run detail, the frozen set, the log).

---

## 3. D2 — the terminal test verdict, finally committed

`SLATE-A-CLOSE-RESULTS.md` §6 recorded D-6 as "Fixed, with a regression test".
`SLATE-A-RESIDUE-RESULTS.md` §6.2 then found that `rt-inflight.mjs`, its test, and the
`codex-task-runner.mjs` rewiring were **absent from `HEAD` and absent from the evidence box**.
Every codex run to date ran without them.

The work was green in one dirty working tree and is now **committed**: the running banner written
before the request (so a yielded cell is never empty), attach-do-not-relaunch for a call made
while a suite is in flight, the durable verdict published by the broker rather than the requester,
and `runTestsTelemetry()` row columns (`rtLaunched`, `rtVerdicts`, `rtNoVerdict`,
`rtEndedUnverified`). `node tests/rt-inflight.mjs` — 19 assertions, green.

**Still pending, deliberately: deployment to the evidence box.** Shipping it changes `run_tests`
behaviour, so no run before it can be pooled with any run after it. That is a run-time act,
belonging to the first Phase-2 launch, not to Phase 0.

---

## 4. D3 — the degeneration retry rule now exists

The arm-blind detector (`harness/degeneration.mjs`) was shipped and is load-bearing.
`RESULTS-2026-08-13.md` §9.3 then pre-registered the policy — *a degenerate rollout is re-run and
the retry replaces it* — and **nothing implemented it**. `run-pilot.mjs` contained no reference to
degeneration at all.

Implemented as [`harness/degeneration-policy.mjs`](../../harness/degeneration-policy.mjs), a pure
state machine mirroring `shim-policy.mjs`, wired into the collection loop beside the shim retry.
It follows §9.3 exactly, including the part that is easy to get wrong: a **second** degenerate
attempt is **kept and flagged, never excluded**. Dropping rollouts after seeing which arm drew
them is the researcher degree of freedom the rule exists to remove — which is why this policy
deliberately differs from `shim-policy.mjs`, where a second tamper does exclude.

The retry accrues cost, and `degenReran` / `degenerateAfterRetry` are stamped on the row.
Tests: `node tests/degeneration-policy.mjs`, 14 assertions, green.

---

## 5. The admission blocklist

`harness/task-blocklist.json` + `harness/task-admission.mjs`, enforced by `run-pilot.mjs`
immediately after `INSTANCES` resolves:

- **named explicitly** in `INSTANCES` → hard error, refuse to launch;
- **swept in** by a whole-file selection → dropped, named on stdout, denominator shrinks visibly;
- `SS_ALLOW_BLOCKED_TASKS=1` admits them anyway, with a per-task warning.

Kept in its own file rather than as a `task-overrides.json` field on purpose: `NO_TASK_OVERRIDES=1`
disables that file wholesale, and a validity gate a convenience switch can turn off is not a gate.
A test asserts exactly that.

| blocked task | reason | evidence |
|---|---|---|
| `dotnet__yarp-2825` | ungradeable | gold fails its own gate; deflake fails out of sample (§2) |
| `mransan__ocaml-protoc-202` | empty-issue | zero-character statement, 19-file gold change |
| `redboltz__mqtt_cpp-466` | vacuous-f2p | **resolves with an empty patch** |
| `statamic__cms-9029` | vacuous-f2p | **resolves with an empty patch** |

Tests: `node tests/task-admission.mjs`, 25 assertions, green.

---

## 6. Three defects the plan did not list

**6.1 The green-ledger invariant test was red on `main` for four days.**
`tests/env-ledger-gate.mjs` asserted `RT_HARNESS_FINGERPRINT.version === 2`. Commit `7562b42`
(2026-08-13) bumped it to 3 and added the grader sources without updating the test. This is the
same shape as D-1: a fingerprint that nobody checked against itself. Repaired, and the test now
also asserts the grader source list and hashes, so the next silent bump fails here.

**6.2 The control set is down to three tasks.** Two of its five — `redboltz__mqtt_cpp-466` and
`statamic__cms-9029` — are vacuous and are now blocked. Every "no control regression" claim made
against the five-task set was measured 40% against tasks that cannot regress. Recruiting two
replacements is `SLATE-B-UBER.md` §7 work and is **not** done here.

**6.3 Q1 is dead, not quarantined.** Its ceiling rested entirely on YARP.

---

## 7. What is publishable now

**Publishable:** the admissible-set table in §1, on all three harnesses, alongside the all-17
numbers it reproduces exactly.

**Not publishable:** any all-17 cost delta presented as the headline. It contains four tasks that
cannot measure anything, and on Claude and opencode those four supply most of the advantage.

**Not established:** that sweet is cheaper than native on claude-code. On the admissible set it is
`−0.3%`, which is nothing.

---

## 8. Recommended next step

`SLATE-B-UBER.md` W0 (`$0` candidate falsification) is unblocked, with two corrections to its
premises:

1. **P1's pytask ceiling is unchanged** — pytask is admissible and untouched by this phase. It is
   the strongest remaining resolution path and W0 should start there.
2. **The cost bar just got harder.** §1 removes the claude-code advantage, so P7's "15% on every
   harness" now has to be won from `−0.3%` on Claude rather than from `−9.4%`.

Before any paid work, §6.2 needs two replacement control tasks, gold-verified, or the no-regression
gate is measured against three tasks.

**Unchanged:** NO-GO for a paid pilot.
