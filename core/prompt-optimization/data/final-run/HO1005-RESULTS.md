# Held-out run — 2026-10-05/06 (tag `ho1005`), 3 reps — AGGREGATES ONLY

Sweet vs native on the r3 HELD-OUT set: 200 questions (easy 103 = second look after the V1b milestone,
hard 97 = first ever run), 3 reps per arm, 5 cells, 6,000 rollouts, 0 failed. No per-question value inspected.
Index: 11 r3 repos rebuilt on the RunPod 5090 (CUDA) from main 65c4f20d. Concurrency: OpenAI lane 10, Claude lane 6.

Product code across all rows: behaviour-identical for retrieval (one `export` keyword, version strings; d9d12687 at
01:34 adds a .gitignore entry for the Claude rules pointer — rules text unchanged; f1ee878b native change landed after
the run ended). The "MIXED CODE" lines in the report below are that provenance only.

## Sweet vs native, pooled (200 questions, mean over 3 reps); 95% question-clustered bootstrap; not BH-corrected

| Harness | Score | Billed cost | Cost without cache | Calls |
|---|---|---|---|---|
| Claude Code + Sonnet 5.5 high | **+2.4%*** [+1.1, +3.7] | **−7.6%*** | **−16.6%*** | **−14.1%*** |
| Claude Code + Opus 5.5 medium | +0.2% [−1.1, +1.6] | **−9.5%*** | **−7.1%*** | **−22.8%*** |
| Claude Code + Opus 5.5 high | −0.5% [−1.9, +1.0] | **−9.5%*** | **−7.4%*** | **−22.8%*** |
| opencode + Sol 6.1 high | **−2.8%*** [−4.5, −1.2] | **−50.2%*** | **−25.4%*** | **−33.1%*** |
| Codex + Sol 6.1 high | **−2.5%*** [−4.0, −1.2] | **−7.7%*** | **+22.9%*** | +0.6% |

Cache fairness: all Claude steps ok (deterministic check); Codex ok; opencode WARNING every rep (shipped cache-key
plugin vs stock opencode — a product difference; see cost without cache).

## BH correction — held-out ho1005, 5 cells × 4 metrics = 20 tests, q = 0.05, B = 20000, seed 42

| Cell | Metric | n | Sweet − native (rel) | 95% CI (rel) | p | BH q | |
|---|---|---|---|---|---|---|---|
| cc-sonnet55-high | score | 200 | +2.4% | [+1.1%, +3.7%] | <0.001 | <0.001 | **sig** |
| cc-sonnet55-high | costBilled | 200 | -7.6% | [-9.9%, -5.2%] | <0.001 | <0.001 | **sig** |
| cc-sonnet55-high | costNoCache | 200 | -16.6% | [-19.3%, -13.8%] | <0.001 | <0.001 | **sig** |
| cc-sonnet55-high | calls | 200 | -14.1% | [-17.7%, -10.3%] | <0.001 | <0.001 | **sig** |
| cc-opus55-medium | score | 200 | +0.2% | [-1.1%, +1.6%] | 0.743 | 0.782 |  |
| cc-opus55-medium | costBilled | 200 | -9.5% | [-11.4%, -7.6%] | <0.001 | <0.001 | **sig** |
| cc-opus55-medium | costNoCache | 200 | -7.1% | [-10.0%, -4.3%] | <0.001 | <0.001 | **sig** |
| cc-opus55-medium | calls | 200 | -22.8% | [-25.8%, -19.8%] | <0.001 | <0.001 | **sig** |
| cc-opus55-high | score | 200 | -0.5% | [-1.9%, +1.0%] | 0.466 | 0.518 |  |
| cc-opus55-high | costBilled | 200 | -9.5% | [-11.4%, -7.6%] | <0.001 | <0.001 | **sig** |
| cc-opus55-high | costNoCache | 200 | -7.4% | [-10.2%, -4.5%] | <0.001 | <0.001 | **sig** |
| cc-opus55-high | calls | 200 | -22.8% | [-25.7%, -19.8%] | <0.001 | <0.001 | **sig** |
| oc-sol61-high | score | 200 | -2.8% | [-4.4%, -1.2%] | <0.001 | <0.001 | **sig** |
| oc-sol61-high | costBilled | 200 | -50.2% | [-54.4%, -45.6%] | <0.001 | <0.001 | **sig** |
| oc-sol61-high | costNoCache | 200 | -25.4% | [-34.6%, -15.2%] | <0.001 | <0.001 | **sig** |
| oc-sol61-high | calls | 200 | -33.1% | [-38.0%, -27.7%] | <0.001 | <0.001 | **sig** |
| codex-sol61-high | score | 200 | -2.5% | [-4.0%, -1.2%] | <0.001 | <0.001 | **sig** |
| codex-sol61-high | costBilled | 200 | -7.7% | [-10.9%, -4.3%] | <0.001 | <0.001 | **sig** |
| codex-sol61-high | costNoCache | 200 | +22.9% | [+18.4%, +27.5%] | <0.001 | <0.001 | **sig** |
| codex-sol61-high | calls | 200 | +0.6% | [-3.7%, +5.2%] | 0.788 | 0.788 |  |

