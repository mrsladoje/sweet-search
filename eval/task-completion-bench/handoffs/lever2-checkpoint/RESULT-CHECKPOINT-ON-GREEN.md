# RESULT — microsmoke lever #2, verified checkpoint-on-green: **NO-GO**

Date: 2026-08-07. Operator: Claude. Spend: **$0** (no model calls at all — box docker compute only).
Data: DEV-RET only. `HO2` was never read.

---

## Verdict

**NO-GO. Do not build checkpoint-on-green, and do not run a live smoke.**

Three independent gates each kill it, and the flagship motivating example turns out to be a
different failure:

| gate | measurement | result |
|---|---|---|
| 0a — validity | can the agent's `run_tests` see the hidden target tests? | **No.** On 6/6 probed tasks it cannot even separate the gold patch from an empty patch. Legitimate (no oracle access), but "green" carries zero correctness information. |
| 0 — exposure | does the failure shape the lever targets occur? | **0 triggers in 119 rollouts.** 95% upper bound on trigger rate 2.5%. |
| 0c — selector safety | is best-vs-final safe? | **2 grader regressions in 5 graded exposures**, 0 wins. `EDIT_THRASHING.md` §4.2 forbids restore. |

The `/microsmoke` rule — never buy a live cell until a $0 check proves the treatment takes
effect — stopped this at Gate 0. No live smoke was run.

---

## 1. Gate 0a — `run_tests` versus the grader

The agent's `run_tests` applies only the agent diff to the BASE commit and runs
`install_config.test_cmd` (`harness/rt-shim-runtime.mjs` `runSuite`). The grader applies
`test_patch` + the agent diff. The handoff asked whether these two see the same tests.

### Static half — 18/18 task specs, no docker

Classifying each task by where its FAIL_TO_PASS tests come from:

| regime | meaning | count |
|---|---|---|
| NEW-TEST | `test_patch` creates the target test | **10/18** |
| NEW-ASSERT | target test name pre-exists, `test_patch` only adds assertions | 2/18 |
| MIXED | both | 1/18 |
| unclassifiable by the parser | — | 5/18 |

For at least 12 of 18 tasks the target test does not exist at the base commit, so the agent
literally cannot execute it.

### Empirical half — 6 tasks, faithful replication of the shim path

For each task the harness's own container script was replayed with three inputs, and the
harness's own classifier applied to the output:

| task | language | empty diff | gold patch | syntax-broken gold | baseline trustworthy |
|---|---|---|---|---|---|
| `jashkenas__underscore-2757` | js | FAIL/FAIL | FAIL/FAIL | FAIL/FAIL | **no** |
| `litestar-org__polyfactory-405` | python | FAIL/FAIL | FAIL/FAIL | FAIL/FAIL | **no** |
| `dotnet__yarp-2825` | csharp | FAIL/FAIL | FAIL/FAIL | FAIL/FAIL | **no** |
| `rstudio-education__gradethis-161` | r | FAIL/PASS | FAIL/PASS | FAIL/FAIL | yes |
| `oceanparcels__parcels-617` | python | FAIL/PASS | FAIL/PASS | FAIL/FAIL | yes |
| `akinsho__nvim-bufferline.lua-173` | lua | PASS/PASS | PASS/PASS | FAIL/FAIL | yes |

(cells are `status`/`verdict` from the machine footer)

**The disagreement rate is 6/6.** On every probed task the gold patch — which the ledger
grades FULL — produces exactly the same `run_tests` verdict as no patch at all. Three tasks
report FAIL on the gold patch.

Consequences:

1. **Publishability is fine.** The agent's "green" is its own in-loop validation, not the
   grader's tests. There is no oracle access to disclose.
2. **The lever loses its premise.** Guardrail #1 asked to checkpoint only when the target test
   passes and pre-existing tests still pass. The target test is invisible, so "green" degrades
   to "the base suite did not visibly break" — and §3 below shows even that is unreliable.

---

## 2. Gate 0 — exposure: does the failure shape occur?

