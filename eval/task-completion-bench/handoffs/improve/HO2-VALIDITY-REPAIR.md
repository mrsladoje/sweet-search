# Held-out set 2 — a deliberate freeze break, for a validity repair, with no result inspected

**Executes:** [`VACUITY-PRESCREEN-RESULTS.md`](./VACUITY-PRESCREEN-RESULTS.md) §3, which
found one flagged task inside frozen HO2, scanned for a **count only**, and closed with
*"it should be identified and removed by whoever next unfreezes HO2, and the denominator
restated."* This is that repair.
**Date:** 2026-08-24. **Model spend: `$0.000`** — the null arm makes zero tool calls.
**Artifacts:** [`ho2-repair-20260824/`](./ho2-repair-20260824/) — `structural-scan.txt`,
`null-arm.txt`.

---

## 0. Verdict

**`ucl__stir-1442` grades RESOLVED for a rollout that did nothing. It is removed. HO2's
denominator is 199, not 200.**

## 1. What was opened, and what was not

Phase 0 doctrine permits a validity repair. This one was kept as narrow as the repair needs:

| opened | not opened |
|---|---|
| `select/.cache/tasks_full_heldout2.json` — the task RECORDS | any HO2 result, rollout, grade, trajectory or per-query outcome |
| one task's `FAIL_TO_PASS` strings | any arm's score on HO2, aggregate or per-task |
| a fresh gold grade of that one task | anything about the other 199 tasks beyond the pre-screen's boolean |

The identification is **structural**. The task was named by running the pre-screen over the
task records and printing the one id it returns. Nothing about how any arm performed on it
was consulted, before or after.

## 2. The structural evidence

```
HO2 pool size (as shipped): 200
flagged: ucl__stir-1442
FAIL_TO_PASS entries: 21 | carrying the ctest success marker: 21
HO2 denominator after removal: 199
```

**All 21 of its `FAIL_TO_PASS` entries are verbatim `ctest` SUCCESS lines**, not test names:

```
1/67 Test  #1: test_DataSymmetriesForBins_PET_CartesianGrid .......   Passed   44.20 sec
7/67 Test  #7: test_PoissonLogLikelihoodWithLinearModelForMeanAndProjData   Passed  157.18 sec
… 19 more, every one of them "Passed"
```

A `FAIL_TO_PASS` entry is supposed to name a test that **fails** on the base tree. This list
was harvested from a run in which all 21 passed. It is another `ctest` project, which is the
pattern the pre-screen found: the defect tracks the test RUNNER, not the project.

## 3. The null arm — the authority, not the pre-screen

The pre-screen is a pre-filter. The confirmation is a real null arm, run behind a **green
ledger** rather than an override:

- The HO2 ledger entry was **stale** (`configHash 08e32a6fea245d40 ≠ current 558229c74bb80f1a`),
  so the task was re-swept first. Fresh verdict: `grade FULL, f2pPass 21/21, status gold-valid`,
  in `/root/env-ledger/ho2-stir-repair/ledger.jsonl`. Preflight then passed 1/1.
- `AGENT_TIMEOUT_MS=1000`, `ARMS=sweet`, `REPS=1`, isolation ON.

```
[sweet rep0] calls=0 ss=0 edits=0 hunks=0 ranTests=false $0 ideal$0 1s exit=timeout
  sweet rep0: resolved 1/1 gradeable  ids=ucl__stir-1442
```

**Zero tool calls, an empty patch, graded RESOLVED.** The pre-screen's calibration is now
**3 recovered of 3 known, 0 false alarms**.

`SS_ALLOW_BLOCKED_TASKS=1` was required for this run and is legitimate here: the pre-screen
had already been wired into admission and refuses the task by name, and the entire purpose of
the run was to test that refusal against ground truth. No denominator is published from it.

## 4. What changes

- **`ucl__stir-1442` is in `harness/task-blocklist.json`**, `reason: vacuous-f2p`, with the
  evidence above. Naming it in `INSTANCES` is now a hard refusal; sweeping it in drops it and
  says so.
- **Every HO2 denominator is 199.** Any published HO2 figure computed over 200 tasks counted
  a task both arms resolve for free, which inflates both arms' rates and compresses the gap
  between them. The direction of the bias is known; its size is not restated here, because
  restating it would mean opening HO2 results, which this repair did not do.
- **HO2 remains frozen.** This was one repair, on one task, by structure.

## 5. What this does not settle

The pre-screen sees **one** cause of vacuity. A task whose `FAIL_TO_PASS` already passes for
some other reason is not flagged, and nothing here bounds how often that happens. HO2 has not
been null-armed as a whole and this document is not a claim that the other 199 tasks can all
fail. It is a claim about one task that provably cannot.
