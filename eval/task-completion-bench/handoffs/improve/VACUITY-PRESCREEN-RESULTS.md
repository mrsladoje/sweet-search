# Vacuous-task pre-screen — a free detector, and what it finds in the corpora

**Executes:** [`SLATE-A-RESIDUE-RESULTS.md`](./SLATE-A-RESIDUE-RESULTS.md) §7.6, which
established that 2 of 5 control tasks resolve with an empty patch and closed with
*"any future control set has to be built from tasks that a null arm FAILS, and that check is
free."* This is that check, made cheaper still — **no container, no repository, no run.**
**Date:** 2026-08-21 — **spend `$0`.** Static scan of task records only.
**Instrument:** [`vacuity-prescreen.mjs`](./phase1-scripts/vacuity-prescreen.mjs).

---

## 0. Verdict

**A one-line signal recovers both known vacuous tasks with zero false alarms, and it finds
the defect is systematic rather than incidental: it tracks the test RUNNER, not the project.
9 of 200 DEV-RET tasks, 8 of 101 heldout-reserve tasks, and 1 of the 200 tasks inside frozen
HO2 carry it.**

## 1. The signal

A `FAIL_TO_PASS` entry is supposed to name a test that **fails** on the base tree. When the
harvesting run was green, the runner's own success marker is captured verbatim into the task
record and ships with the benchmark:

```
redboltz__mqtt_cpp-466   "10/25 Test #10: pubsub ...........  Passed    0.68 sec"
statamic__cms-9029       "it runs without hooks (3 ms)"
```

The detector flags any `FAIL_TO_PASS` entry containing `Passed`, `PASS`, a TAP `ok N`, a
check mark, or a `(N ms)` timing suffix — all of which a runner emits **on success**.

## 2. Calibration against an independent ground truth

The 17-task rotation is the one pool where vacuity was established separately, by a
deliberate null arm (`AGENT_TIMEOUT_MS=1000`, empty patch, 14 usable rollouts).

| | |
|---|---|
| known vacuous, by null arm | `redboltz__mqtt_cpp-466`, `statamic__cms-9029` |
| flagged by this detector | **exactly those two** |
| false alarms | **0 of 16** |

The first version of this screen used a different signal — whether `test_patch` touches the
file a `FAIL_TO_PASS` test lives in — and it **failed**: 1 of 2 recovered, 5 false alarms,
and 8 of 18 tasks unparseable because `FAIL_TO_PASS` formats differ per language. It is
recorded here so it is not reinvented. The runner-marker signal works precisely because it
does not need to parse the format at all.

## 3. What the corpora contain

| pool | flagged | rate |
|---|---:|---:|
| rotation (calibration) | 2 / 18 | 11.1% |
| multilingual | 2 / 200 | 1.0% |
| heldout → DEV-RET | **9 / 200** | 4.5% |
| heldout reserve | **8 / 101** | 7.9% |
| heldout2 reserve | 0 / 67 | 0.0% |
| **HO2 (frozen)** | **1 / 200** | 0.5% |

**HO2 was scanned for a count only.** No instance id, no test string, nothing per-task —
because a vacuous task in a held-out set silently inflates *both* arms and that is a validity
fact worth having, while the identities are not ours to look at under the held-out
discipline. **One task in the frozen held-out set grades as solved for a rollout that did
nothing.** It should be identified and removed by whoever next unfreezes HO2, and the
denominator restated.

**The defect tracks the test runner, not the project.** Every C/C++ hit is a `ctest` project
— `mqtt_cpp`, `ccache` (three separate instances), `simdjson`, `nvidia/cccl` (two), `stir`,
`transmission`, `nng`, `kiota` — and every remaining hit is a jest/PHPUnit-style project:
`statamic/cms` (two), `valkey`, `phpactor`. This is one harvesting bug in the task-generation
pipeline reproducing across every task it touched, not bad luck spread thin.

`microsoft__kiota-3760` appearing here is an independent corroboration of the earlier
forensics finding that its baseline was forged.

## 4. Limits, stated rather than buried

- **Two positives is a small calibration set.** Perfect recovery on `n=18` with 2 positives
  is encouraging, not decisive.
- **It sees one cause of vacuity.** A task whose `FAIL_TO_PASS` already passes for some other
  reason will not be flagged, and this data cannot bound how often that happens. False
  negatives are unmeasured.
- Therefore: **the null arm remains the authority.** This detector is for *ordering* a null-arm
  sweep cheaply, and for vetoing a candidate control outright before any container starts.

## 5. What to do with it

1. **Add it to task admission.** It costs nothing and it would have blocked both tasks that
   made the control set 40% vacuous.
2. **Replacement controls for `mqtt_cpp-466` and `cms-9029`** must pass three tests, in this
   order: not flagged here → a null arm grades it unresolved → it is solved by both arms at
   or near ceiling. The first two are free. Candidates should be drawn from DEV-RET **after**
   removing its 9 flagged tasks.
3. **No replacement exists inside the current rotation.** Of the 13 admissible tasks, the only
   two that are both near-ceiling and demonstrably able to fail are
   `akinsho__nvim-bufferline.lua-173` (11 of 12 recorded rollouts resolved) and
   `rstudio-education__gradethis-161` (10 of 12) — and both are already treatment tasks. The
   remaining three current controls (`robot-710`, `scoringutils-229`, `parcels-617`) are
   12/12 and were cleared by the null-arm sweep, so they stay.
4. **Re-check any published denominator that included a flagged task**, including the frozen
   held-out one.
