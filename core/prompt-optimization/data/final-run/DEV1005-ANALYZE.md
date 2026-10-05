# Final comparison (dev1005) — before vs after vs native

Unit = question (mean over reps). Intervals: 95% question-clustered bootstrap, stratified by tier for "pooled". `*` = interval excludes 0.

## cc-opus55-medium

rows 90 (ok 90, failed attempts 0) from r282-cc-opus55-medium-dev1005-r1, r282-cc-opus55-medium-dev1005-r2
- after: code c4cbf49f | index c4cbf49f | gutter none | harness 2.1.281 (Claude Code)
- native: code c4cbf49f | index — | gutter — | harness 2.1.281 (Claude Code)
- cache fairness r282-cc-opus55-medium-dev1005-r2: incomplete
- ok rollouts per arm × rep: after r1=30 r2=30; native r1=30

### easy (12 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.971 | 0.942 | — | — | — | 0.029 (n=12) | [-0.035, 0.100] | +3.1% [-3.6%, +11.1%] |
| calls | — | 2.5 | 4.2 | — | — | — | -1.7 * (n=12) | [-2.3, -1.0] | -40.0% [-52.3%, -24.5%] |
| costBilled | — | $0.0712 | $0.0780 | — | — | — | $-0.0068 (n=12) | [$-0.0157, $0.0015] | -8.8% [-20.0%, +1.9%] |
| costNoCache | — | $0.2914 | $0.3779 | — | — | — | $-0.0866 * (n=12) | [$-0.1359, $-0.0281] | -22.9% [-35.2%, -7.4%] |
| wallSec | — | 12.1 | 14.2 | — | — | — | -2.1 (n=12) | [-5.8, 0.7] | -15.0% [-34.4%, +5.1%] |

### hard (18 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.841 | 0.847 | — | — | — | -0.006 (n=18) | [-0.056, 0.048] | -0.7% [-6.4%, +6.1%] |
| calls | — | 3.2 | 4.1 | — | — | — | -0.9 (n=18) | [-1.9, 0.0] | -21.2% [-39.3%, +0.0%] |
| costBilled | — | $0.0858 | $0.0866 | — | — | — | $-0.0008 (n=18) | [$-0.0117, $0.0093] | -0.9% [-13.3%, +10.8%] |
| costNoCache | — | $0.3672 | $0.3866 | — | — | — | $-0.0194 (n=18) | [$-0.1053, $0.0590] | -5.0% [-24.0%, +16.6%] |
| wallSec | — | 16.7 | 16.4 | — | — | — | 0.3 (n=18) | [-2.5, 3.0] | +1.7% [-14.9%, +19.2%] |

### pooled (30 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.893 | 0.885 | — | — | — | 0.008 (n=30) | [-0.032, 0.051] | +0.9% [-3.5%, +6.0%] |
| calls | — | 2.9 | 4.1 | — | — | — | -1.2 * (n=30) | [-1.8, -0.6] | -28.9% [-40.8%, -15.7%] |
| costBilled | — | $0.0800 | $0.0832 | — | — | — | $-0.0032 (n=30) | [$-0.0105, $0.0036] | -3.8% [-12.5%, +4.4%] |
| costNoCache | — | $0.3369 | $0.3832 | — | — | — | $-0.0463 (n=30) | [$-0.1013, $0.0054] | -12.1% [-24.6%, +1.4%] |
| wallSec | — | 14.8 | 15.5 | — | — | — | -0.7 (n=30) | [-2.9, 1.3] | -4.4% [-17.3%, +9.0%] |

Top 5 costBilled swings after − before: 
Top 5 score swings after − before: 
Top 5 costBilled swings after − native: r3h-typedoc-23 (hard) $0.1128→$0.0501; r3-tortoise-orm-36 (easy) $0.0906→$0.0505; r3h-jj-09 (hard) $0.0926→$0.1213; r3h-dgraph-21 (hard) $0.0815→$0.1075; r3-typedoc-15 (easy) $0.0701→$0.0443
Top 5 score swings after − native: r3h-dgraph-21 (hard) 0.550→0.863; r3-ocelot-03 (easy) 0.700→1.000; r3-dgraph-29 (easy) 1.000→0.775; r3hb-composer-07 (hard) 0.800→0.600; r3h-jj-12 (hard) 1.000→0.800
Captures: core/prompt-optimization/data/results/r282-cc-opus55-medium-dev1005-r1/captures, core/prompt-optimization/data/results/r282-cc-opus55-medium-dev1005-r2/captures (<arm>.<id>.json; arm sweet = after)

