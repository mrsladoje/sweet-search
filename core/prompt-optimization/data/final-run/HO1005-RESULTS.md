# Held-out run — 2026-10-05 (tag `ho1005`), rep 1 — AGGREGATES ONLY

Sweet (main 3a778623, behaviour-identical through 85d2809d) vs native on the r3 HELD-OUT set: 200 questions
(easy 103 = second look after the V1b milestone, hard 97 = first ever run), 1 rep per arm, 3 cells.
No per-question value was inspected. 1,200 rollouts, 0 failed.

## Setup

- Questions: `questions-heldout.json` (select-heldout.mjs, sha-checked against MANIFEST.json + MANIFEST-HARD.json).
- Index: 11 r3 repos rebuilt on the RunPod RTX 5090 (candle CUDA) from main 65c4f20d; file and chunk counts equal to dev1005.
- Concurrency (ramp.sh, 60-id ramp, rows discarded): OpenAI lane 10, Claude lane 6; daemon cap 12.
- Pre-checks: GCSN dev MRR@10 0.8703 (10-04: 0.870); 5-task dev micro check: resolution equal in 15/15 pairs.
- Commits during the run (another session, release 2.9.0): product diff 3a778623..85d2809d = one `export` keyword
  + package.json version strings; node_modules not reinstalled. The "bench code differs" line below is that provenance only.

## Sweet vs native, pooled (200 questions); 95% question-clustered bootstrap, `*` = excludes 0 (not BH-corrected)

| Harness | Score | Billed cost | Cost without cache | Calls |
|---|---|---|---|---|
| Claude Code + Opus 5.5 medium | +0.3% [−1.7, +2.3] | **−9.6%*** [−12.0, −7.0] | **−8.5%*** | **−23.9%*** |
| Codex + Sol 6.1 high | **−2.8%*** [−5.1, −0.6] | **−8.0%*** [−12.0, −3.7] | **+21.4%*** | +0.1% |
| opencode + Sol 6.1 high | **−3.7%*** [−5.9, −1.8] | **−50.1%*** [−55.0, −44.8] | **−24.6%*** | **−30.8%*** |

Cache fairness: Claude Code ok (deterministic); Codex ok; opencode WARNING — native first wave 10/10 cold,
sweet 7/10 cold: the shipped opencode cache-key plugin (sweet product) vs stock opencode, a product difference.

Open: the score drop on both GPT-6.1 Sol cells (not on Opus). Rep 2 of the Sol cells + dev-set trace diagnosis owed.

## Full report (analyze.mjs --heldout)

# Final comparison (ho1005) — before vs after vs native

Unit = question (mean over reps). Intervals: 95% question-clustered bootstrap, stratified by tier for "pooled". `*` = interval excludes 0.

## cc-opus55-medium

