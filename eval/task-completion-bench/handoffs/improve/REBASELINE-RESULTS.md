# Post-repair re-baseline — sweet vs native, 2026-08-25

**Executes:** [`REBASELINE-PREREGISTRATION.md`](./REBASELINE-PREREGISTRATION.md), committed
before launch.
**156 rollouts, 0 lost** (void threshold was >8). 13 admissible tasks × 2 arms × 3 reps ×
2 harnesses, `CONCURRENCY=1`, ledger `luna-rotate20-v4` preflighted green 13/13 on both
harnesses. Post-gutter-fix, post-D2, sidechain-inclusive.
**Artifacts:** [`rebaseline-20260825/`](./rebaseline-20260825/).

---

## 0. Verdict

**The pre-committed null is the result. Resolution is indistinguishable on both harnesses.
Sweet is cheaper on both, and on claude-code it is much cheaper than anyone thought —
but only after repairing a cost ledger that was null on 51% of native's rollouts.**

| harness | rollouts solved, sweet v native | delta | tasks majority | `$`/rollout | sweet vs native |
|---|---|---:|---|---:|---:|
| opencode | 17/39 v 19/39 | −2 | 6/13 v 6/13 | `$0.008465` v `$0.008705` | **−2.8%** |
| claude-code | 16/39 v 18/39 | −2 | 5/13 v 6/13 | `$0.012896` v `$0.019620` | **−34.3%** |

**Both deltas are −2 against a pre-registered bar of 6.** Paired sign test over the 13 tasks:
opencode 2 sweet-better v 2 native-better, **p ≈ 1.000**; claude-code 2 v 4, **p ≈ 0.688**.

**Cost per solved task is NOT reported, by pre-registration.** The solve counts do not clear
the bar, and the flipping denominator is exactly what invalidated the previous figures.

## 1. The claude-code cost ledger was broken, and it lies in the loud direction

**20 of 39 claude-code native rollouts carry `null` in every cost column.** Sweet carries
none. The null rows are native's expensive ones — 32 to 101 tool calls each, 12 of them
resolved. Opencode is clean in both arms.

Summing the ledger as published gives **sweet +124.2%**; adding sidechains to that gives
**+33.8%**. Both are artefacts. The true figure is **−34.3%**.

**How it was repaired.** Every rollout was re-priced from its own transcript with
`turnsFromTranscriptFile`, the method validated against the harness's own module on 64/64 in
the P7 census. The self-check is strong: on the **sweet** arm, which has no null rows, the
reconstruction returns **`$0.502954`** against the ledger's **`$0.502952`** — agreement to six
decimals. Where the ledger works, this method reproduces it exactly; where it is null, it is
the only source.

One `pytask-native` cell retained 4 transcripts for 3 reps (a retry). The headline keeps the
3 most expensive per cell, which is conservative **against** sweet; including all four moves
native to `$0.019876` and the gap to −35.1%.

**This is a measurement defect that must be fixed before any further claude-code costing.**
It is silent, it is arm-correlated, and it inverts the sign of the headline.

## 2. Why claude-code sweet is so much cheaper

Native delegates and sweet does not. Native used subagents in **10 of 39** rollouts across 21
sidechain files costing **`$0.151535`**; sweet used **zero**. Native also runs **40.1 tool
calls per rollout** against sweet's **17.9**.

That is a real product difference — sweet's retrieval removes the need to spawn a subagent to
go and look — but note it is a *claude-code* effect. Opencode has no comparable mechanism and
shows only −2.8%.

## 3. Where the resolution actually sits

Six tasks are dead in both arms on both harnesses: `apple`, `codeception`, `dart`,
`dashbitco`, `bingo` — and `pytask` is 2/6 across everything. Four are solved by both arms
every time: `robot`, `scoringutils`, `parcels`, `akinsho`. **The entire measurable difference
between the arms lives in three tasks** — `underscore`, `gradethis`, `teleport` — and they
disagree between harnesses. `underscore` is native 3/3 v sweet 1/3 on opencode; `gradethis`
is sweet-better on both; `teleport` is sweet-better on opencode and native-better on claude.

**That is what a null looks like at this sample size, and it is why the bar was set at 6.**

## 4. What this retires

- **The `−15.3%` and `−16.1%` cost-per-solved figures are formally retired.** They came from
  the 2026-08-11 run, they did not replicate on 2026-08-21, and this run declines to compute
  the quantity at all because its denominator is not measurable.
- **"Sweet resolves more than native" is not supported on any harness.** Nor is the reverse.
- **"Sweet is cheaper per rollout" survives**, at −2.8% and −34.3%.

## 5. Not covered, and why

**Codex was excluded deliberately.** Its subscription refresh token was spent on 2026-08-06,
so D2 is unproven there and any codex evidence would carry the yield-before-completion defect
this run exists to clear. It needs an interactive `codex login`, then a separate run reported
separately. The last codex figure we have (sweet 15/26 v native 14/26, −16.1% per solved) is
from the retired dataset and should not be quoted.