Every rollout retains two ledgers that together reconstruct the full edit/test state sequence
with no model calls: the raw codex rollout (which carries the harness's own
`[run_tests verdict]` / `[run_tests baseline-diff]` footer lines) and `rt-dedup/*.jsonl`
(which carries `diffSha` per call). Joining them by call order gives, for each rollout, the
ordered list of source states and the verdict the agent was given for each.

A **verified checkpoint** is defined exactly as `EDIT_THRASHING.md` §4.1 plus handoff
guardrail #1: `scope=full` and `trustworthy=yes` and `introduced_failures=0` and
`verdict=PASS`, on a state with a real source edit.

The **trigger** is: a verified-green edited state exists, and the last edited state is a
different, non-green state — the "reached green, then edited past it and submitted the broken
one" shape.

### Luna via codex, 5 runs

| run | rollouts | any verified-green | ≥2 edited states | **triggers** |
|---|---|---|---|---|
| `luna-rotate18-run1` | 72 | 55 (76%) | 26 (36%) | **0** |
| `luna-poll-screen18` | 36 | 26 (72%) | 11 (31%) | **0** |
| `luna-poll-longyield-v1` | 12 | 6 (50%) | 4 (33%) | **0** |
| `luna-poll-longyield-rot` | 12 | 11 (92%) | 0 | **0** |
| `luna-smoke1` | 2 | 2 | 0 | **0** |
| **total** | **134** | — | — | **0** |

15 of the 134 rollouts have incomplete footer coverage (the raw session did not retain every
`run_tests` output — 5 of them retained none). Those are reported, not imputed. Over the 119
cleanly-joined rollouts the trigger count is **0**.

Three quarters of rollouts DO reach a verified-green state. In every single one of them the
final edited state is also green. The agent does not corrupt verified work in this regime.

**One-sided 95% upper bound on the trigger rate: 2.5%.**

§4.2 requires zero grader regressions across enough exposures that the 95% upper bound on
regression risk is under 5% — at least 59 triggered tasks. At a 2.5% trigger rate that needs
roughly **2,400 rollouts** before the gate could even be evaluated.

### Scope check — is this specific to Luna?

The same census (coarser proxy: exit code plus parsed failure count, which over-detects — it
reported 2 false triggers on Luna where the exact method reported 0) over the Grok-4.5 /
OpenCode cells:

| cell | rollouts | strict triggers | lenient triggers |
|---|---|---|---|
| `turnfix-capcell44-20260804` | 74 | 0 | 5 |
| `turnfix-clean-baseline-20260804` | 41 | 1 | 2 |
| `turnfix-v2screen-20260805` | 38 | 0 | 1 |
| `turnfix-footer-h2-20260804` | 21 | 0 | 1 |
| **total** | **174** | **1** | **9** |

8 of the 9 lenient triggers are on rollouts that failed anyway. The shape is rare on both
backbones — this is not a Luna artifact.

---

## 3. Gate 0c — selector safety: best versus final

Even with zero triggers, the selector can still act whenever several states are all "verified
green". The §4.1 ranking is: target passes, then fewer introduced failures, then later build
stage, then no prohibited files, then **smaller patch** as tie-break. When the target test is
invisible (§1) every green state ties on the first four keys, so the decision falls through to
patch size — which prefers earlier, less complete work.

Across `luna-rotate18-run1`:

- 13 rollouts have ≥2 distinct verified-green states.
- In **11 of 13** the ranking picks a state other than the agent's own final one.
- **7 of those 11 are rollouts the agent solved** — where a switch can only lose a solve.

Five of the seven were reconstructed byte-exactly by replaying the recorded `apply_patch`
payloads onto the base checkout, then verified by comparing the sha256 of the reconstructed
diff against the `diffSha` the rt-dedup ledger recorded for that same call (4/5 hash-exact;
the fifth matched on byte count only and is flagged). The remaining two (`gradethis` r0/r1)
were **not reconstructible** — the context-only patch format is ambiguous in
`R/detect_mistakes.R` — and are reported missing, never imputed.

All five were then graded with the real evaluator:

