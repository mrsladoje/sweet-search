# Agent time from tokens and turns (ho1005)

Unit = question (mean over reps). 95% question-clustered bootstrap, stratified by tier. `*` = interval excludes 0.
Modelled LLM time uses ONE coefficient set per cell for both arms, so its sweet − native difference comes from tokens and turns only.

## cc-sonnet55-high

traces matched 1200, missing 0 (tokens+time 1200); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.82): 1.08 s per turn · 42.8 ms per 1k prefill tokens · 0.00 ms per 1k cache-read tokens · decode 169 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 4.6 | 5.5 | -0.9 * | [-1.1, -0.8] | -17.0% [-19.6%, -14.4%] |
| tool calls | 4.2 | 4.9 | -0.7 * | [-0.9, -0.5] | -14.1% [-17.8%, -10.4%] |
| prefill tokens (uncached + cache write) | 9717 | 9518 | 199 | [-34, 441] | +2.1% [-0.4%, +4.7%] |
| cache-read tokens | 111445 | 136838 | -25393 * | [-29626, -21114] | -18.6% [-21.4%, -15.5%] |
| decode tokens (output + reasoning) | 1212 | 1236 | -25 | [-60, 12] | -2.0% [-4.8%, +1.0%] |
| of which reasoning | 81 | 73 | 7 | [-1, 15] | +9.7% [-1.1%, +20.4%] |
| LLM time, modelled from tokens + turns (s) | 12.52 | 13.67 | -1.15 * | [-1.50, -0.81] | -8.4% [-10.9%, -5.9%] |
|   · from turns (s) | 4.94 | 5.96 | -1.01 * | [-1.18, -0.85] | -17.0% [-19.6%, -14.4%] |
|   · from prefill (s) | 0.42 | 0.41 | 0.01 | [-0.00, 0.02] | +2.1% [-0.4%, +4.7%] |
|   · from cache read (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from decode (s) | 7.16 | 7.30 | -0.15 | [-0.36, 0.07] | -2.0% [-4.8%, +1.0%] |
| LLM time, measured (s) | 12.70 | 13.57 | -0.87 * | [-1.30, -0.44] | -6.4% [-9.5%, -3.2%] |
| tool time, bench-measured, contended (s) | 0.72 | 0.33 | 0.39 * | [0.22, 0.52] | +118.2% [+45.4%, +202.5%] |
| tool time per call, bench (s) | 0.19 | 0.07 | 0.12 * | [0.07, 0.15] | +160.0% [+65.5%, +275.8%] |
| harness start/stop (s) | 0.28 | 0.55 | -0.27 * | [-0.58, -0.03] | -48.3% [-67.1%, -10.8%] |
| wall time, bench (s) | 13.71 | 14.45 | -0.75 * | [-1.36, -0.18] | -5.2% [-9.2%, -1.3%] |

break-even: sweet stays faster while its mean tool time per call is below 0.35 s (bench-measured, contended: 0.19 s).

## cc-opus55-medium

traces matched 1200, missing 0 (tokens+time 1200); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.79): 0.71 s per turn · 0.0 ms per 1k prefill tokens · 29.29 ms per 1k cache-read tokens · decode 118 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 4.0 | 4.8 | -0.9 * | [-1.0, -0.7] | -17.8% [-20.2%, -15.3%] |
| tool calls | 3.0 | 3.9 | -0.9 * | [-1.0, -0.7] | -22.8% [-25.8%, -19.8%] |
| prefill tokens (uncached + cache write) | 7664 | 8341 | -677 * | [-868, -489] | -8.1% [-10.3%, -5.9%] |
| cache-read tokens | 70149 | 75041 | -4892 * | [-7414, -2431] | -6.5% [-9.7%, -3.3%] |
| decode tokens (output + reasoning) | 1034 | 1198 | -164 * | [-192, -136] | -13.7% [-15.9%, -11.5%] |
| of which reasoning | 101 | 82 | 19 * | [12, 26] | +23.4% [+14.7%, +32.8%] |
| LLM time, modelled from tokens + turns (s) | 13.61 | 15.74 | -2.14 * | [-2.51, -1.77] | -13.6% [-15.8%, -11.4%] |
|   · from turns (s) | 2.82 | 3.43 | -0.61 * | [-0.70, -0.52] | -17.8% [-20.2%, -15.3%] |
|   · from prefill (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from cache read (s) | 2.05 | 2.20 | -0.14 * | [-0.22, -0.07] | -6.5% [-9.7%, -3.3%] |
|   · from decode (s) | 8.73 | 10.12 | -1.38 * | [-1.62, -1.15] | -13.7% [-15.9%, -11.5%] |
| LLM time, measured (s) | 13.82 | 15.63 | -1.81 * | [-2.31, -1.34] | -11.6% [-14.4%, -8.7%] |
| tool time, bench-measured, contended (s) | 0.63 | 0.31 | 0.32 * | [0.26, 0.39] | +105.3% [+81.4%, +134.3%] |
| tool time per call, bench (s) | 0.22 | 0.09 | 0.13 * | [0.11, 0.16] | +154.2% [+117.0%, +199.8%] |
| harness start/stop (s) | 0.29 | 0.28 | 0.01 * | [0.00, 0.01] | +2.9% [+1.8%, +4.1%] |
| wall time, bench (s) | 14.74 | 16.22 | -1.48 * | [-1.99, -0.99] | -9.1% [-12.0%, -6.2%] |

break-even: sweet stays faster while its mean tool time per call is below 0.82 s (bench-measured, contended: 0.22 s).

## cc-opus55-high

traces matched 1200, missing 0 (tokens+time 1200); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.75): 0.67 s per turn · 31.3 ms per 1k prefill tokens · 28.27 ms per 1k cache-read tokens · decode 116 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 4.2 | 5.1 | -0.9 * | [-1.0, -0.8] | -17.7% [-20.1%, -15.2%] |
| tool calls | 3.2 | 4.2 | -1.0 * | [-1.1, -0.8] | -22.8% [-25.6%, -19.8%] |
| prefill tokens (uncached + cache write) | 8334 | 9124 | -790 * | [-1000, -582] | -8.7% [-10.8%, -6.5%] |
| cache-read tokens | 76643 | 82221 | -5578 * | [-8168, -2862] | -6.8% [-9.8%, -3.5%] |
| decode tokens (output + reasoning) | 1187 | 1359 | -172 * | [-202, -142] | -12.6% [-14.8%, -10.5%] |
| of which reasoning | 165 | 125 | 40 * | [31, 51] | +32.3% [+24.4%, +41.0%] |
| LLM time, modelled from tokens + turns (s) | 15.48 | 17.75 | -2.27 * | [-2.65, -1.87] | -12.8% [-14.9%, -10.7%] |
|   · from turns (s) | 2.83 | 3.45 | -0.61 * | [-0.70, -0.52] | -17.7% [-20.1%, -15.2%] |
|   · from prefill (s) | 0.26 | 0.29 | -0.02 * | [-0.03, -0.02] | -8.7% [-10.8%, -6.5%] |
|   · from cache read (s) | 2.17 | 2.32 | -0.16 * | [-0.23, -0.08] | -6.8% [-9.8%, -3.5%] |
|   · from decode (s) | 10.22 | 11.69 | -1.48 * | [-1.73, -1.22] | -12.6% [-14.8%, -10.5%] |
| LLM time, measured (s) | 15.92 | 17.51 | -1.59 * | [-2.12, -1.05] | -9.1% [-12.0%, -6.0%] |
| tool time, bench-measured, contended (s) | 0.66 | 0.32 | 0.34 * | [0.28, 0.41] | +107.1% [+84.6%, +134.1%] |
| tool time per call, bench (s) | 0.21 | 0.08 | 0.13 * | [0.11, 0.16] | +171.3% [+138.3%, +213.2%] |
| harness start/stop (s) | 0.29 | 0.28 | 0.01 * | [0.01, 0.01] | +2.8% [+1.9%, +3.7%] |
| wall time, bench (s) | 16.87 | 18.11 | -1.24 * | [-1.79, -0.69] | -6.9% [-9.8%, -3.9%] |