rows 400 (ok 400, failed attempts 0) from r282-cc-opus55-medium-ho1005-r1
- after: code 52fa7554 | index 02392761 | gutter none | harness 2.1.281 (Claude Code)
- native: code 85d2809d | index — | gutter — | harness 2.1.281 (Claude Code)
- **bench code differs between rows (52fa7554, 85d2809d) — arms were not judged/costed by the same bench**
- ok rollouts per arm × rep: after r1=200; native r1=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.948 | 0.944 | — | — | — | 0.004 (n=103) | [-0.018, 0.025] | +0.4% [-1.9%, +2.7%] |
| calls | — | 2.5 | 3.4 | — | — | — | -0.9 * (n=103) | [-1.1, -0.7] | -27.2% [-32.8%, -21.4%] |
| costBilled | — | $0.0592 | $0.0652 | — | — | — | $-0.0060 * (n=103) | [$-0.0085, $-0.0035] | -9.2% [-12.8%, -5.5%] |
| costNoCache | — | $0.2772 | $0.3061 | — | — | — | $-0.0289 * (n=103) | [$-0.0463, $-0.0120] | -9.4% [-14.7%, -4.0%] |
| wallSec | — | 12.2 | 13.1 | — | — | — | -0.8 (n=103) | [-1.7, 0.0] | -6.5% [-12.7%, +0.1%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.835 | 0.834 | — | — | — | 0.001 (n=97) | [-0.028, 0.031] | +0.2% [-3.4%, +3.7%] |
| calls | — | 3.5 | 4.5 | — | — | — | -1.0 * (n=97) | [-1.2, -0.7] | -21.3% [-26.2%, -16.3%] |
| costBilled | — | $0.0890 | $0.0987 | — | — | — | $-0.0097 * (n=97) | [$-0.0132, $-0.0063] | -9.8% [-13.2%, -6.4%] |
| costNoCache | — | $0.3933 | $0.4264 | — | — | — | $-0.0331 * (n=97) | [$-0.0560, $-0.0108] | -7.8% [-12.8%, -2.6%] |
| wallSec | — | 18.5 | 21.4 | — | — | — | -2.9 * (n=97) | [-4.3, -1.7] | -13.6% [-19.1%, -8.3%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.893 | 0.891 | — | — | — | 0.003 (n=200) | [-0.015, 0.020] | +0.3% [-1.7%, +2.3%] |
| calls | — | 3.0 | 3.9 | — | — | — | -0.9 * (n=200) | [-1.1, -0.8] | -23.9% [-27.6%, -20.2%] |
| costBilled | — | $0.0736 | $0.0814 | — | — | — | $-0.0078 * (n=200) | [$-0.0099, $-0.0057] | -9.6% [-12.0%, -7.0%] |
| costNoCache | — | $0.3335 | $0.3644 | — | — | — | $-0.0309 * (n=200) | [$-0.0452, $-0.0169] | -8.5% [-12.2%, -4.7%] |
| wallSec | — | 15.3 | 17.1 | — | — | — | -1.9 * (n=200) | [-2.6, -1.1] | -10.8% [-15.0%, -6.6%] |

Held-out: aggregates only (no per-question swings).

## codex-sol61-high

rows 400 (ok 400, failed attempts 0) from r282-codex-sol61-high-ho1005-r1
- native: code 3a778623 | index — | gutter — | harness codex-cli 0.159.2
- after: code 3a778623 | index 02392761 | gutter none | harness codex-cli 0.159.2
- ok rollouts per arm × rep: native r1=200; after r1=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.890 | 0.915 | — | — | — | -0.024 * (n=103) | [-0.045, -0.004] | -2.7% [-4.9%, -0.5%] |
| calls | — | 3.5 | 3.7 | — | — | — | -0.2 (n=103) | [-0.5, 0.1] | -5.3% [-13.8%, +3.5%] |
| costBilled | — | $0.0308 | $0.0387 | — | — | — | $-0.0079 * (n=103) | [$-0.0106, $-0.0052] | -20.3% [-26.4%, -13.9%] |
| costNoCache | — | $0.1705 | $0.1538 | — | — | — | $0.0167 * (n=103) | [$0.0051, $0.0284] | +10.9% [+3.3%, +18.7%] |
| wallSec | — | 31.9 | 30.2 | — | — | — | 1.7 (n=103) | [-0.3, 3.7] | +5.6% [-1.0%, +12.4%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.818 | 0.844 | — | — | — | -0.026 (n=97) | [-0.061, 0.009] | -3.1% [-7.1%, +1.0%] |
| calls | — | 5.4 | 5.2 | — | — | — | 0.2 (n=97) | [-0.2, 0.7] | +4.2% [-4.5%, +13.7%] |
| costBilled | — | $0.0560 | $0.0553 | — | — | — | $0.0007 (n=97) | [$-0.0024, $0.0039] | +1.2% [-4.2%, +7.3%] |
| costNoCache | — | $0.2796 | $0.2162 | — | — | — | $0.0633 * (n=97) | [$0.0477, $0.0795] | +29.3% [+21.5%, +37.7%] |
| wallSec | — | 56.7 | 50.9 | — | — | — | 5.8 * (n=97) | [2.7, 9.1] | +11.4% [+5.3%, +18.0%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.855 | 0.880 | — | — | — | -0.025 * (n=200) | [-0.045, -0.005] | -2.8% [-5.1%, -0.6%] |
| calls | — | 4.4 | 4.4 | — | — | — | 0.0 (n=200) | [-0.3, 0.3] | +0.1% [-6.2%, +6.5%] |
| costBilled | — | $0.0430 | $0.0467 | — | — | — | $-0.0037 * (n=200) | [$-0.0058, $-0.0017] | -8.0% [-12.0%, -3.7%] |
| costNoCache | — | $0.2234 | $0.1841 | — | — | — | $0.0393 * (n=200) | [$0.0297, $0.0490] | +21.4% [+15.8%, +27.0%] |
| wallSec | — | 43.9 | 40.2 | — | — | — | 3.7 * (n=200) | [1.9, 5.5] | +9.2% [+4.6%, +13.9%] |

Held-out: aggregates only (no per-question swings).

## oc-sol61-high

rows 400 (ok 400, failed attempts 0) from r282-oc-sol61-high-ho1005-r1
- native: code 1786c431 | index — | gutter — | harness 1.18.4
- after: code 1786c431 | index 02392761 | gutter none | harness 1.18.4
- cache fairness r282-oc-sol61-high-ho1005-r1: warning
- ok rollouts per arm × rep: native r1=200; after r1=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.904 | 0.925 | — | — | — | -0.021 * (n=103) | [-0.040, -0.002] | -2.2% [-4.3%, -0.2%] |
| calls | — | 4.5 | 6.8 | — | — | — | -2.3 * (n=103) | [-3.2, -1.4] | -33.3% [-41.6%, -23.3%] |
| costBilled | — | $0.0206 | $0.0411 | — | — | — | $-0.0205 * (n=103) | [$-0.0250, $-0.0164] | -49.9% [-54.9%, -44.2%] |
| costNoCache | — | $0.0861 | $0.1023 | — | — | — | $-0.0162 * (n=103) | [$-0.0294, $-0.0040] | -15.8% [-25.5%, -4.4%] |
| wallSec | — | 32.1 | 43.2 | — | — | — | -11.1 * (n=103) | [-17.0, -5.8] | -25.7% [-34.3%, -15.6%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.808 | 0.855 | — | — | — | -0.047 * (n=97) | [-0.080, -0.018] | -5.5% [-9.3%, -2.1%] |
| calls | — | 10.7 | 15.2 | — | — | — | -4.5 * (n=97) | [-6.5, -2.6] | -29.6% [-37.4%, -20.1%] |
| costBilled | — | $0.0408 | $0.0818 | — | — | — | $-0.0411 * (n=97) | [$-0.0549, $-0.0291] | -50.2% [-56.8%, -42.1%] |
| costNoCache | — | $0.1553 | $0.2184 | — | — | — | $-0.0631 * (n=97) | [$-0.1201, $-0.0208] | -28.9% [-43.1%, -12.2%] |
| wallSec | — | 54.9 | 93.7 | — | — | — | -38.7 * (n=97) | [-56.0, -23.8] | -41.4% [-49.6%, -30.8%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.857 | 0.891 | — | — | — | -0.033 * (n=200) | [-0.052, -0.016] | -3.7% [-5.9%, -1.8%] |
| calls | — | 7.5 | 10.9 | — | — | — | -3.4 * (n=200) | [-4.4, -2.3] | -30.8% [-36.8%, -24.0%] |
| costBilled | — | $0.0304 | $0.0609 | — | — | — | $-0.0305 * (n=200) | [$-0.0376, $-0.0244] | -50.1% [-55.0%, -44.8%] |
| costNoCache | — | $0.1196 | $0.1586 | — | — | — | $-0.0389 * (n=200) | [$-0.0677, $-0.0173] | -24.6% [-35.9%, -12.8%] |
| wallSec | — | 43.2 | 67.7 | — | — | — | -24.5 * (n=200) | [-33.2, -16.7] | -36.2% [-43.0%, -28.3%] |

Held-out: aggregates only (no per-question swings).

wrote /Users/admin/.ss-eval/ho1005/report-ho1005.json
