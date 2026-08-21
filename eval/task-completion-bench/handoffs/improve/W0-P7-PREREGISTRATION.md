# W0 gate — P7 local repair forge: PRE-REGISTRATION

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §9 W0, row "P7 forge", and §4 P7
falsifiers 1–5.
**Written before any figure was computed.** Nothing in this file was chosen after seeing a
result. The analysis script is committed together with it and frozen at that commit.
**Model spend: `$0`.** No rollout. Existing artifacts only. Remote `results/` is read-only.
HO2 untouched.

---

## 0. Why this gate is worth running at all

P7 is the only program in the slate that carries a 15%-or-better **cost** thesis, and cost
is the axis on which sweet already leads. Every other surviving program needs a narrow
analyzer. This gate is free and it can kill P7 outright.

The gate's kill condition, quoted from the slate: *"<30% dollar addressability at a 50%
local-saving assumption"*. The arithmetic behind that number: if a local forge halves the
paid spend that sits behind a sufficiently-specified checkpoint, then a share `A` of
addressable dollars moves the total by `0.5 × A`. To clear the slate's own 15% materiality
bar, `A ≥ 30%`.

---

## 1. The checkpoint, defined exactly

**The checkpoint is the API turn that contains the rollout's first file-mutating tool call.**

Rationale: the forge's premise is that once the paid model has localized the problem and
committed to a first edit, the remaining repair loop can be run locally. Everything up to
and including that first edit is work the paid model must still do.

**The first-edit turn is charged to BEFORE the checkpoint, not after.** The forge cannot
avoid paying for the turn in which the model states its edit. This is deliberately
conservative against P7: it makes the addressable share smaller.

Tool calls that count as file-mutating, per harness:

| harness | mutating calls |
|---|---|
| codex | `apply_patch` / `shell` invocations whose command writes (`apply_patch`, `>`, `>>`, `sed -i`, `tee`, `python - <<`) |
| opencode | `edit`, `write`, `patch`, plus `bash` commands matching the same write shapes |
| claude-code | `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, plus `Bash` matching the same write shapes |

A rollout with no mutating call has **no checkpoint** and contributes **zero addressable
dollars** while remaining in the denominator.

---

## 2. "Sufficiently specified", defined exactly

Two nested criteria. Both are computed from the trace **before the checkpoint turn ends**.

**L — localized.** Every file path in the final `model_patch` appears in the trace before the
checkpoint, either in a tool-call input or anywhere in a tool result. Search hits count. This
is deliberately generous: it is the weakest reading of "the forge knows where to work".

**D — discriminable.** L holds **and** the visible canonical test suite, run on the base tree,
distinguishes the accepted patch from the recorded wrong patches for that task. This is the
condition a forge actually needs to *reject* candidates locally. It is computed by asking
whether any recorded losing patch for the same task passed the visible suite; if a wrong
patch passed visibly, the task is **not** discriminable and the forge cannot select locally.

`L` bounds the forge's cost claim. `D` bounds its resolution claim. **The gate's 30% bar is
pre-registered against `L`**, because P7 is a cost program: a forge may legitimately save
money while resolving no more tasks. `D` is reported alongside and is not part of the bar.

---

## 3. The primary estimate

- **Population:** all rollouts in `sb-codex-20260811`, `sb-opencode-20260811`,
  `sb-claudecode-20260811`, **excluding the 12 `dotnet__yarp-2825` rollouts**, which are
  ungradeable (D1, closed by removal). `204 − 12 = 192`.
- **Arm:** **sweet only** for the headline. P7 is a sweet-side product change; native spend is
  not sweet's to save. The native figure is reported as context, never as the bar.
- **Cost column:** **realized, cache-discounted** (`realFromTurnsUsd`, recomputed at turn
  granularity from `turns/<task>-<arm>.jsonl` and its recorded `meta.price`). This is the money
  actually spent, and it is the conservative choice: cache-discounted later turns are cheaper,
  so it yields a *smaller* addressable share than break-priced accounting would.
  **Break-priced is reported as a sensitivity, not as the bar.**
- **Consistency check:** the turn-level sum must reproduce each row's `realFromTurnsUsd` to
  within `$0.000005`. Any rollout that fails this check is reported and excluded from the
  headline rather than silently repaired.

**Addressability**

```
A  =  (post-checkpoint sweet dollars on rollouts where L holds)
      ---------------------------------------------------------
                 (total sweet dollars, all 96 rollouts)
```

## 4. Pre-registered decision rule

| outcome | verdict |
|---|---|
| `A ≥ 30%` on every harness | P7 survives W0; proceed to design, still subject to a separate GO |
| `A ≥ 30%` on some harnesses only | P7 survives **narrowly**, scoped to those harnesses; state which |
| `A < 30%` on every harness | **P7 is dead at `$0`.** Do not build the forge. |

No re-definition after seeing the number. If the definition turns out to be wrong, that is
recorded as a defect of this pre-registration and the gate is re-run under a new, separately
committed pre-registration — never by editing this one.

---

## 5. The four secondary falsifiers, with their own bars

**F3 — Dart impact edges.** Run sweet's `ss-trace BaseResponse impact` against the
`dart-lang__http-1114` golden checkout. **Bar:** it must enumerate the implementor set that
the recorded nine-file self-revert touched. If it does not, the pre-API impact heuristic is
not retained and cross-file trace edges (D5) must be repaired first.

**F4 — edit-fumble recoverable turns.** Count Claude sweet turns lost to a failed edit
(errored edit tool result followed by a retry of the same edit). **Bar from the slate:**
fewer than 20 recoverable turns means `ss-edit` is hygiene, not a cost claim.

**F5 — degeneration separation.** No degeneration flag was ever recorded (D3 is undeployed),
so it is detected here: a rollout is flagged if any single tool-call input exceeds 50,000
bytes or any assistant block contains role-tag repetition. Flagged rollouts are reported
separately and the headline `A` is recomputed with them excluded. **Neither number is the
bar**; the requirement is only that they are not blended.

**F1b — the 30%-threshold sanity check.** Report `0.5 × A` against the 15% materiality bar
directly, so the arithmetic is visible rather than asserted.

---

## 6. What this gate cannot decide

It cannot tell us the forge would *work*. It measures only how many dollars are standing in
the place the forge proposes to stand. A pass here is permission to design, not evidence of
saving. A local forge also spends local compute, which this gate does not price at all.
