# Read-gutter delimiter — cross-harness A/B

**Executes:** [`GUTTER-AB-PREREGISTRATION.md`](./GUTTER-AB-PREREGISTRATION.md), committed
before the claude-code and opencode arms ran.
**108 rollouts** (54 new + 54 reused as the TAB baseline), `$0.94`, `CONCURRENCY=1`,
ledger `luna-rotate20-v4`. Artifacts: [`gutter-20260825/`](./gutter-20260825/).

---

## 0. Verdict

**`116ca2b` was a trade that was only ever priced on one side. The tab delimiter costs codex
and opencode three rollouts each, and it earns its keep only on claude-code — where it really
does still suppress edit-anchor failures by about five times.**

**Resolution**, six tasks × 3 reps, sweet arm (native never calls `ss-read`):

| harness | TAB (shipped) | PIPE | NONE | native |
|---|---:|---:|---:|---:|
| codex | 10/18 | **13/18** | **13/18** | 14/18 |
| opencode | 11/18 | **14/18** | 11/18 | 13/18 |
| claude-code | 11/18 | **12/18** | 10/18 | 11/18 |
| **total** | **32/54** | **39/54** | 34/54 | 38/54 |

**Controls are 6/6 in every one of the twelve cells.** Nothing is being traded away, and cost
is flat throughout (within ±3% per rollout).

**Edit-anchor failures** — the outcome the tab was adopted for, and the reason this is not a
simple revert:

| harness | TAB | PIPE | NONE |
|---|---|---|---|
| codex | 0/0 edits | 0/0 | 0/0 |
| opencode | 3/32 | 2/33 | 3/29 |
| **claude-code** | **1/63 (1.6%)** | **8/105 (7.6%)** | **8/71 (11.3%)** |

## 1. Reading it

**Codex never produces an anchor failure at all** — it edits through `apply_patch` context
hunks, so the delimiter cannot leak into an `old_string`. The tab buys it nothing and costs
it three rollouts.

**Opencode's anchor rate is flat across all three settings** (3/32, 2/33, 3/29). The mechanism
the tab was adopted for is not operating there either, and PIPE still gains three rollouts —
enough to put opencode sweet **above** native, 14/18 against 13/18.

**Claude-code is the only harness where the tab earns anything, and it does.** PIPE takes
anchor failures from **1.6% to 7.6%** of edits, NONE to 11.3%. The original 2026-08-13
measurement stands. PIPE's +1 rollout there is well inside noise at n=18 and, per the
pre-registration, **resolution alone must not overturn the anchor result**.

**So it is not "the gutter is bad" — it is "the tab delimiter is bad for two of three
harnesses".** `NONE` recovers codex but does nothing for opencode (11/18, identical to TAB),
which is what separates the delimiter from the gutter itself.

## 2. Decision, by the pre-registered rule

The rule was: *harnesses genuinely disagree → ship per-harness, defaulting each to its own
best.* They do disagree, on both outcomes, in opposite directions.

| harness | default | why |
|---|---|---|
| codex | **`N\| `** | +3 rollouts, zero anchor cost (no string anchors exist) |
| opencode | **`N\| `** | +3 rollouts, anchor rate unchanged, beats native |
| claude-code | **`N<TAB>`** (keep) | anchor failures 1.6% vs 7.6%; the fix still works there |

**Nothing ships on this run.** The pre-registration also fixed: *"No change ships on n=18 per
cell alone. Whatever wins here gets a confirmation run on the full 13-task set for the
harnesses it changes."* That is codex and opencode, 13 tasks × 3 reps × 2 harnesses = 78
rollouts, ≈ `$0.6`.

## 3. The process lesson, which is the durable part

`116ca2b` was correct on the evidence it had and was generalised to harnesses that were never
measured. It has cost roughly three rollouts per harness on two of three for twelve days.

**The rule that follows: a change to shared render output must be measured on every harness it
reaches before it becomes the default.** The render is not harness-neutral — codex reads it
into `apply_patch` hunks, claude-code reads it into exact-match `old_string` anchors, and
those two consume whitespace in opposite ways.

## 4. One number in the artifacts that must not be quoted

The report prints claude-code `native(ref)` at `$0.006450`/rollout against sweet's `$0.011080`.
**That comparison is invalid.** `rb-claudecode-20260824` carries `null` cost on 20 of 39 native
rollouts (subagent instrumentation gaps), so native is undercharged on exactly the rollouts
that cost most. The corrected figure for that run is sweet **−34.3%**, established separately
by transcript reconstruction. The `native(ref)` column here exists to show resolution, not cost.