| task | arm | rep | reconstruction | agent's final | selector's choice | selector F2P | selector P2P failures | outcome |
|---|---|---|---|---|---|---|---|---|
| `akinsho__nvim-bufferline.lua-173` | sweet | 0 | hash-exact | resolved | **not resolved** | 0 | **8** | **grader regression** |
| `pytask-dev__pytask-210` | sweet | 1 | hash-exact | resolved | **not resolved** | 0 | 0 | **grader regression** |
| `epiforecasts__scoringutils-229` | native | 1 | hash-exact | resolved | resolved | 1.0 | 0 | tie |
| `redboltz__mqtt_cpp-466` | sweet | 0 | hash-exact | resolved | resolved | 1.0 | 0 | tie |
| `pytask-dev__pytask-210` | native | 0 | bytes only | resolved | resolved | 1.0 | 0 | tie |

**best wins 0 / ties 3 / losses 2. Grader-worse rate 2/5 (40%).**
Successful trajectories interrupted before their first passing patch: 0 (no trigger ever fired).

`EDIT_THRASHING.md` §4.2 requires **zero** observed grader regressions before restore may be
enabled. Two appear in the first five exposures. Restore stays OFF.

### The most damaging case

`akinsho__nvim-bufferline.lua-173/sweet/r0`, the state the selector would freeze, is a
half-finished refactor of `is_offset_section`. It fails **all 8** "Offset tests"
pass-to-pass tests. The harness told the agent:

```
[run_tests verdict] status=PASS scope=full exit=0
[run_tests baseline-diff] verdict=PASS introduced_failures=0 pre_existing_failures=0 trustworthy=yes
```

The agent kept working and repaired it. Checkpoint-on-green would have frozen the broken state
and thrown the repair away. "Verified green" is not merely uninformative about the target
test — on this runner it is wrong about the pre-existing tests too. A direct probe confirms the
boundary: this runner does catch a load-time syntax error, but not failing assertions.

---

## 4. The flagship example was a different failure

The handoff named `jashkenas__underscore-2757` as the clearest case of "verified good, then
rewrote into a broken patch". Replaying the raw rollout shows otherwise.

Failing rep (`sweet` r1), edits in order:

1. `groupBy`: `_.has(result, key)` → `hasOwnProperty.call(result, key)` — correct
2. `groupBy`: → `_.has(result, [key])` — the broken form
3. `groupBy`: → `hasOwnProperty.call(result, key)` — **reverted back to correct**
4. `groupBy`: → `((hasOwnProperty.call(result, key)))` — extra parentheses, still correct

`countBy` was **never edited**. The submitted patch is correct on `groupBy` and missing on
`countBy`, which is exactly the graded result: `f2pFrac = 0.5`, one of two target tests passing.
The solving rep (`sweet` r0) made the same `groupBy` edit and then also fixed `countBy`.

This is an **incompleteness** failure with some oscillation on the way, not a corrupted
checkpoint. No checkpoint policy could have helped: every state in the failing rep lacks the
`countBy` fix. This also explains why the census records `final-state-is-green` here — and why
the lever's motivating anecdote does not survive contact with the trajectory.

