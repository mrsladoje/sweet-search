<!-- Output of `bash core/prompt-optimization/data/final-run/run.sh analyze`, 2026-10-04, after recompute-subagent-cost.mjs folded opencode subagent (child-session) spend into the oc-sol61-high rows (3 native r1 rows changed; originals in runs.orig.jsonl). -->

# Final comparison (final) — before vs after vs native

Unit = question (mean over reps). Intervals: 95% question-clustered bootstrap, stratified by tier for "pooled". `*` = interval excludes 0.

## cc-opus55-medium

rows 150 (ok 150, failed attempts 0) from r282-cc-opus55-medium-final-r1, r282-cc-opus55-medium-final-r2
- after: code 6b50d7c5 | index b7e7ea70 | gutter none | harness 2.1.281 (Claude Code)
- before: code d013b492 | index d013b492 | gutter tab | harness 2.1.281 (Claude Code)
- native: code 6b50d7c5 | index — | gutter — | harness 2.1.281 (Claude Code)
- ok rollouts per arm × rep: after r1=30 r2=30; before r1=30 r2=30; native r1=30

### easy (12 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.935 | 0.948 | 0.983 | 0.013 (n=12) | [-0.021, 0.058] | +1.3% [-2.2%, +6.5%] | -0.035 (n=12) | [-0.106, 0.019] | -3.6% [-10.6%, +2.0%] |
| calls | 3.0 | 2.9 | 4.8 | -0.2 (n=12) | [-0.6, 0.3] | -5.5% [-20.3%, +10.0%] | -1.9 * (n=12) | [-2.7, -1.2] | -39.5% [-54.5%, -25.4%] |
| costBilled | $0.0766 | $0.0756 | $0.0852 | $-0.0010 (n=12) | [$-0.0069, $0.0050] | -1.3% [-9.3%, +6.4%] | $-0.0096 (n=12) | [$-0.0202, $0.0005] | -11.3% [-22.4%, +0.6%] |
| costNoCache | $0.3434 | $0.3291 | $0.4348 | $-0.0143 (n=12) | [$-0.0497, $0.0267] | -4.2% [-15.6%, +7.3%] | $-0.1057 * (n=12) | [$-0.1744, $-0.0428] | -24.3% [-38.9%, -10.4%] |
| wallSec | 12.7 | 15.1 | 17.0 | 2.4 * (n=12) | [0.1, 4.7] | +18.7% [+0.9%, +39.8%] | -1.9 (n=12) | [-5.7, 1.8] | -11.0% [-30.0%, +12.2%] |

### hard (18 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.829 | 0.844 | 0.856 | 0.016 (n=18) | [-0.036, 0.066] | +1.9% [-4.2%, +8.8%] | -0.011 (n=18) | [-0.054, 0.036] | -1.3% [-6.1%, +4.6%] |
| calls | 4.3 | 3.3 | 4.1 | -0.9 * (n=18) | [-1.5, -0.2] | -21.6% [-31.9%, -5.8%] | -0.7 * (n=18) | [-1.4, -0.2] | -17.8% [-28.8%, -4.8%] |
| costBilled | $0.1019 | $0.0898 | $0.0911 | $-0.0121 * (n=18) | [$-0.0206, $-0.0029] | -11.9% [-18.4%, -3.1%] | $-0.0013 (n=18) | [$-0.0091, $0.0065] | -1.4% [-9.8%, +7.2%] |
| costNoCache | $0.4734 | $0.3817 | $0.3958 | $-0.0917 * (n=18) | [$-0.1497, $-0.0236] | -19.4% [-28.7%, -5.6%] | $-0.0140 (n=18) | [$-0.0640, $0.0310] | -3.5% [-14.5%, +8.7%] |
| wallSec | 20.1 | 23.7 | 19.9 | 3.6 (n=18) | [-0.6, 9.0] | +17.9% [-3.2%, +45.1%] | 3.8 (n=18) | [-2.7, 10.9] | +19.0% [-12.1%, +59.4%] |