17 of 20 tests significant after BH at q = 0.05.

Computed by `bh-heldout.mjs` (paired, question-clustered, tier-stratified bootstrap; two-sided p).

## Full report (analyze.mjs --heldout)

# Final comparison (ho1005) — before vs after vs native

Unit = question (mean over reps). Intervals: 95% question-clustered bootstrap, stratified by tier for "pooled". `*` = interval excludes 0.

## cc-opus55-medium

rows 1201 (ok 1200, failed attempts 0) from r282-cc-opus55-medium-ho1005-r1, r282-cc-opus55-medium-ho1005-r2, r282-cc-opus55-medium-ho1005-r3
- after: code 52fa7554+340454db+b216752c+02255b37 | index 02392761 | gutter none | harness 2.1.281 (Claude Code)  **MIXED CODE — do not pool**
- native: code 85d2809d+35c74ed0+02255b37 | index — | gutter — | harness 2.1.281 (Claude Code)  **MIXED CODE — do not pool**
- **bench code differs between rows (52fa7554, 85d2809d, 35c74ed0, 340454db, b216752c, 02255b37) — arms were not judged/costed by the same bench**
- ok rollouts per arm × rep: after r1=200 r2=200 r3=200; native r1=200 r2=200 r3=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.949 | 0.942 | — | — | — | 0.007 (n=103) | [-0.006, 0.020] | +0.7% [-0.7%, +2.1%] |
| calls | — | 2.4 | 3.4 | — | — | — | -0.9 * (n=103) | [-1.1, -0.8] | -28.1% [-32.7%, -23.4%] |
| costBilled | — | $0.0581 | $0.0651 | — | — | — | $-0.0070 * (n=103) | [$-0.0088, $-0.0053] | -10.7% [-13.3%, -8.2%] |
| costNoCache | — | $0.2722 | $0.3038 | — | — | — | $-0.0316 * (n=103) | [$-0.0453, $-0.0183] | -10.4% [-14.6%, -6.1%] |
| wallSec | — | 11.3 | 12.5 | — | — | — | -1.2 * (n=103) | [-1.8, -0.7] | -9.7% [-13.9%, -5.7%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.830 | 0.833 | — | — | — | -0.003 (n=97) | [-0.024, 0.018] | -0.4% [-2.9%, +2.1%] |
| calls | — | 3.6 | 4.4 | — | — | — | -0.8 * (n=97) | [-1.0, -0.6] | -18.5% [-22.3%, -14.5%] |
| costBilled | — | $0.0889 | $0.0972 | — | — | — | $-0.0083 * (n=97) | [$-0.0112, $-0.0056] | -8.6% [-11.3%, -5.9%] |
| costNoCache | — | $0.3953 | $0.4145 | — | — | — | $-0.0192 * (n=97) | [$-0.0362, $-0.0027] | -4.6% [-8.5%, -0.7%] |
| wallSec | — | 18.4 | 20.2 | — | — | — | -1.8 * (n=97) | [-2.6, -0.9] | -8.7% [-12.7%, -4.6%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.891 | 0.889 | — | — | — | 0.002 (n=200) | [-0.010, 0.014] | +0.2% [-1.1%, +1.6%] |
| calls | — | 3.0 | 3.9 | — | — | — | -0.9 * (n=200) | [-1.0, -0.7] | -22.8% [-25.8%, -19.8%] |
| costBilled | — | $0.0730 | $0.0807 | — | — | — | $-0.0076 * (n=200) | [$-0.0093, $-0.0060] | -9.5% [-11.4%, -7.6%] |
| costNoCache | — | $0.3319 | $0.3575 | — | — | — | $-0.0256 * (n=200) | [$-0.0364, $-0.0149] | -7.1% [-10.0%, -4.2%] |
| wallSec | — | 14.7 | 16.2 | — | — | — | -1.5 * (n=200) | [-2.0, -1.0] | -9.1% [-12.1%, -6.2%] |

Held-out: aggregates only (no per-question swings).

## cc-sonnet55-high

rows 1200 (ok 1200, failed attempts 0) from r282-cc-sonnet55-high-ho1005-r1, r282-cc-sonnet55-high-ho1005-r2, r282-cc-sonnet55-high-ho1005-r3
- after: code 02255b37+065dc288+5b7e2af0 | index 02392761 | gutter none | harness 2.1.281 (Claude Code)  **MIXED CODE — do not pool**
- native: code 02255b37+a95ac58f+832b9c07 | index — | gutter — | harness 2.1.281 (Claude Code)  **MIXED CODE — do not pool**
- **bench code differs between rows (02255b37, a95ac58f, 065dc288, 5b7e2af0, 832b9c07) — arms were not judged/costed by the same bench**
- ok rollouts per arm × rep: after r1=200 r2=200 r3=200; native r1=200 r2=200 r3=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.946 | 0.921 | — | — | — | 0.025 * (n=103) | [0.012, 0.038] | +2.7% [+1.3%, +4.2%] |
| calls | — | 3.3 | 4.3 | — | — | — | -1.0 * (n=103) | [-1.2, -0.8] | -23.7% [-28.7%, -18.6%] |
| costBilled | — | $0.0457 | $0.0525 | — | — | — | $-0.0068 * (n=103) | [$-0.0084, $-0.0051] | -12.9% [-15.9%, -9.8%] |
| costNoCache | — | $0.2098 | $0.2691 | — | — | — | $-0.0593 * (n=103) | [$-0.0695, $-0.0487] | -22.0% [-25.8%, -18.1%] |
| wallSec | — | 10.6 | 11.4 | — | — | — | -0.8 * (n=103) | [-1.4, -0.3] | -7.2% [-11.7%, -2.5%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.850 | 0.834 | — | — | — | 0.016 (n=97) | [-0.001, 0.036] | +2.0% [-0.2%, +4.5%] |
| calls | — | 5.2 | 5.5 | — | — | — | -0.3 * (n=97) | [-0.6, -0.0] | -6.1% [-11.4%, -0.3%] |
| costBilled | — | $0.0725 | $0.0752 | — | — | — | $-0.0027 * (n=97) | [$-0.0053, $-0.0001] | -3.7% [-7.0%, -0.1%] |
| costNoCache | — | $0.3019 | $0.3433 | — | — | — | $-0.0414 * (n=97) | [$-0.0561, $-0.0262] | -12.1% [-16.0%, -7.8%] |
| wallSec | — | 17.0 | 17.7 | — | — | — | -0.7 (n=97) | [-1.8, 0.4] | -3.8% [-9.7%, +2.3%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.899 | 0.879 | — | — | — | 0.021 * (n=200) | [0.010, 0.032] | +2.4% [+1.1%, +3.7%] |
| calls | — | 4.2 | 4.9 | — | — | — | -0.7 * (n=200) | [-0.9, -0.5] | -14.1% [-17.8%, -10.3%] |
| costBilled | — | $0.0587 | $0.0635 | — | — | — | $-0.0048 * (n=200) | [$-0.0064, $-0.0033] | -7.6% [-10.0%, -5.2%] |
| costNoCache | — | $0.2544 | $0.3051 | — | — | — | $-0.0506 * (n=200) | [$-0.0596, $-0.0414] | -16.6% [-19.3%, -13.7%] |
| wallSec | — | 13.7 | 14.5 | — | — | — | -0.7 * (n=200) | [-1.3, -0.2] | -5.2% [-9.1%, -1.1%] |

Held-out: aggregates only (no per-question swings).

## cc-opus55-high

rows 1200 (ok 1200, failed attempts 0) from r282-cc-opus55-high-ho1005-r1, r282-cc-opus55-high-ho1005-r2, r282-cc-opus55-high-ho1005-r3
- after: code d9d12687+98de5a8c | index 02392761 | gutter none | harness 2.1.281 (Claude Code)  **MIXED CODE — do not pool**
- native: code 98de5a8c | index — | gutter — | harness 2.1.281 (Claude Code)
- **bench code differs between rows (d9d12687, 98de5a8c) — arms were not judged/costed by the same bench**
- ok rollouts per arm × rep: after r1=200 r2=200 r3=200; native r1=200 r2=200 r3=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.955 | 0.956 | — | — | — | -0.001 (n=103) | [-0.010, 0.008] | -0.1% [-1.1%, +0.8%] |
| calls | — | 2.6 | 3.6 | — | — | — | -1.0 * (n=103) | [-1.2, -0.8] | -27.7% [-32.3%, -23.0%] |
| costBilled | — | $0.0629 | $0.0706 | — | — | — | $-0.0077 * (n=103) | [$-0.0098, $-0.0057] | -11.0% [-13.7%, -8.2%] |
| costNoCache | — | $0.2940 | $0.3287 | — | — | — | $-0.0347 * (n=103) | [$-0.0493, $-0.0200] | -10.6% [-14.8%, -6.1%] |
| wallSec | — | 12.4 | 14.2 | — | — | — | -1.8 * (n=103) | [-2.5, -1.2] | -12.8% [-16.9%, -8.4%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.854 | 0.863 | — | — | — | -0.009 (n=97) | [-0.034, 0.018] | -1.1% [-3.8%, +2.2%] |
| calls | — | 3.9 | 4.8 | — | — | — | -0.9 * (n=97) | [-1.1, -0.7] | -18.8% [-22.6%, -15.1%] |
| costBilled | — | $0.0997 | $0.1090 | — | — | — | $-0.0093 * (n=97) | [$-0.0122, $-0.0064] | -8.5% [-11.2%, -5.9%] |
| costNoCache | — | $0.4376 | $0.4604 | — | — | — | $-0.0228 * (n=97) | [$-0.0406, $-0.0051] | -4.9% [-8.7%, -1.1%] |
| wallSec | — | 21.6 | 22.2 | — | — | — | -0.6 (n=97) | [-1.5, 0.3] | -2.8% [-6.9%, +1.5%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.906 | 0.911 | — | — | — | -0.005 (n=200) | [-0.018, 0.009] | -0.5% [-1.9%, +1.0%] |
| calls | — | 3.2 | 4.2 | — | — | — | -1.0 * (n=200) | [-1.1, -0.8] | -22.8% [-25.7%, -19.7%] |
| costBilled | — | $0.0807 | $0.0892 | — | — | — | $-0.0085 * (n=200) | [$-0.0102, $-0.0067] | -9.5% [-11.4%, -7.6%] |
| costNoCache | — | $0.3637 | $0.3926 | — | — | — | $-0.0289 * (n=200) | [$-0.0404, $-0.0172] | -7.4% [-10.2%, -4.5%] |
| wallSec | — | 16.9 | 18.1 | — | — | — | -1.2 * (n=200) | [-1.8, -0.7] | -6.9% [-9.9%, -3.7%] |

Held-out: aggregates only (no per-question swings).

## codex-sol61-high

rows 1200 (ok 1200, failed attempts 0) from r282-codex-sol61-high-ho1005-r1, r282-codex-sol61-high-ho1005-r2, r282-codex-sol61-high-ho1005-r3
- native: code 3a778623+988036f1+02255b37 | index — | gutter — | harness codex-cli 0.159.2  **MIXED CODE — do not pool**
- after: code 3a778623+988036f1+02255b37 | index 02392761 | gutter none | harness codex-cli 0.159.2  **MIXED CODE — do not pool**
- **bench code differs between rows (3a778623, 988036f1, 02255b37) — arms were not judged/costed by the same bench**
- ok rollouts per arm × rep: native r1=200 r2=200 r3=200; after r1=200 r2=200 r3=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.899 | 0.919 | — | — | — | -0.020 * (n=103) | [-0.035, -0.006] | -2.2% [-3.8%, -0.6%] |
| calls | — | 3.5 | 3.7 | — | — | — | -0.2 (n=103) | [-0.4, 0.1] | -4.7% [-11.3%, +2.2%] |
| costBilled | — | $0.0315 | $0.0385 | — | — | — | $-0.0070 * (n=103) | [$-0.0092, $-0.0049] | -18.2% [-23.2%, -13.1%] |
| costNoCache | — | $0.1778 | $0.1560 | — | — | — | $0.0218 * (n=103) | [$0.0109, $0.0329] | +14.0% [+6.9%, +21.2%] |
| wallSec | — | 30.1 | 25.9 | — | — | — | 4.3 * (n=103) | [2.2, 6.8] | +16.6% [+8.4%, +26.2%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.813 | 0.838 | — | — | — | -0.025 * (n=97) | [-0.046, -0.005] | -2.9% [-5.5%, -0.6%] |
| calls | — | 5.4 | 5.1 | — | — | — | 0.2 (n=97) | [-0.1, 0.5] | +4.7% [-1.2%, +11.1%] |
| costBilled | — | $0.0558 | $0.0558 | — | — | — | $0.0000 (n=97) | [$-0.0024, $0.0025] | +0.0% [-4.1%, +4.6%] |
| costNoCache | — | $0.2794 | $0.2154 | — | — | — | $0.0640 * (n=97) | [$0.0525, $0.0758] | +29.7% [+23.8%, +35.9%] |
| wallSec | — | 48.6 | 41.0 | — | — | — | 7.6 * (n=97) | [5.9, 9.4] | +18.5% [+14.3%, +23.0%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.858 | 0.880 | — | — | — | -0.022 * (n=200) | [-0.035, -0.010] | -2.5% [-4.0%, -1.2%] |
| calls | — | 4.4 | 4.4 | — | — | — | 0.0 (n=200) | [-0.2, 0.2] | +0.6% [-3.7%, +5.2%] |
| costBilled | — | $0.0433 | $0.0469 | — | — | — | $-0.0036 * (n=200) | [$-0.0052, $-0.0020] | -7.7% [-10.9%, -4.3%] |
| costNoCache | — | $0.2271 | $0.1848 | — | — | — | $0.0423 * (n=200) | [$0.0344, $0.0503] | +22.9% [+18.4%, +27.5%] |
| wallSec | — | 39.1 | 33.2 | — | — | — | 5.9 * (n=200) | [4.4, 7.4] | +17.7% [+13.3%, +22.4%] |

Held-out: aggregates only (no per-question swings).

## oc-sol61-high

rows 1200 (ok 1200, failed attempts 0) from r282-oc-sol61-high-ho1005-r1, r282-oc-sol61-high-ho1005-r2, r282-oc-sol61-high-ho1005-r3
- native: code 1786c431+02255b37+a95ac58f | index — | gutter — | harness 1.18.4  **MIXED CODE — do not pool**
- after: code 1786c431+02255b37+a95ac58f | index 02392761 | gutter none | harness 1.18.4  **MIXED CODE — do not pool**
- **bench code differs between rows (1786c431, 02255b37, a95ac58f) — arms were not judged/costed by the same bench**
- cache fairness r282-oc-sol61-high-ho1005-r1: warning
- cache fairness r282-oc-sol61-high-ho1005-r2: warning
- cache fairness r282-oc-sol61-high-ho1005-r3: warning
- ok rollouts per arm × rep: native r1=200 r2=200 r3=200; after r1=200 r2=200 r3=200

### easy (103 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.911 | 0.927 | — | — | — | -0.016 * (n=103) | [-0.028, -0.005] | -1.7% [-3.0%, -0.5%] |
| calls | — | 4.5 | 7.4 | — | — | — | -2.9 * (n=103) | [-3.7, -2.1] | -39.0% [-45.6%, -31.4%] |
| costBilled | — | $0.0207 | $0.0421 | — | — | — | $-0.0215 * (n=103) | [$-0.0257, $-0.0177] | -50.9% [-55.7%, -45.9%] |
| costNoCache | — | $0.0875 | $0.1080 | — | — | — | $-0.0205 * (n=103) | [$-0.0330, $-0.0096] | -19.0% [-27.5%, -9.8%] |
| wallSec | — | 27.2 | 36.5 | — | — | — | -9.4 * (n=103) | [-12.9, -6.2] | -25.6% [-32.0%, -18.7%] |

### hard (97 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.823 | 0.857 | — | — | — | -0.034 * (n=97) | [-0.063, -0.008] | -3.9% [-7.3%, -1.0%] |
| calls | — | 10.6 | 15.2 | — | — | — | -4.6 * (n=97) | [-6.4, -3.0] | -30.1% [-36.6%, -22.4%] |
| costBilled | — | $0.0405 | $0.0807 | — | — | — | $-0.0402 * (n=97) | [$-0.0527, $-0.0294] | -49.8% [-55.5%, -42.9%] |
| costNoCache | — | $0.1562 | $0.2193 | — | — | — | $-0.0631 * (n=97) | [$-0.1111, $-0.0244] | -28.8% [-40.6%, -14.0%] |
| wallSec | — | 47.2 | 73.2 | — | — | — | -26.1 * (n=97) | [-37.3, -16.2] | -35.6% [-43.2%, -26.2%] |

### pooled (200 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.869 | 0.893 | — | — | — | -0.025 * (n=200) | [-0.040, -0.011] | -2.8% [-4.5%, -1.2%] |
| calls | — | 7.5 | 11.2 | — | — | — | -3.7 * (n=200) | [-4.7, -2.8] | -33.1% [-38.0%, -27.6%] |
| costBilled | — | $0.0303 | $0.0608 | — | — | — | $-0.0305 * (n=200) | [$-0.0370, $-0.0249] | -50.2% [-54.3%, -45.5%] |
| costNoCache | — | $0.1208 | $0.1620 | — | — | — | $-0.0412 * (n=200) | [$-0.0658, $-0.0212] | -25.4% [-34.7%, -15.2%] |
| wallSec | — | 36.9 | 54.3 | — | — | — | -17.5 * (n=200) | [-23.3, -12.3] | -32.1% [-38.0%, -25.5%] |

Held-out: aggregates only (no per-question swings).

wrote /Users/admin/.ss-eval/ho1005/report-final.json
