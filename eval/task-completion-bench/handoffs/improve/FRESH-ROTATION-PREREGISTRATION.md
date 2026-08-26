# Fresh-rotation confirmation — PRE-REGISTRATION

**Written before the run. Authorised to execute without further confirmation.**

## 0. What this exists to falsify

The six-task gutter A/B found `PIPE` beating the shipped `TAB` by +3 rollouts on codex and
+3 on opencode. **Those six tasks were selected because codex lost four of them.** On a set
chosen for sweet's failures, recovery looks like superiority. This run asks the same question
on tasks nobody picked.

It also gives the first genuinely unselected sweet-vs-native comparison in this programme.

## 1. Pool

25 tasks drawn from the 200-task dev set, screened at `$0` before any rollout:
gold-FULL in the ledger · **not vacuity-flagged** · **not name-locked** · issue text > 200
chars · **not used in any previous rotation run** · at most 2 per language (14 languages).
Selection is alphabetical within language — deterministic, no RNG, reproducible.

**Gold is re-swept under the current v4 config first.** Every task in the July ledger is
stale (`configHash mismatch`). **Any task whose gold does not grade FULL is dropped before a
single rollout**, not carried in as a mystery failure.

## 2. Design

- Conditions: **sweet-TAB** (shipped), **sweet-PIPE**, **native**.
- 3 reps. `CONCURRENCY=2`.
- Harnesses: **opencode first, then codex — gated (§4).**
- Per harness: 25 × 3 × 3 = **225 rollouts**, ≈ `$1.5` opencode, ≈ `$2.1` codex.

**Concurrency-2 guard.** Silent rollout loss at 2 has been observed twice (3 of 156 in the
clause screen; 4 of 8 in a parallel session). After each cell, every `(task, arm, rep)` is
checked for existence and **missing cells are re-run**. A cell that fails twice is reported,
never silently dropped.

## 3. Pre-registered bars

**Primary — does the delimiter effect replicate?**
`PIPE − TAB ≥ +6 solved rollouts of 75`, with **no control regression**. The six-task run
showed +3/18 (17pp); +6/75 is 8pp, i.e. half the observed effect. Below that, **it did not
replicate and the six-task result is reported as selection.**

**Secondary — is sweet ahead of native?**
Reported for both TAB and PIPE. **A superiority claim requires ≥ +6 rollouts of 75.** Anything
smaller is reported as parity, in either direction. A paired sign test over the 25 tasks is
reported alongside, but the rollout margin is the bar.

**Cost** is reported per rollout, sidechain-inclusive. No cost-per-solved figure is computed
unless the solve counts differ by the margin above — the flipping denominator is what
invalidated every previous cost-per-solved number.

## 4. The codex gate, decided mechanically

Codex runs **only if opencode's `PIPE − TAB ≥ +2` solved rollouts.** Below that the delimiter
did not replicate on fresh tasks and spending another `$2.1` to confirm a null is waste. The
outcome either way is written up.

## 5. What would void the run

- Fewer than 18 of 25 tasks survive the gold sweep → report the yield and re-screen rather
  than run a thin pool.
- More than 8 of 225 rollouts lost per harness after the re-run pass.
- Any harness or engine change landing mid-run.

---

## AMENDMENT 1 — 2026-08-26, after the pre-registered VOID and before any rollout

**The first attempt voided itself as designed**: 17 of 25 tasks survived the gold sweep
against a floor of 18. No rollout was spent. Three things changed before relaunching, all
recorded before data exists.

### A. The pool was screened wrong, and it is now screened properly

**7 of the 25 tranche-1 tasks fail run-pilot's own selection gate** (`FAIL_TO_PASS < 100`,
`PASS_TO_PASS >= 1`) — they are whole-suite-red build repairs, not bug fixes. My screen
omitted that gate. Adding it leaves **13 clean tasks from tranche 1**, and a second tranche
of 13 gate-passing candidates is being swept to reach a **~20-task pool**.

The full screen is now: gold-FULL under v4 · selection gate · not vacuity-flagged · not
name-locked · issue > 200 chars · unused in any prior rotation · ≤2 per language.

### B. Every ss-* code surface is now numbered, so `TAB` here is NOT the old `TAB`

`ss-search`, `ss-find` and `ss-semantic` were writing code **raw** while `ss-read` numbered
(`_ss-helpers.mjs`). That is **27–36% of delivered code lines unnumbered, with 5–10% of edits
anchoring on them** — the agent was being handed two formats for one job. All three now go
through the shared `numberCodeLines`.

**Consequence, stated plainly: this run's `TAB` arm is not comparable to any earlier `TAB`
number.** It is a new baseline, not a continuation. Nothing from the six-task run may be
pooled with it.

### C. Three forms, not two

`TAB` (shipped), `NONE` (cheapest; no gutter anywhere), `PIPE` (`N| `, the form that produced
the +3 that started this). `PIPE` is included **because that +3 was never significance-tested
and is Fisher p ≈ 0.49 at n=18** — it is here to be killed or confirmed at n≈60 per condition,
not because anyone expects it to win.

Native runs once per harness; it never calls `ss-*`, so no form can touch it.

### D. Revised scale and the corrected earlier claim

3 harnesses × (3 sweet forms + native) × ~20 tasks × 3 reps ≈ **720 rollouts, ≈ `$7`,
~18 hours** at concurrency 2, staged one harness at a time so results are readable as they
land and a failure does not consume the budget.

**A correction that invalidates part of the earlier analysis:** the cross-harness census
never counted codex edits at all — its codex branch has no edit detection
(`gutter-cross-report.mjs:40` is opencode, `:49` is claude-code). The reported "codex 0/0
edits, `apply_patch` has no string anchor" was **the instrument not looking**, and the
per-harness delimiter recommendation built on it is withdrawn. Codex does fail edits, at a
rate comparable to the other harnesses. The census counter is replaced before this run is read.

### E. Bars unchanged

`PIPE − TAB` and `NONE − TAB` each need **≥ +6 solved rollouts of ~60** with no control
regression. Sweet-vs-native superiority needs the same margin. Cost is reported per rollout,
sidechain-inclusive, and **is a primary outcome here** — the stated objective is highest
resolution at lowest cost, and the gutter is a resident-context cost that is re-sent every turn.