### pooled (30 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.871 | 0.886 | 0.907 | 0.014 (n=30) | [-0.019, 0.050] | +1.6% [-2.1%, +6.0%] | -0.021 (n=30) | [-0.059, 0.015] | -2.3% [-6.3%, +1.7%] |
| calls | 3.8 | 3.1 | 4.3 | -0.6 * (n=30) | [-1.0, -0.2] | -16.4% [-25.7%, -4.5%] | -1.2 * (n=30) | [-1.7, -0.7] | -27.3% [-35.8%, -18.2%] |
| costBilled | $0.0918 | $0.0841 | $0.0887 | $-0.0077 * (n=30) | [$-0.0133, $-0.0017] | -8.4% [-13.8%, -1.9%] | $-0.0046 (n=30) | [$-0.0111, $0.0016] | -5.2% [-12.0%, +1.9%] |
| costNoCache | $0.4214 | $0.3607 | $0.4114 | $-0.0607 * (n=30) | [$-0.0987, $-0.0171] | -14.4% [-22.5%, -4.3%] | $-0.0507 * (n=30) | [$-0.0917, $-0.0126] | -12.3% [-20.8%, -3.3%] |
| wallSec | 17.2 | 20.3 | 18.8 | 3.1 * (n=30) | [0.4, 6.4] | +18.1% [+2.2%, +37.8%] | 1.5 (n=30) | [-2.7, 6.0] | +8.1% [-13.1%, +34.0%] |

Top 5 costBilled swings after − before: r3hb-grdb-07 (hard) $0.1619→$0.1221; r3hb-sequel-08 (hard) $0.1281→$0.0901; r3h-typedoc-23 (hard) $0.0506→$0.0883; r3hb-grdb-11 (hard) $0.1098→$0.0738; r3hb-okhttp-12 (hard) $0.1423→$0.1114
Top 5 score swings after − before: r3h-typedoc-23 (hard) 0.000→0.250; r3-dgraph-29 (easy) 0.675→0.900; r3hb-composer-07 (hard) 0.875→0.675; r3hb-grdb-07 (hard) 0.800→0.610; r3h-zipkin-22 (hard) 0.900→0.775
Top 5 costBilled swings after − native: r3-tortoise-orm-22 (easy) $0.1018→$0.0601; r3h-typedoc-23 (hard) $0.1289→$0.0883; r3-zipkin-20 (easy) $0.1677→$0.1356; r3hb-okhttp-12 (hard) $0.0799→$0.1114; r3-typedoc-15 (easy) $0.0743→$0.0430
Top 5 score swings after − native: r3-ocelot-03 (easy) 1.000→0.650; r3h-typedoc-23 (hard) 0.000→0.250; r3hb-composer-07 (hard) 0.850→0.675; r3h-typedoc-16 (hard) 0.900→0.750; r3-jj-09 (easy) 0.800→0.950
Captures: core/prompt-optimization/data/results/r282-cc-opus55-medium-final-r1/captures, core/prompt-optimization/data/results/r282-cc-opus55-medium-final-r2/captures (<arm>.<id>.json; arm sweet = after)

## codex-sol61-high

rows 150 (ok 150, failed attempts 0) from r282-codex-sol61-high-final-r1, r282-codex-sol61-high-final-r2
- native: code 6b50d7c5 | index — | gutter — | harness codex-cli 0.159.2
- before: code d013b492 | index d013b492 | gutter none | harness codex-cli 0.159.2
- after: code 6b50d7c5+f3fc7f95 | index b7e7ea70 | gutter none | harness codex-cli 0.159.2  **MIXED CODE — do not pool**
- **bench code differs between rows (6b50d7c5, f3fc7f95) — arms were not judged/costed by the same bench**
- ok rollouts per arm × rep: native r1=30; before r1=30 r2=30; after r1=30 r2=30