## codex-sol61-high

rows 90 (ok 90, failed attempts 0) from r282-codex-sol61-high-dev1005-r1, r282-codex-sol61-high-dev1005-r2
- native: code c4cbf49f | index — | gutter — | harness codex-cli 0.159.2
- after: code c4cbf49f | index c4cbf49f | gutter none | harness codex-cli 0.159.2
- cache fairness r282-codex-sol61-high-dev1005-r1: warning
- cache fairness r282-codex-sol61-high-dev1005-r2: incomplete
- ok rollouts per arm × rep: native r1=30; after r1=30 r2=30

### easy (12 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.952 | 0.963 | — | — | — | -0.010 (n=12) | [-0.065, 0.046] | -1.1% [-6.7%, +5.0%] |
| calls | — | 3.8 | 3.8 | — | — | — | 0.1 (n=12) | [-0.6, 0.7] | +2.2% [-16.0%, +20.6%] |
| costBilled | — | $0.0395 | $0.0386 | — | — | — | $0.0009 (n=12) | [$-0.0028, $0.0044] | +2.4% [-6.7%, +12.4%] |
| costNoCache | — | $0.1765 | $0.1587 | — | — | — | $0.0178 (n=12) | [$-0.0090, $0.0494] | +11.2% [-5.9%, +31.0%] |
| wallSec | — | 35.2 | 25.8 | — | — | — | 9.4 * (n=12) | [5.6, 12.9] | +36.5% [+22.8%, +47.9%] |

### hard (18 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.755 | 0.751 | — | — | — | 0.003 (n=18) | [-0.045, 0.051] | +0.4% [-5.5%, +7.5%] |
| calls | — | 5.3 | 4.9 | — | — | — | 0.4 (n=18) | [-0.5, 1.3] | +9.1% [-9.8%, +30.8%] |
| costBilled | — | $0.0599 | $0.0504 | — | — | — | $0.0096 * (n=18) | [$0.0017, $0.0168] | +19.0% [+3.1%, +36.2%] |
| costNoCache | — | $0.2571 | $0.1937 | — | — | — | $0.0634 * (n=18) | [$0.0265, $0.0977] | +32.8% [+12.9%, +52.8%] |
| wallSec | — | 53.5 | 39.3 | — | — | — | 14.2 * (n=18) | [7.9, 20.9] | +36.2% [+20.5%, +52.4%] |

### pooled (30 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.834 | 0.836 | — | — | — | -0.002 (n=30) | [-0.038, 0.035] | -0.3% [-4.4%, +4.4%] |
| calls | — | 4.7 | 4.4 | — | — | — | 0.3 (n=30) | [-0.4, 0.9] | +6.8% [-7.4%, +22.0%] |
| costBilled | — | $0.0518 | $0.0457 | — | — | — | $0.0061 * (n=30) | [$0.0011, $0.0108] | +13.4% [+2.2%, +25.0%] |
| costNoCache | — | $0.2249 | $0.1797 | — | — | — | $0.0452 * (n=30) | [$0.0204, $0.0695] | +25.1% [+11.0%, +39.2%] |
| wallSec | — | 46.2 | 33.9 | — | — | — | 12.3 * (n=30) | [8.2, 16.6] | +36.3% [+24.5%, +48.1%] |

Top 5 costBilled swings after − before: 
Top 5 score swings after − before: 
Top 5 costBilled swings after − native: r3hb-okhttp-12 (hard) $0.0364→$0.0790; r3h-zipkin-23 (hard) $0.0805→$0.0435; r3hb-drogon-01 (hard) $0.0592→$0.0830; r3hb-grdb-07 (hard) $0.0579→$0.0811; r3h-tortoise-orm-03 (hard) $0.0406→$0.0617
Top 5 score swings after − native: r3h-dgraph-12 (hard) 0.900→0.700; r3hb-okhttp-12 (hard) 0.800→1.000; r3-typedoc-15 (easy) 0.800→1.000; r3h-tortoise-orm-03 (hard) 1.000→0.813; r3-jj-09 (easy) 1.000→0.825
Captures: core/prompt-optimization/data/results/r282-codex-sol61-high-dev1005-r1/captures, core/prompt-optimization/data/results/r282-codex-sol61-high-dev1005-r2/captures (<arm>.<id>.json; arm sweet = after)

## oc-sol61-high

