# Replacement control tasks — two adopted, and the pre-screen's first measured false negative

**Executes:** [`CONTROL-REPLACEMENT-PREREGISTRATION.md`](./CONTROL-REPLACEMENT-PREREGISTRATION.md)
and its **Amendments 1 and 2**, both committed before this document.
**Date:** 2026-08-24. **Model spend: `$0.005`** — null arms make zero or near-zero tool calls.
**Artifacts:** [`controls-20260824/evidence.txt`](./controls-20260824/evidence.txt) — the v4
ledger lines and both null-arm summaries.

---

## 0. Verdict

**Adopted: `zmap__zlint-299` (go) and `sindresorhus__dot-prop-105` (js). The control set goes
from 3 to 5, across five distinct toolchains.** And the null arm caught something the free
filters did not.

## 1. Every candidate that reached the null arm, including the failures

§6 of the pre-registration requires this. Eight candidates were drawn from DEV-RET after
removing its flagged tasks; all eight were gold-`FULL` under fingerprint **v4**.

| candidate | lang | free filters | null arm | eligible |
|---|---|---|---|---|
| `zmap__zlint-299` | go | pass | **UNRESOLVED** | **yes — ADOPTED** |
| `sindresorhus__dot-prop-105` | js | pass | **UNRESOLVED** | **yes — ADOPTED** |
| `final-form__final-form-64` | ts | pass | UNRESOLVED | yes, not adopted |
| `unexpectedjs__unexpected-571` | js | pass | UNRESOLVED | yes, **61.5 calls** (Amendment 2) |
| `devlooped__moq-1262` | csharp | pass | UNRESOLVED | yes, **74.5 calls** (Amendment 2) |
| `keichi__binary-parser-202` | ts | pass | **UNGRADEABLE** | no |
| `google__go-github-2971` | go | **REJECTED** `F2P=1274` | UNRESOLVED | no (Amendment 1) |
| `jsonmapper__jsonmapper-161` | php | **REJECTED** `F2P=182` | **RESOLVED** | no — **and vacuous** |

`keichi__binary-parser-202` produced **no test evidence at all**; the grader's own tripwire
marked the row ungradeable rather than scoring it zero. That is an image defect, not a
behavioural result, and a task that cannot be graded cannot be a control.

## 2. The finding: the pre-screen has a measured false negative, and the null arm found it

`jsonmapper__jsonmapper-161` **resolved with an empty patch** and the vacuity pre-screen had
returned **no markers** for it. Its 182 `FAIL_TO_PASS` entries look like this:

```
"Property Builder > Can build property with all properties set [0.54 ms]"
"Property Mapper Builder > It can build with scalar caster [0.25 ms]"
```

That is the same signal the screen already recognises — a test runner's timing suffix, emitted
on success — in **square** brackets. The detector matched only `(N ms)`. jest and mocha print
round; PHPUnit and pest print square.

**This is the exact limit the pre-screen documents and could not previously measure**:

> *"It sees one cause of vacuity… False negatives are unmeasured. Therefore: the null arm
> remains the authority."*

It is now measured, once, and the authority is what measured it. Two things follow:

- **The marker is widened** to `[([]\d+(\.\d+)?\s*m?s[)\]]`. **Calibration is unchanged**: the
  17-task rotation still flags exactly `redboltz__mqtt_cpp-466` and `statamic__cms-9029` and
  nothing else — 2 of 18, no new false alarms on the set with independent ground truth.
- **The corpus counts move, and one of them matters a great deal:**

| pool | before | after |
|---|---:|---:|
| rotation (calibration) | 2 / 18 | **2 / 18** — unchanged |
| multilingual | 2 / 200 | 7 / 200 |
| heldout → DEV-RET | 9 / 200 | 12 / 200 |
| heldout reserve | 8 / 101 | 10 / 101 |
| heldout2 reserve | 0 / 67 | 2 / 67 |
| **HO2 (frozen)** | **1 / 200** | **7 / 200** |

**HO2 now flags 7, not 1.** One of those (`ucl__stir-1442`) is null-arm-confirmed and removed;
**six are unexamined**. Scanned for a count only, as before — no ids read. That is raised as
its own decision, not acted on here: the freeze was broken once, deliberately, for one task,
and extending that six-fold is not a call this document makes.

## 3. Why these two

All five eligible candidates cleared the null arm. The pre-registered tie-break prefers a
language not already in the control set (`java`, `r`, `python`); all five qualify. Amendment 2
then removes the two that cost 5–8× the existing controls in tool calls, and among the
remaining three the two cheapest are taken:

| adopted | lang | mean calls | gold under v4 | null arm |
|---|---|---:|---|---|
| `sindresorhus__dot-prop-105` | js | **9.0** | `FULL`, `f2pPass 1/1` | UNRESOLVED |
| `zmap__zlint-299` | go | **10.0** | `FULL`, `f2pPass 2/2` | UNRESOLVED |

Both sit inside the existing controls' cost band (8.5–14.0 calls), so the control set does not
get more expensive per screen. The set now covers **java, r, python, go, js**.

## 4. Ceiling evidence is thin, and that is stated rather than smoothed

Criterion 3 was *"solved at or near ceiling by both arms"*. The recorded evidence is
**one rollout per arm** for every candidate — 1/1 native and 1/1 sweet. That is the ceiling
condition met at `n=1`, not a demonstrated ceiling.

The two adopted tasks should be watched over their first two screens, and if either fails a
rep in a condition where nothing else moves, it is the control that is wrong, not the
treatment. The pre-registration's own rule applies: a control set of four is better than a
control set of five containing one that drifts.

## 5. The free filters earned their place

Of 60 DEV-RET tasks solved in **every** recorded rollout of **both** arms, the free filters
rejected 15 before a single container started:

- **11 name-locked** — `dart-lang__http-1114`, `eslint__eslint-9905`, `auth0__auth0-python-443`,
  `pypa__pip-11466` and seven more;
- **4 vacuous or excluded** — `statamic__cms-7509`, `statamic__cms-9029`,
  `redboltz__mqtt_cpp-466`, `ucl__stir-1410`, `litestar-org__polyfactory-405`.

That is the trap this whole exercise exists for, quantified: **"always solves in both arms" is
25% a filter for tasks that cannot discriminate.** The previous control set was built without
these filters and came out 40% vacuous.