### easy (12 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.925 | 0.908 | 0.950 | -0.017 (n=12) | [-0.096, 0.067] | -1.8% [-10.1%, +7.7%] | -0.042 * (n=12) | [-0.077, -0.015] | -4.4% [-8.2%, -1.5%] |
| calls | 4.2 | 3.5 | 3.8 | -0.7 (n=12) | [-1.8, 0.3] | -17.8% [-36.2%, +7.6%] | -0.3 (n=12) | [-1.0, 0.4] | -7.8% [-24.5%, +13.2%] |
| costBilled | $0.0442 | $0.0404 | $0.0334 | $-0.0038 (n=12) | [$-0.0115, $0.0025] | -8.6% [-23.8%, +6.1%] | $0.0070 (n=12) | [$-0.0007, $0.0146] | +21.1% [-1.8%, +47.8%] |
| costNoCache | $0.2462 | $0.2278 | $0.1488 | $-0.0184 (n=12) | [$-0.0880, $0.0429] | -7.5% [-31.0%, +20.1%] | $0.0790 * (n=12) | [$0.0250, $0.1446] | +53.1% [+16.2%, +103.6%] |
| wallSec | 53.6 | 51.4 | 24.8 | -2.2 (n=12) | [-15.6, 9.4] | -4.2% [-26.3%, +19.6%] | 26.5 * (n=12) | [15.1, 41.4] | +106.8% [+59.6%, +171.5%] |

### hard (18 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.778 | 0.780 | 0.814 | 0.002 (n=18) | [-0.078, 0.070] | +0.3% [-9.7%, +9.4%] | -0.034 (n=18) | [-0.115, 0.035] | -4.2% [-13.5%, +4.6%] |
| calls | 5.5 | 5.1 | 4.8 | -0.3 (n=18) | [-0.8, 0.1] | -6.1% [-13.0%, +1.2%] | 0.4 (n=18) | [-0.4, 1.1] | +7.6% [-7.4%, +25.6%] |
| costBilled | $0.0644 | $0.0627 | $0.0497 | $-0.0017 (n=18) | [$-0.0092, $0.0055] | -2.7% [-14.0%, +8.8%] | $0.0130 * (n=18) | [$0.0038, $0.0222] | +26.1% [+7.1%, +47.4%] |
| costNoCache | $0.3144 | $0.2881 | $0.1943 | $-0.0264 (n=18) | [$-0.0630, $0.0077] | -8.4% [-18.9%, +2.7%] | $0.0938 * (n=18) | [$0.0469, $0.1454] | +48.3% [+23.0%, +79.8%] |
| wallSec | 66.8 | 62.2 | 38.8 | -4.6 (n=18) | [-14.3, 5.1] | -6.9% [-20.0%, +8.1%] | 23.4 * (n=18) | [14.1, 34.5] | +60.5% [+38.0%, +87.5%] |

### pooled (30 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.837 | 0.831 | 0.869 | -0.005 (n=30) | [-0.063, 0.049] | -0.6% [-7.4%, +6.0%] | -0.037 (n=30) | [-0.087, 0.006] | -4.3% [-9.8%, +0.7%] |
| calls | 5.0 | 4.5 | 4.4 | -0.5 * (n=30) | [-1.0, -0.0] | -10.1% [-18.6%, -0.4%] | 0.1 (n=30) | [-0.4, 0.6] | +2.3% [-9.4%, +16.2%] |
| costBilled | $0.0563 | $0.0538 | $0.0432 | $-0.0025 (n=30) | [$-0.0079, $0.0026] | -4.5% [-13.6%, +4.8%] | $0.0106 * (n=30) | [$0.0044, $0.0170] | +24.6% [+9.8%, +41.4%] |
| costNoCache | $0.2871 | $0.2639 | $0.1761 | $-0.0232 (n=30) | [$-0.0585, $0.0100] | -8.1% [-19.1%, +3.8%] | $0.0879 * (n=30) | [$0.0516, $0.1285] | +49.9% [+28.5%, +76.1%] |
| wallSec | 61.5 | 57.9 | 33.2 | -3.7 (n=30) | [-11.6, 3.8] | -5.9% [-17.8%, +6.5%] | 24.7 * (n=30) | [17.1, 33.5] | +74.3% [+52.6%, +100.3%] |

