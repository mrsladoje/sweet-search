# Payoff — the repaired harness, re-baselined

Date: 2026-08-07. Spend: **$0 metered** (Luna via the codex subscription; realized
$0.55 of subscription-covered inference). Data: DEV-RET only. `HO2` untouched.
Follows `RUN-TESTS-VERDICT-DEFECT.md`; repair shipped in `2b80ee3`.

**This is a re-baseline, not a significance verdict.** At 17 tasks the solve comparison
is underpowered by construction, and the two halves of the repair push resolution in
opposite directions on purpose. A flat count is the success condition: the deliverable is
a truthful instrument, and every future number rests on it.

---

## 1. The mechanism worked, completely and symmetrically

| arm | baseline false-red rate | post-fix |
|---|---|---|
| native | 4/39 calls (10.3%) | **0/71 (0.0%)** |
| sweet | 7/44 calls (15.9%) | **0/66 (0.0%)** |

False-red = `status=FAIL` at exit 0 where every listed failure signature is a line that
reports zero failures. It is gone in both arms. The `trustworthy=no` category is gone
too: it does not appear anywhere in the post-fix taxonomy cross-tabs, which is the
install-sed repair (yarp) and the `✖` marker addition (underscore) landing.

Trustworthy-baseline coverage rose from 83% to **88%** of rollouts, and rollouts reaching
a verified-green state from 76% to **78%** — the instrument now sees more of what it is
supposed to see.

Run integrity is clean: 68 rollouts, 0 codex errors, 0 start retries, 0 shim tampering,
0 errored exits, and the gold tripwire flagged 0 of 34.

## 2. Resolution — flat, with both flips on known coin-flip tasks

rep0 versus the matched baseline (`luna-poll-screen18`), 17 common tasks:

| arm | baseline | post-fix rep0 | gains | losses | any-rep (2 reps) |
|---|---|---|---|---|---|
| native | 10/17 | 9/17 | 0 | 1 | **10/17** |
| sweet | 7/17 | 6/17 | 0 | 1 | 6/17 |

Effect size: −1 task per arm at rep0, 0 for native on the any-rep view. McNemar on 0-vs-1
discordant pairs is p=1.000 in both arms — reported only to show the comparison carries
no power, not as evidence of no effect.

Both flips are on tasks with a documented 1-of-2 history:

- **`pytask-dev__pytask-210` (native)** — pre-fix 1/2 (rep0 solved, rep1 not), post-fix
  1/2 (rep0 not, rep1 solved). Identical rate, reps swapped. A coin flip, and the any-rep
  view is unchanged at 10/17.
- **`rstudio-education__gradethis-161` (sweet)** — pre-fix 1/2, baseline rep0 solved,
  post-fix 0/2. This is the one genuinely downward observation. It is also one of the
  three tasks whose false-reds were removed, so the obvious worry is that a now-truthful
  PASS made the agent stop early. **The data does not support that:** call counts went
  *up*, not down (pre-fix 10 and 12, post-fix 15 and 18), and the patch got larger
  (9 → 10 hunks). It kept working and still missed — consistent with the
  generation-variance-on-a-complex-change reading already recorded in
  `TURNFIX-PHASE0-REPLAY-RESULTS` §24.3, not with early stopping.

Arm totals over all 34 task×rep: native 19/34 (56%), sweet 12/34 (35%), avg calls 7.5 vs
9.2, realized $0.290 vs $0.260. The native-versus-sweet gap is unchanged by the repair,
which is expected — the shim is byte-identical in both arms.

## 3. The checkpoint no-go holds on clean footers

Re-running the exposure census on the corrected verdicts: **0 triggers in 54 cleanly
joined rollouts** (68 total). The one-sided 95% upper bound is 5.4%, wider than the 2.5%
from the larger pre-fix corpus simply because this run is smaller. The circularity caveat
from `RUN-TESTS-VERDICT-DEFECT.md` §3 is now retired: the footers the census reads are no
longer the ones the defect corrupted, and the previously-blind rollouts (yarp, underscore)
are measurable.

## 4. The poll lever stayed orthogonal

| run | native poll rate | sweet poll rate |
|---|---|---|
| baseline | 12.8% | 9.2% |
| post-fix | 10.4% | 7.4% |

Flat-to-slightly-lower, as expected: the repair changes what the verdict *says*, not how
`run_tests` is launched. `SS_RT_LONGYIELD` was default-on in both runs, so the comparison
is matched and the shipped lever needs no revisit.