break-even: sweet stays faster while its mean tool time per call is below 0.80 s (bench-measured, contended: 0.21 s).

## codex-sol61-high

traces matched 1200, missing 0 (tokens+time 1200); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.83): 1.79 s per turn · 0.0 ms per 1k prefill tokens · 38.00 ms per 1k cache-read tokens · decode 35 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 5.5 | 4.4 | 1.0 * | [0.9, 1.2] | +23.5% [+19.5%, +27.7%] |
| tool calls | 4.4 | 4.4 | 0.0 | [-0.2, 0.2] | +0.6% [-3.7%, +5.2%] |
| prefill tokens (uncached + cache write) | 13145 | 16111 | -2966 * | [-3648, -2296] | -18.4% [-22.0%, -14.7%] |
| cache-read tokens | 96718 | 72580 | 24138 * | [20480, 27896] | +33.3% [+28.0%, +38.6%] |
| decode tokens (output + reasoning) | 733 | 740 | -8 | [-25, 10] | -1.1% [-3.4%, +1.4%] |
| of which reasoning | 158 | 86 | 72 * | [62, 83] | +83.7% [+68.7%, +101.1%] |
| LLM time, modelled from tokens + turns (s) | 34.65 | 32.09 | 2.56 * | [1.75, 3.39] | +8.0% [+5.4%, +10.7%] |
|   · from turns (s) | 9.82 | 7.94 | 1.87 * | [1.55, 2.20] | +23.5% [+19.5%, +27.7%] |
|   · from prefill (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from cache read (s) | 3.68 | 2.76 | 0.92 * | [0.78, 1.06] | +33.3% [+28.0%, +38.6%] |
|   · from decode (s) | 21.16 | 21.38 | -0.23 | [-0.73, 0.29] | -1.1% [-3.4%, +1.4%] |
| LLM time, measured (s) | 35.03 | 31.91 | 3.12 * | [2.24, 4.02] | +9.8% [+7.0%, +12.7%] |
| tool time, bench-measured, contended (s) | 3.21 | 0.37 | 2.84 * | [1.95, 3.91] | +767.7% [+537.0%, +1032.7%] |
| tool time per call, bench (s) | 0.70 | 0.09 | 0.61 * | [0.42, 0.83] | +693.5% [+491.0%, +908.5%] |
| harness start/stop (s) | 0.85 | 0.93 | -0.08 | [-0.25, 0.04] | -8.8% [-22.4%, +4.5%] |
| wall time, bench (s) | 39.09 | 33.21 | 5.88 * | [4.42, 7.46] | +17.7% [+13.4%, +22.4%] |

break-even: none — sweet's modelled LLM time alone exceeds native's LLM + tool time, so sweet is slower on this cell at any tool speed (bench-measured sweet tool time per call: 0.70 s).

## oc-sol61-high

traces matched 1200, missing 0 (sessionID 1200); rollouts with subagents: sweet 0, native 109 (parallel subagent pairs 0)
fit (R² 0.91): 2.72 s per turn · 40.2 ms per 1k prefill tokens · 47.43 ms per 1k cache-read tokens · decode 40 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 5.5 | 5.7 | -0.2 | [-0.5, 0.0] | -4.0% [-8.8%, +0.9%] |
| tool calls | 7.5 | 11.2 | -3.7 * | [-4.7, -2.8] | -33.1% [-37.9%, -27.8%] |
| prefill tokens (uncached + cache write) | 9272 | 20861 | -11589 * | [-13584, -9891] | -55.6% [-59.1%, -51.8%] |
| cache-read tokens | 47641 | 53242 | -5601 | [-15507, 2004] | -10.5% [-24.2%, +4.5%] |
| decode tokens (output + reasoning) | 699 | 1378 | -678 * | [-863, -516] | -49.2% [-54.2%, -43.4%] |
| of which reasoning | 105 | 92 | 14 | [-2, 28] | +14.8% [-1.5%, +36.9%] |
| LLM time, modelled from tokens + turns (s) | 35.19 | 53.62 | -18.43 * | [-24.23, -13.34] | -34.4% [-40.2%, -27.9%] |
|   · from turns (s) | 14.97 | 15.60 | -0.63 | [-1.45, 0.14] | -4.0% [-8.8%, +0.9%] |
|   · from prefill (s) | 0.37 | 0.84 | -0.47 * | [-0.55, -0.40] | -55.6% [-59.1%, -51.8%] |
|   · from cache read (s) | 2.26 | 2.53 | -0.27 | [-0.74, 0.10] | -10.5% [-24.2%, +4.5%] |
|   · from decode (s) | 17.59 | 34.66 | -17.07 * | [-21.71, -12.97] | -49.2% [-54.2%, -43.4%] |
| LLM time, modelled, rollouts without subagents (s) | 35.19 | 34.71 | -1.49 * | [-2.62, -0.44] | -4.3% [-7.4%, -1.3%] |
| LLM time, measured (s) | 35.85 | 53.25 | -17.40 * | [-23.25, -12.33] | -32.7% [-38.6%, -26.1%] |
| tool time, bench-measured, contended, lower bound (s) | 0.02 | 0.12 | -0.10 * | [-0.11, -0.09] | -82.4% [-83.5%, -81.2%] |
| tool time per call, bench, lower bound (s) | 0.00 | 0.01 | -0.01 * | [-0.01, -0.01] | -76.3% [-77.3%, -75.1%] |
| tool time, upper bound incl. writing the command (s) | 3.51 | 2.82 | 0.69 * | [0.45, 0.93] | +24.3% [+14.9%, +34.9%] |
| tool time per call, upper bound (s) | 0.64 | 0.46 | 0.18 * | [0.13, 0.23] | +38.7% [+26.0%, +54.0%] |
| harness start/stop (s) | 1.00 | 0.97 | 0.03 * | [0.01, 0.05] | +3.3% [+1.4%, +5.6%] |
| wall time, bench (s) | 36.88 | 54.34 | -17.46 * | [-23.32, -12.40] | -32.1% [-38.0%, -25.6%] |

break-even: sweet stays faster while its mean tool time per call is below 2.49 s (bench-measured, contended: 0.00–0.64 s).

Held-out: aggregates only (no per-question value).
wrote core/prompt-optimization/data/final-run/latency-ho1005.json