Top 5 costBilled swings after − before: r3-dgraph-31 (easy) $0.0667→$0.0295; r3hb-grdb-07 (hard) $0.0960→$0.0633; r3h-typedoc-23 (hard) $0.0612→$0.0363; r3h-jj-12 (hard) $0.0603→$0.0853; r3hb-drogon-01 (hard) $0.0763→$0.0532
Top 5 score swings after − before: r3h-ocelot-24 (hard) 1.000→0.475; r3-typedoc-15 (easy) 0.650→0.925; r3hb-okhttp-12 (hard) 0.650→0.900; r3-dgraph-29 (easy) 0.925→0.700; r3-tortoise-orm-22 (easy) 1.000→0.775
Top 5 costBilled swings after − native: r3hb-sequel-08 (hard) $0.0455→$0.0990; r3hb-okhttp-12 (hard) $0.0347→$0.0732; r3-dgraph-29 (easy) $0.0314→$0.0681; r3h-jj-12 (hard) $0.0513→$0.0853; r3hb-composer-11 (hard) $0.0400→$0.0708
Top 5 score swings after − native: r3h-ocelot-24 (hard) 1.000→0.475; r3hb-composer-07 (hard) 0.750→0.475; r3h-tortoise-orm-06 (hard) 1.000→0.775; r3h-dgraph-12 (hard) 0.600→0.825; r3-ocelot-27 (easy) 1.000→0.800
Captures: core/prompt-optimization/data/results/r282-codex-sol61-high-final-r1/captures, core/prompt-optimization/data/results/r282-codex-sol61-high-final-r2/captures (<arm>.<id>.json; arm sweet = after)

## oc-sol61-high

rows 150 (ok 150, failed attempts 0) from r282-oc-sol61-high-final-r1, r282-oc-sol61-high-final-r2
- before: code d013b492 | index d013b492 | gutter colon | harness 1.18.4
- after: code 6b50d7c5+f3fc7f95 | index b7e7ea70 | gutter none | harness 1.18.4  **MIXED CODE — do not pool**
- native: code 6b50d7c5 | index — | gutter — | harness 1.18.4
- **bench code differs between rows (6b50d7c5, f3fc7f95) — arms were not judged/costed by the same bench**
- cache fairness r282-oc-sol61-high-final-r1: warning
- cache fairness r282-oc-sol61-high-final-r2: warning
- ok rollouts per arm × rep: before r1=30 r2=30; after r1=30 r2=30; native r1=30

### easy (12 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.924 | 0.948 | 0.933 | 0.024 (n=12) | [-0.019, 0.071] | +2.6% [-2.0%, +7.9%] | 0.015 (n=12) | [-0.035, 0.065] | +1.6% [-3.8%, +7.3%] |
| calls | 4.1 | 4.3 | 5.9 | 0.2 (n=12) | [-0.9, 1.4] | +5.1% [-17.3%, +41.9%] | -1.6 (n=12) | [-4.0, 0.6] | -27.5% [-50.0%, +16.0%] |
| costBilled | $0.0276 | $0.0278 | $0.0395 | $0.0002 (n=12) | [$-0.0058, $0.0068] | +0.8% [-18.1%, +30.0%] | $-0.0117 * (n=12) | [$-0.0212, $-0.0029] | -29.6% [-44.3%, -9.2%] |
| costNoCache | $0.0986 | $0.0977 | $0.0891 | $-0.0009 (n=12) | [$-0.0277, $0.0262] | -0.9% [-21.4%, +33.7%] | $0.0086 (n=12) | [$-0.0197, $0.0385] | +9.6% [-18.8%, +54.3%] |
| wallSec | 27.8 | 29.7 | 31.4 | 1.9 (n=12) | [-2.3, 6.7] | +6.8% [-7.5%, +26.5%] | -1.7 (n=12) | [-11.4, 7.2] | -5.4% [-28.2%, +30.1%] |