## 5. Failure taxonomy — both arms, before and after

Every unresolved rollout, one class each (first match wins), plus an orthogonal
generation-variance flag.

| class | native pre | native post | sweet pre | sweet post |
|---|---|---|---|---|
| wrong-fix (right file, fix does not work) | 13 (76%) | 10 (67%) | 15 (71%) | 14 (64%) |
| incompleteness (0 < f2pFrac < 1) | 2 (12%) | 2 (13%) | 3 (14%) | 4 (18%) |
| wrong-location | 2 (12%) | 2 (13%) | 3 (14%) | 3 (14%) |
| no-edit stall | 0 | 1 (7%) | 0 | 1 (5%) |
| **over-edit past green** | **0** | **0** | **0** | **0** |
| losses total | 17 | 15 | 21 | 22 |

Three things this settles:

1. **wrong-fix is universal, not sweet-specific.** The distributions are
   indistinguishable between arms, before and after. Any lever aimed at this class raises
   a **shared floor**; it does not close the native-versus-sweet gap. The 4-to-7 rollout
   solve difference is the same failure mode at a slightly higher rate, not a different
   mode — so the gap is not something a retrieval-side change is positioned to fix.
2. **over-edit-past-green is 0 in all four cells.** A third independent derivation of the
   checkpoint no-go, from failure classification rather than state-sequence census.
3. **Losses ending on a PASS verdict went UP, not down:** native 59% → 73%, sweet 67% →
   82%. That is the repair working, not regressing. Before, some of those PASSes were
   accompanied by a contradictory `status=FAIL`; now the agent is told the truth about the
   suite it can run — and still loses. The noise is gone and what remains is the real limit.

## 6. The bound this puts on any retrieval change — disclose this

The dominant failure is **"satisfies the visible tests, misses the hidden assertion."**
Roughly two thirds of losses are wrong-fix, and ~80% of losses end with `run_tests`
truthfully reporting PASS on the suite the agent is able to run. The agent cannot see the
acceptance criterion: on 10 of 18 tasks the FAIL_TO_PASS test is created by `test_patch`,
and on others (underscore's `groupBy`/`countBy`) the test name pre-exists but the
discriminating assertion does not.

This is a property of hidden-test evaluation, and it **upper-bounds what any retrieval
change can achieve on this benchmark**. Better retrieval can put the right code in front
of the model; it cannot reveal an assertion that does not exist in the repository. Any
future claim about a retrieval lever's effect on resolution must be stated against this
ceiling, and the taxonomy must not be read as either a retrieval indictment or a retrieval
opportunity.

The observability column in the taxonomy tooling is deliberately labelled an **upper
bound**: it tests only whether the F2P test *name* pre-exists at the base commit, which is
necessary but not sufficient for the agent to observe the target behaviour.

## 7. Queued — NOT built, needs a $0 gate and explicit approval

**Issue-derived acceptance.** The agent enumerates the required behaviours — or writes its
own test — from the **visible issue text only**, then verifies each before submitting.

- It targets the wrong-fix mass directly, which is the only class large enough to matter.
- **Hard boundary: derived from the issue, never from `test_patch`.** That is the cheating
  line, and any implementation must make it structurally impossible to cross, not merely
  discouraged.
- It raises generation and test cost, so it gets the same handling as the 2-candidate
  lever: a $0 gate first, then explicit approval before any paid cell.

## 8. Ledger status — three ledgers are dead by design

The repair edits `rt-condense-lib.mjs` and `rt-shim-runtime.mjs`, both hashed into
`RT_HARNESS_FINGERPRINT`, which `taskConfigHash` includes. **All 18 task config hashes
changed.** These are superseded and must not be used to validate any future run:

```
/root/.ss-eval/ledger-sweep-all18    (pre-fix, rotate18)
/root/.ss-eval/ledger-sweep-smoke3   (pre-fix)
/root/.ss-eval/ledger-sweep-rot3     (pre-fix)
```

Current ledger: `/root/.ss-eval/ledger-postfix-20260807/ledger.jsonl` — 18/18 gold-valid,
including `akinsho__nvim-bufferline.lua-173` under its new exit-code-propagating
`testCmd`, which is why that override needed no revert.

`litestar-org__polyfactory-405` is excluded from **agent runs only** and remains
gold-valid and gradeable; its `test_cmd` names a file `test_patch` creates, so the agent's
suite returns the same error for every possible patch.

The real headline re-baseline on the paper corpus is a separate milestone decision and was
not taken here.