rows 90 (ok 90, failed attempts 0) from r282-oc-sol61-high-dev1005-r1, r282-oc-sol61-high-dev1005-r2
- after: code c4cbf49f | index c4cbf49f | gutter none | harness 1.18.4
- native: code c4cbf49f | index — | gutter — | harness 1.18.4
- cache fairness r282-oc-sol61-high-dev1005-r1: warning
- cache fairness r282-oc-sol61-high-dev1005-r2: incomplete
- ok rollouts per arm × rep: after r1=30 r2=30; native r1=30

### easy (12 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.963 | 0.975 | — | — | — | -0.012 (n=12) | [-0.056, 0.029] | -1.3% [-5.7%, +3.2%] |
| calls | — | 3.7 | 6.6 | — | — | — | -2.9 * (n=12) | [-4.6, -1.3] | -43.7% [-58.2%, -27.5%] |
| costBilled | — | $0.0301 | $0.0494 | — | — | — | $-0.0194 * (n=12) | [$-0.0303, $-0.0107] | -39.2% [-54.2%, -24.8%] |
| costNoCache | — | $0.0808 | $0.0922 | — | — | — | $-0.0113 (n=12) | [$-0.0360, $0.0121] | -12.3% [-36.3%, +13.8%] |
| wallSec | — | 33.8 | 42.1 | — | — | — | -8.2 (n=12) | [-21.7, 2.1] | -19.6% [-42.7%, +6.3%] |

### hard (18 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.794 | 0.831 | — | — | — | -0.036 (n=18) | [-0.108, 0.026] | -4.3% [-12.7%, +3.4%] |
| calls | — | 9.6 | 11.7 | — | — | — | -2.1 (n=18) | [-5.6, 0.8] | -17.8% [-35.0%, +9.0%] |
| costBilled | — | $0.0456 | $0.0721 | — | — | — | $-0.0265 * (n=18) | [$-0.0422, $-0.0136] | -36.8% [-46.3%, -23.8%] |
| costNoCache | — | $0.1393 | $0.1460 | — | — | — | $-0.0067 (n=18) | [$-0.0441, $0.0238] | -4.6% [-22.8%, +21.0%] |
| wallSec | — | 50.1 | 64.7 | — | — | — | -14.6 (n=18) | [-37.0, 3.2] | -22.6% [-40.7%, +7.4%] |

### pooled (30 questions)

| metric | before | after | native | after − before | 95% CI | rel | after − native | 95% CI | rel |
|---|---|---|---|---|---|---|---|---|---|
| score | — | 0.862 | 0.888 | — | — | — | -0.027 (n=30) | [-0.074, 0.014] | -3.0% [-8.2%, +1.7%] |
| calls | — | 7.3 | 9.7 | — | — | — | -2.4 * (n=30) | [-4.7, -0.6] | -24.8% [-37.5%, -7.9%] |
| costBilled | — | $0.0394 | $0.0630 | — | — | — | $-0.0237 * (n=30) | [$-0.0340, $-0.0150] | -37.5% [-45.6%, -27.9%] |
| costNoCache | — | $0.1159 | $0.1245 | — | — | — | $-0.0086 (n=30) | [$-0.0327, $0.0119] | -6.9% [-21.7%, +11.2%] |
| wallSec | — | 43.6 | 55.7 | — | — | — | -12.1 * (n=30) | [-26.7, -0.3] | -21.7% [-37.0%, -0.6%] |

Top 5 costBilled swings after − before: 
Top 5 score swings after − before: 
Top 5 costBilled swings after − native: r3hb-composer-07 (hard) $0.2108→$0.0892; r3hb-composer-11 (hard) $0.1200→$0.0455; r3hb-drogon-01 (hard) $0.1381→$0.0669; r3-tortoise-orm-36 (easy) $0.0838→$0.0200; r3-dgraph-31 (easy) $0.0643→$0.0165
Top 5 score swings after − native: r3h-ocelot-24 (hard) 1.000→0.500; r3h-zipkin-22 (hard) 0.700→0.900; r3hb-composer-07 (hard) 0.750→0.575; r3hb-grdb-11 (hard) 0.750→0.900; r3-typedoc-15 (easy) 1.000→0.850
Captures: core/prompt-optimization/data/results/r282-oc-sol61-high-dev1005-r1/captures, core/prompt-optimization/data/results/r282-oc-sol61-high-dev1005-r2/captures (<arm>.<id>.json; arm sweet = after)

wrote /Users/admin/.ss-eval/dev1005/report-dev1005.json