### hard (18 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.787 | 0.810 | 0.855 | 0.023 (n=18) | [-0.032, 0.091] | +2.9% [-4.1%, +12.3%] | -0.046 * (n=18) | [-0.084, -0.013] | -5.3% [-9.9%, -1.4%] |
| calls | 10.3 | 9.6 | 11.1 | -0.6 (n=18) | [-1.6, 0.3] | -6.0% [-15.2%, +3.5%] | -1.4 (n=18) | [-3.6, 0.3] | -12.8% [-27.3%, +3.4%] |
| costBilled | $0.0467 | $0.0408 | $0.0585 | $-0.0060 * (n=18) | [$-0.0105, $-0.0016] | -12.8% [-21.4%, -3.7%] | $-0.0177 * (n=18) | [$-0.0362, $-0.0038] | -30.3% [-46.5%, -8.1%] |
| costNoCache | $0.1656 | $0.1374 | $0.1394 | $-0.0282 * (n=18) | [$-0.0452, $-0.0116] | -17.0% [-24.1%, -8.0%] | $-0.0020 (n=18) | [$-0.0369, $0.0267] | -1.4% [-21.1%, +22.6%] |
| wallSec | 47.8 | 44.7 | 54.6 | -3.1 * (n=18) | [-6.1, -0.2] | -6.6% [-12.2%, -0.4%] | -9.9 (n=18) | [-26.5, 1.8] | -18.2% [-36.0%, +4.3%] |

### pooled (30 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | 0.841 | 0.865 | 0.887 | 0.024 (n=30) | [-0.015, 0.070] | +2.8% [-1.7%, +8.6%] | -0.022 (n=30) | [-0.052, 0.007] | -2.4% [-5.8%, +0.8%] |
| calls | 7.8 | 7.5 | 9.0 | -0.3 (n=30) | [-1.0, 0.5] | -3.6% [-12.6%, +6.4%] | -1.5 * (n=30) | [-3.1, -0.1] | -16.7% [-29.3%, -1.5%] |
| costBilled | $0.0391 | $0.0356 | $0.0509 | $-0.0035 (n=30) | [$-0.0072, $0.0001] | -9.0% [-17.3%, +0.3%] | $-0.0153 * (n=30) | [$-0.0269, $-0.0062] | -30.1% [-42.9%, -14.4%] |
| costNoCache | $0.1388 | $0.1215 | $0.1193 | $-0.0173 * (n=30) | [$-0.0320, $-0.0025] | -12.4% [-20.6%, -2.0%] | $0.0022 (n=30) | [$-0.0217, $0.0232] | +1.9% [-15.3%, +22.5%] |
| wallSec | 39.8 | 38.7 | 45.3 | -1.1 (n=30) | [-3.6, 1.4] | -2.8% [-8.8%, +3.8%] | -6.6 (n=30) | [-17.3, 1.5] | -14.6% [-30.0%, +4.1%] |

Top 5 costBilled swings after − before: r3hb-composer-11 (hard) $0.0523→$0.0271; r3-typedoc-10 (easy) $0.0220→$0.0462; r3hb-drogon-01 (hard) $0.0723→$0.0511; r3-zipkin-20 (easy) $0.0499→$0.0297; r3hb-composer-07 (hard) $0.0796→$0.0646
Top 5 score swings after − before: r3h-ocelot-24 (hard) 0.500→1.000; r3h-typedoc-16 (hard) 0.700→0.500; r3-ocelot-03 (easy) 0.850→1.000; r3-dgraph-29 (easy) 0.800→0.950; r3-zipkin-02 (easy) 0.875→1.000
Top 5 costBilled swings after − native: r3hb-composer-07 (hard) $0.2077→$0.0646; r3-ocelot-03 (easy) $0.1041→$0.0538; r3h-jj-09 (hard) $0.0949→$0.0464; r3hb-composer-11 (hard) $0.0692→$0.0271; r3h-tortoise-orm-06 (hard) $0.0660→$0.0365
Top 5 score swings after − native: r3hb-composer-07 (hard) 0.880→0.600; r3-jj-09 (easy) 1.000→0.825; r3-typedoc-15 (easy) 0.700→0.875; r3h-typedoc-16 (hard) 0.675→0.500; r3-zipkin-02 (easy) 0.850→1.000
Captures: core/prompt-optimization/data/results/r282-oc-sol61-high-final-r1/captures, core/prompt-optimization/data/results/r282-oc-sol61-high-final-r2/captures (<arm>.<id>.json; arm sweet = after)

wrote /Users/admin/.ss-eval/final-run/report-final.json
