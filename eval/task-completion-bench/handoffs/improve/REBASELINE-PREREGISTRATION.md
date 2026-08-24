# Post-repair re-baseline: sweet vs native — PRE-REGISTRATION

**Written before the run. No figure below was chosen after seeing a result.**

## 0. Why this run exists

Every current head-to-head number predates the repairs, and the two datasets we have
**disagree on the same harness and the same 13 tasks**:

| dataset | opencode, sweet v native | cost/rollout | cost/solved |
|---|---|---:|---:|
| `sb-*`, 2026-08-11, 2 reps | 13/26 v 13/26 (tie) | −15.3% | **−15.3%** |
| `cs-base`, 2026-08-21, 3 reps | 17/39 v 21/39 (loss) | −7.9% | **+13.8%** |

Cost per solved task **flips sign**. That is not a measurement; it is two samples of noise.
Meanwhile the harness has been repaired underneath both of them: the read gutter became a tab
(`116ca2b`, 2026-08-13), D2 landed with two blockers fixed, the ledger fingerprint moved to
v4, and four tasks were removed as unmeasurable.

**This run replaces both. Nothing here is pooled with either.**

## 1. Design

- **Tasks:** the **13 admissible** rotation tasks. YARP is ungradeable; `mqtt_cpp-466`,
  `cms-9029` and `mransan-202` are blocklisted; `polyfactory-405` is excluded from agent runs.
- **Arms:** native and sweet, production prompt, no treatment. This is a baseline, not an A/B.
- **Reps:** **3** (odd, so a majority-of-reps task verdict is well defined).
- **Harnesses:** **opencode and claude-code.**
- **Concurrency: 1.** The OpenCode pin loss is now known to fire at 2, silently. A clean
  denominator is the whole point of this run, so throughput is sacrificed for it.
- **Ledger:** `luna-rotate20-v4`, preflighted green at **13/13 gold-FULL on both harnesses**
  before launch.
- **Total: 13 × 2 arms × 3 reps × 2 harnesses = 156 rollouts.**

**Codex is excluded and the reason is recorded, not hidden.** Its subscription refresh token
was spent on 2026-08-06 and needs an interactive login. D2 on codex is therefore **NOT
PROVEN**, so codex evidence would carry the very defect this re-baseline exists to clear. It
will be added later as a separate run and reported separately.

**The two new controls (`zlint-299`, `dot-prop-105`) are deliberately NOT included.** Controls
exist to catch a treatment that breaks something. There is no treatment here, so they would
add cost and answer nothing.

## 2. Cost definition, fixed in advance

**Sidechain-INCLUSIVE**, per the settled definition since 2026-08-13. Claude-code native uses
subagents far more than sweet (5 cells vs 1, `$0.037` vs `$0.017` on the old run), so the
main-transcript-only column reads **+4.8% against sweet** where the fully-loaded column reads
**−0.7%**. Only the fully-loaded number will be reported as the cost result.

Realized, cache-discounted pricing, summed at turn granularity.

## 3. What will be reported, and what would count as a finding

Three quantities, per harness:

1. **rollouts solved**, sweet v native, out of 39 each;
2. **tasks majority-solved**, out of 13;
3. **cost per rollout** and **cost per solved task**, fully loaded.

**Pre-registered significance rule.** With 39 paired rollouts per arm, a difference of fewer
than **6 rollouts** is inside noise and **will be reported as "no measurable difference"**,
not as a direction. A paired sign test over the 13 tasks will be reported alongside. No
cost-per-solved claim will be made at all unless the underlying solve counts differ by at
least that margin, because the denominator is what made the existing numbers flip sign.

**I am pre-committing to the null.** The most likely honest outcome of this run is "sweet is
cheaper per rollout, and resolution is indistinguishable." If that is what it shows, that is
the published result, and the `−15%` / `−19%` cost-per-solved figures that have circulated are
formally retired.

## 4. Discard conditions

- Ledger not green at preflight → no run. (Checked: green, 13/13, both harnesses.)
- More than **8 of 156** rollouts lost to harness error → rerun rather than patch around it.
- Any harness or engine change landing mid-run → the run is void, not merged.