Correction to the record: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §24.3 describes this
rep as having "generated an internally-inconsistent patch mixing `hasOwnProperty.call(result,
key)` with a BROKEN `_.has(result,[key])` array-path form". That mixture existed only as an
intermediate state (edit 2 above) and was reverted two edits later. The classification §24.3
reached — generation variance, not retrieval — is unchanged and still correct; only the
description of the submitted patch needs amending.

---

## 5. The defect this uncovered — worth fixing on its own

While measuring "green", the first footer line turned out to be wrong very often. Across all
326 `run_tests` calls in the four Luna runs:

| symptom | calls | share |
|---|---|---|
| `status=FAIL` printed while `verdict=PASS` on the next line | 102 | **31%** |
| untrustworthy baseline (`trustworthy=no`, so no introduced-vs-pre-existing labelling at all) | 60 | **18%** |

**Correction 2026-08-07 (verification pass, `RUN-TESTS-VERDICT-DEFECT.md`):** the 31% is the
observed *disagreement* rate, not the *mislabel* rate. Decomposed, 48 of those 102 calls are
provably wrong (exit 0, only zero-failure artifacts as signatures); the other 54 have a non-zero
exit with a genuine pre-existing error, where `status=FAIL` is defensible and `verdict=PASS` is
correct. **The provable mislabel rate is 15%, not 31%.** The verification pass also splits this
section's single "defect" into three distinct ones with different mechanisms — see that document
before acting on the recommendations below.

**9 of 18 tasks never emit `status=PASS` at any point.** Two runners are completely
non-discriminative: `dotnet__yarp-2825` exits 145 and `litestar-org__polyfactory-405` exits 4
on the clean baseline, the gold patch and a broken patch alike, so the agent gets the same
FAIL no matter what it does.

Two independent causes:

1. **Non-zero exit with no parsed failures.** `classifySuiteResult` sets `status=FAIL` whenever
   `exitCode !== 0`, and `getBaseline` marks the baseline untrustworthy under the same
   condition, which also suppresses all baseline labelling.
2. **Passing summary lines extracted as failure signatures.** testthat's
   `[ FAIL 0 | WARN 2 | SKIP 2 | PASS 498 ]` and pytest's `XFAIL …` lines are pulled in as
   failures, so `status=FAIL` even at `exit=0`. The baseline-only rule rescues `verdict` but
   not the headline `status`.

The agent is told FAIL on a green suite in half of all calls. That is a plausible driver of the
over-editing this program is trying to remove — and unlike checkpoint-on-green it is a
correctness repair, arm-symmetric, with no A/B risk. It does change the harness config
fingerprint, so it needs a ledger re-sweep.

---

## 6. Ranked recommendations

1. **Fix the `run_tests` verdict labelling** (§5). Highest value, cheapest, arm-symmetric.
   Make `status` agree with `verdict`; stop treating a non-zero exit with zero parsed failures
   as both FAIL and untrustworthy; stop extracting passing summary lines as failure signatures.
   Then re-sweep the green ledger.
2. **Fix or exclude the non-discriminative runners** — `dotnet__yarp-2825` (exit 145),
   `litestar-org__polyfactory-405` (exit 4), `akinsho__nvim-bufferline.lua-173` (assertion
   failures invisible). A task where `run_tests` cannot separate gold from empty gives the
   agent no feedback loop at all, which distorts every turn-economy measurement taken on it.
3. **Consider the post-green stop rule, separately and for cost only.** 203 of 714 model
   requests (28%) happen after the first verified-green observation, containing only 20 edits
   and 16 tests across 55 rollouts — mostly non-productive churn. The mechanism already exists
   (`advisoryGuidance`, `green.streak-N.review-then-submit`) but needs `greenStreak >= 1`, not
   `>= 2`: only 16 post-green `run_tests` calls occur in total, so a second consecutive PASS is
   rarely observed. This is a cost lever, not a solve lever, and must be gated on solve-safety.
4. **Checkpoint-on-green: shelved, not deleted.** The retention machinery already exists and is
   tested (`harness/rt-progress-controller.mjs`, `SS_RT_PROGRESS=1`, wired at
   `harness/codex-task-runner.mjs:199`; it was OFF for every Luna run —
   `rtProgressTelemetry=false` on all rows). If a future backbone or a much larger tool-call cap
   produces long edit tails, re-run the census before building anything. Re-open only if the
   trigger rate clears ~5%.
5. **Do not use patch size as a checkpoint tie-break.** With the target test invisible it is the
   only live key, and it systematically prefers less complete work — the direct cause of both
   grader regressions in §3.

---

## 7. Reproduction

All analysis is $0 and re-runnable from retained data:

```bash
# exposure census from the harness's own verdict lines
node stats/checkpoint-exposure-census.mjs results/luna-rotate18-run1

# reconstruct the state a selector would have submitted, hash-verified against rt-dedup
node stats/checkpoint-reconstruct.mjs --run results/luna-rotate18-run1 \
  --task pytask-dev__pytask-210 --arm sweet --rep 1 --upto-call 3 --outdir /root/.ckpt-recon
```

Grading of reconstructed states used the standard evaluator path
(`sr-eval.py --json <specs> --patches <preds> --network none`) with the repo's own
`gradeFromReportItem` for scoring, so the numbers are directly comparable to `rows.json`.
