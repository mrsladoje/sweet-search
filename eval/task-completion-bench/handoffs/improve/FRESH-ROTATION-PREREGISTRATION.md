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
