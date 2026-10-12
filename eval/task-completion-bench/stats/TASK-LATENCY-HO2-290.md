# Task bench (HO2-290, held-out-2, 200 tasks) — agent time from tokens and turns

Unit = task (one rollout per arm). 95% task-level bootstrap. `*` = interval excludes 0.
Modelled LLM time uses ONE coefficient set per leg for both arms, so its sweet − native difference comes from tokens and turns only.
Tool time is bench-measured under concurrency (and Rosetta on the VM Sol legs): tests, builds and searches all ran contended.

final rows 400 (200 tasks) from 3 run dirs
## cc-sonnet55-high

traces matched 400, missing 0 (time 400); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.94): 1.23 s per turn · 0.0 ms per 1k prefill tokens · 2.38 ms per 1k cache-read tokens · decode 158 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 7.8 | 7.5 | 0.3 | [-0.2, 0.8] | +4.1% [-2.3%, +11.2%] |
| tool calls | 8.1 | 7.4 | 0.7 * | [0.1, 1.3] | +9.5% [+1.5%, +18.3%] |
| prefill tokens (uncached + cache write) | 16669 | 22161 | -5492 * | [-6867, -4050] | -24.8% [-29.8%, -18.7%] |
| cache-read tokens | 237281 | 254528 | -17247 | [-44471, 11530] | -6.8% [-16.6%, +4.7%] |
| decode tokens (output + reasoning) | 2987 | 2709 | 279 | [-20, 630] | +10.3% [-0.7%, +23.7%] |
| of which reasoning | 1037 | 936 | 101 | [-105, 362] | +10.8% [-10.6%, +39.9%] |
| LLM time, modelled from tokens + turns (s) | 29.00 | 26.90 | 2.09 | [-0.36, 4.89] | +7.8% [-1.3%, +18.5%] |
|   · from turns (s) | 9.55 | 9.18 | 0.37 | [-0.22, 1.00] | +4.1% [-2.3%, +11.2%] |
|   · from prefill (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from cache read (s) | 0.56 | 0.61 | -0.04 | [-0.11, 0.03] | -6.8% [-16.6%, +4.7%] |
|   · from decode (s) | 18.88 | 17.12 | 1.76 | [-0.13, 3.98] | +10.3% [-0.7%, +23.7%] |
| LLM time, measured (s) | 28.81 | 27.10 | 1.71 | [-1.00, 4.74] | +6.3% [-3.5%, +18.1%] |
| tool time, bench-measured, contended (s) | 94.98 | 89.92 | 5.06 | [-9.03, 20.98] | +5.6% [-9.4%, +24.9%] |
| tool time per call, bench (s) | 11.55 | 10.96 | 0.59 | [-0.75, 2.17] | +5.4% [-6.9%, +19.5%] |
|   calls: sweet search (ss-*) | 1.8 | 0.0 | 1.8 * | [1.6, 2.0] | — [—, —] |
|   time: sweet search (ss-*) (s) | 3.42 | 0.00 | 3.42 * | [0.37, 9.47] | — [—, —] |
|   calls: native search (grep/rg/find/Glob) | 1.4 | 3.2 | -1.7 * | [-2.0, -1.4] | -54.4% [-62.8%, -45.1%] |
|   time: native search (grep/rg/find/Glob) (s) | 2.68 | 1.63 | 1.05 | [-2.21, 5.36] | +64.6% [-95.6%, +879.9%] |
|   calls: native read (cat/Read) | 2.1 | 1.4 | 0.6 * | [0.4, 0.9] | +43.6% [+24.9%, +66.5%] |
|   time: native read (cat/Read) (s) | 14.30 | 11.75 | 2.55 | [-4.19, 9.29] | +21.7% [-25.5%, +159.3%] |
|   calls: edit | 0.6 | 0.4 | 0.2 * | [0.0, 0.3] | +43.7% [+2.5%, +106.3%] |
|   time: edit (s) | 0.01 | 0.01 | 0.01 * | [0.00, 0.01] | +64.2% [+13.8%, +142.4%] |
|   calls: tests and builds | 1.8 | 1.8 | 0.0 | [-0.2, 0.2] | +0.3% [-12.7%, +14.4%] |
|   time: tests and builds (s) | 73.88 | 76.22 | -2.34 | [-19.88, 16.05] | -3.1% [-22.8%, +23.3%] |
|   calls: other shell | 0.4 | 0.6 | -0.2 * | [-0.3, -0.1] | -31.5% [-46.8%, -12.8%] |
|   time: other shell (s) | 1.04 | 0.31 | 0.73 | [-0.38, 2.38] | +234.6% [-84.7%, +1984.4%] |
| harness start/stop (s) | 10.67 | 7.93 | 2.74 | [-0.46, 6.08] | +34.5% [-5.0%, +92.4%] |
| wall time, bench (s) | 134.46 | 124.96 | 9.50 | [-6.47, 27.01] | +7.6% [-4.7%, +23.2%] |

break-even (search + read calls: ss, nativeGrep, nativeRead; other tool time at its bench value): sweet stays faster while its mean tool time per call is below 2.49 s (bench-measured, contended: 2.69 s).

final rows 400 (200 tasks) from 1 run dirs
## cc-opus55-medium

traces matched 400, missing 0 (time 400); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.93): 0.54 s per turn · 167.7 ms per 1k prefill tokens · 0.90 ms per 1k cache-read tokens · decode 116 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 8.6 | 8.2 | 0.4 | [-0.0, 0.8] | +4.4% [-0.5%, +10.0%] |
| tool calls | 8.2 | 7.4 | 0.8 * | [0.3, 1.3] | +10.5% [+4.4%, +17.6%] |
| prefill tokens (uncached + cache write) | 16131 | 18847 | -2716 * | [-3552, -1859] | -14.4% [-18.3%, -10.1%] |
| cache-read tokens | 214324 | 190424 | 23900 * | [8196, 42087] | +12.6% [+4.2%, +22.6%] |
| decode tokens (output + reasoning) | 3275 | 3369 | -94 | [-306, 117] | -2.8% [-8.7%, +3.6%] |
| of which reasoning | 1070 | 1060 | 10 | [-131, 152] | +0.9% [-11.4%, +15.4%] |
| LLM time, modelled from tokens + turns (s) | 35.83 | 36.88 | -1.05 | [-3.14, 1.06] | -2.9% [-8.2%, +2.9%] |
|   · from turns (s) | 4.62 | 4.43 | 0.20 | [-0.02, 0.44] | +4.4% [-0.5%, +10.0%] |
|   · from prefill (s) | 2.71 | 3.16 | -0.46 * | [-0.60, -0.31] | -14.4% [-18.3%, -10.1%] |
|   · from cache read (s) | 0.19 | 0.17 | 0.02 * | [0.01, 0.04] | +12.6% [+4.2%, +22.6%] |
|   · from decode (s) | 28.31 | 29.12 | -0.81 | [-2.65, 1.02] | -2.8% [-8.7%, +3.6%] |
| LLM time, measured (s) | 35.98 | 36.57 | -0.58 | [-3.10, 1.92] | -1.6% [-8.0%, +5.5%] |
| tool time, bench-measured, contended (s) | 114.53 | 111.31 | 3.23 | [-13.35, 20.53] | +2.9% [-11.3%, +19.3%] |
| tool time per call, bench (s) | 12.43 | 13.68 | -1.24 | [-2.66, 0.04] | -9.1% [-17.6%, +0.3%] |
|   calls: sweet search (ss-*) | 3.2 | 0.0 | 3.2 * | [2.9, 3.5] | — [—, —] |
|   time: sweet search (ss-*) (s) | 0.74 | 0.00 | 0.74 * | [0.65, 0.83] | — [—, —] |
|   calls: native search (grep/rg/find/Glob) | 0.7 | 3.1 | -2.5 * | [-2.8, -2.3] | -79.4% [-85.7%, -72.3%] |
|   time: native search (grep/rg/find/Glob) (s) | 1.99 | 2.44 | -0.45 | [-1.79, 0.80] | -18.6% [-60.5%, +64.8%] |
|   calls: native read (cat/Read) | 0.7 | 1.3 | -0.6 * | [-0.8, -0.4] | -44.3% [-55.6%, -32.1%] |
|   time: native read (cat/Read) (s) | 8.94 | 9.20 | -0.26 | [-8.09, 8.49] | -2.8% [-77.8%, +213.8%] |
|   calls: edit | 0.7 | 0.1 | 0.6 * | [0.5, 0.7] | +513.0% [+318.9%, +957.1%] |
|   time: edit (s) | 0.02 | 0.00 | 0.02 * | [0.01, 0.02] | +560.3% [+337.6%, +1061.9%] |
|   calls: tests and builds | 2.4 | 2.3 | 0.1 | [-0.1, 0.4] | +5.8% [-6.0%, +18.7%] |
|   time: tests and builds (s) | 100.93 | 94.55 | 6.39 | [-9.78, 22.86] | +6.8% [-9.5%, +25.8%] |
|   calls: other shell | 0.5 | 0.6 | -0.1 | [-0.2, 0.1] | -10.9% [-33.8%, +20.0%] |
|   time: other shell (s) | 1.91 | 5.11 | -3.20 | [-10.65, 1.51] | -62.7% [-91.7%, +157.6%] |
| harness start/stop (s) | 13.06 | 6.44 | 6.62 | [-0.05, 15.79] | +102.7% [-0.7%, +270.7%] |
| wall time, bench (s) | 163.57 | 154.31 | 9.26 | [-11.06, 31.81] | +6.0% [-7.0%, +20.8%] |

break-even (search + read calls: ss, nativeGrep, nativeRead; other tool time at its bench value): sweet stays faster while its mean tool time per call is below 2.07 s (bench-measured, contended: 1.33 s).

final rows 400 (200 tasks) from 1 run dirs
## cc-opus55-high

traces matched 400, missing 0 (time 400); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.91): 0.80 s per turn · 76.3 ms per 1k prefill tokens · 0.00 ms per 1k cache-read tokens · decode 112 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 10.4 | 10.2 | 0.2 | [-0.3, 0.7] | +1.8% [-3.0%, +6.6%] |
| tool calls | 10.3 | 9.6 | 0.7 * | [0.1, 1.3] | +7.4% [+1.4%, +13.6%] |
| prefill tokens (uncached + cache write) | 19310 | 22945 | -3635 * | [-4488, -2811] | -15.8% [-19.3%, -12.3%] |
| cache-read tokens | 288160 | 265184 | 22977 * | [2571, 44412] | +8.7% [+1.0%, +16.9%] |
| decode tokens (output + reasoning) | 4723 | 5035 | -312 * | [-586, -31] | -6.2% [-11.5%, -0.6%] |
| of which reasoning | 1824 | 2020 | -196 * | [-372, -22] | -9.7% [-17.8%, -1.2%] |
| LLM time, modelled from tokens + turns (s) | 51.87 | 54.78 | -2.91 * | [-5.68, -0.08] | -5.3% [-10.3%, -0.2%] |
|   · from turns (s) | 8.32 | 8.18 | 0.15 | [-0.24, 0.54] | +1.8% [-3.0%, +6.6%] |
|   · from prefill (s) | 1.47 | 1.75 | -0.28 * | [-0.34, -0.21] | -15.8% [-19.3%, -12.3%] |
|   · from cache read (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from decode (s) | 42.07 | 44.85 | -2.78 * | [-5.22, -0.27] | -6.2% [-11.5%, -0.6%] |
| LLM time, measured (s) | 52.13 | 54.01 | -1.88 | [-5.21, 1.61] | -3.5% [-9.4%, +3.0%] |
| tool time, bench-measured, contended (s) | 114.75 | 108.38 | 6.38 | [-11.49, 23.61] | +5.9% [-9.9%, +23.1%] |
| tool time per call, bench (s) | 10.01 | 10.79 | -0.78 | [-2.06, 0.42] | -7.2% [-17.0%, +4.3%] |
|   calls: sweet search (ss-*) | 4.2 | 0.0 | 4.1 * | [3.8, 4.5] | +41400.0% [+10750.0%, +44600.0%] |
|   time: sweet search (ss-*) (s) | 0.95 | 0.00 | 0.94 * | [0.85, 1.04] | +56680.8% [+14683.5%, +61549.2%] |
|   calls: native search (grep/rg/find/Glob) | 0.5 | 3.9 | -3.4 * | [-3.7, -3.1] | -87.6% [-91.3%, -83.3%] |
|   time: native search (grep/rg/find/Glob) (s) | 5.24 | 14.88 | -9.65 * | [-19.95, -0.83] | -64.8% [-90.6%, -11.3%] |
|   calls: native read (cat/Read) | 0.8 | 1.7 | -0.9 * | [-1.1, -0.7] | -51.0% [-60.3%, -40.5%] |
|   time: native read (cat/Read) (s) | 7.66 | 8.91 | -1.25 | [-13.20, 10.41] | -14.0% [-89.8%, +443.6%] |
|   calls: edit | 1.4 | 0.3 | 1.0 * | [0.8, 1.3] | +307.4% [+200.0%, +483.0%] |
|   time: edit (s) | 0.04 | 0.01 | 0.03 * | [0.02, 0.03] | +318.8% [+211.7%, +492.2%] |
|   calls: tests and builds | 2.7 | 2.6 | 0.1 | [-0.2, 0.3] | +2.7% [-6.8%, +13.8%] |
|   time: tests and builds (s) | 99.13 | 76.42 | 22.71 * | [4.12, 43.94] | +29.7% [+5.2%, +62.0%] |
|   calls: other shell | 0.8 | 1.0 | -0.2 * | [-0.4, -0.1] | -20.9% [-33.9%, -6.0%] |
|   time: other shell (s) | 1.75 | 8.16 | -6.41 | [-15.32, 0.28] | -78.6% [-98.7%, +10.6%] |
| harness start/stop (s) | 6.55 | 6.39 | 0.16 | [-3.47, 3.06] | +2.5% [-37.1%, +71.1%] |
| wall time, bench (s) | 173.43 | 168.78 | 4.66 | [-15.58, 23.58] | +2.8% [-8.6%, +14.6%] |

break-even (search + read calls: ss, nativeGrep, nativeRead; other tool time at its bench value): sweet stays faster while its mean tool time per call is below 1.89 s (bench-measured, contended: 1.45 s).

final rows 400 (200 tasks) from 7 run dirs
## codex-sol61-high

traces matched 400, missing 0 (tokens 396, time (usage lost) 4); rollouts with subagents: sweet 0, native 0 (parallel subagent pairs 0)
fit (R² 0.83): 1.28 s per turn · 0.0 ms per 1k prefill tokens · 0.00 ms per 1k cache-read tokens · decode 28 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 9.8 | 17.4 | -7.6 * | [-9.4, -5.9] | -43.7% [-48.9%, -37.8%] |
| tool calls | 7.5 | 7.9 | -0.5 * | [-0.8, -0.2] | -6.1% [-9.9%, -2.0%] |
| prefill tokens (uncached + cache write) | 26522 | 35115 | -8593 * | [-10714, -6522] | -24.5% [-29.2%, -19.4%] |
| cache-read tokens | 219761 | 471711 | -251949 * | [-315998, -192872] | -53.4% [-58.6%, -47.2%] |
| decode tokens (output + reasoning) | 2323 | 2988 | -665 * | [-922, -432] | -22.3% [-28.4%, -15.7%] |
| of which reasoning | 894 | 1340 | -446 * | [-616, -294] | -33.3% [-41.1%, -24.6%] |
| LLM time, modelled from tokens + turns (s) | 94.95 | 128.28 | -33.32 * | [-44.21, -23.24] | -26.0% [-31.8%, -19.7%] |
|   · from turns (s) | 12.55 | 22.29 | -9.74 * | [-12.06, -7.58] | -43.7% [-48.9%, -37.8%] |
|   · from prefill (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from cache read (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from decode (s) | 82.40 | 105.99 | -23.59 * | [-32.69, -15.31] | -22.3% [-28.4%, -15.7%] |
| LLM time, measured (s) | 91.00 | 128.14 | -37.14 * | [-51.01, -24.28] | -29.0% [-36.3%, -20.5%] |
| tool time, bench-measured, contended (s) | 324.65 | 248.19 | 76.46 * | [54.56, 101.04] | +30.8% [+21.9%, +41.2%] |
| tool time per call, bench (s) | 39.94 | 29.61 | 10.33 * | [7.56, 13.17] | +34.9% [+25.5%, +45.0%] |
|   calls: sweet search (ss-*) | 1.1 | 0.0 | 1.1 * | [0.9, 1.2] | — [—, —] |
|   time: sweet search (ss-*) (s) | 0.29 | 0.00 | 0.29 * | [0.22, 0.37] | — [—, —] |
|   calls: native search (grep/rg/find/Glob) | 1.7 | 2.9 | -1.2 * | [-1.4, -1.0] | -41.3% [-47.6%, -34.8%] |
|   time: native search (grep/rg/find/Glob) (s) | 0.21 | 1.53 | -1.32 * | [-2.19, -0.59] | -86.3% [-91.8%, -73.0%] |
|   calls: native read (cat/Read) | 0.7 | 0.9 | -0.2 * | [-0.4, -0.1] | -23.9% [-37.1%, -8.2%] |
|   time: native read (cat/Read) (s) | 0.08 | 0.55 | -0.47 * | [-1.08, -0.01] | -85.4% [-93.5%, -6.3%] |
|   calls: edit | 1.4 | 1.1 | 0.3 * | [0.2, 0.4] | +32.1% [+21.9%, +43.5%] |
|   time: edit (s) | 0.14 | 0.60 | -0.46 | [-1.07, 0.00] | -76.4% [-89.3%, +0.9%] |
|   calls: tests and builds | 2.6 | 2.5 | 0.2 * | [0.1, 0.3] | +7.8% [+3.0%, +12.6%] |
|   time: tests and builds (s) | 317.67 | 57.19 | 260.48 * | [212.31, 310.80] | +455.4% [+382.9%, +528.9%] |
|   calls: other shell | 1.3 | 0.4 | 0.9 * | [0.6, 1.2] | +202.3% [+130.3%, +301.4%] |
|   time: other shell (s) | 0.18 | 0.80 | -0.62 | [-1.79, 0.14] | -77.8% [-91.3%, +359.2%] |
|   calls: wait on a running command (mostly tests/builds) | 0.0 | 8.7 | -8.7 * | [-10.3, -7.1] | -99.7% [-100.0%, -99.1%] |
|   time: wait on a running command (mostly tests/builds) (s) | 6.08 | 187.51 | -181.44 * | [-221.30, -143.78] | -96.8% [-100.0%, -89.1%] |
| harness start/stop (s) | 3.84 | 3.15 | 0.69 | [-1.42, 3.13] | +21.8% [-35.9%, +124.6%] |
| wall time, bench (s) | 419.49 | 379.49 | 40.00 * | [15.19, 66.56] | +10.5% [+3.9%, +18.1%] |

break-even (search + read calls: ss, nativeGrep, nativeRead; other tool time at its bench value): none — sweet's other time alone exceeds native's total, so sweet is slower on this cell at any search speed (bench-measured sweet time per call: 0.17 s).

final rows 400 (200 tasks) from 11 run dirs
## oc-sol61-high

traces matched 400, missing 0 (sessionID 400); rollouts with subagents: sweet 0, native 22 (parallel subagent pairs 0)
fit (R² 0.80): 3.99 s per turn · 0.0 ms per 1k prefill tokens · 0.00 ms per 1k cache-read tokens · decode 56 tokens/s

| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |
|---|---|---|---|---|---|
| turns (model requests) | 9.3 | 12.1 | -2.8 * | [-3.3, -2.2] | -22.9% [-26.2%, -19.4%] |
| tool calls | 21.0 | 24.2 | -3.2 * | [-4.8, -1.8] | -13.3% [-18.5%, -7.9%] |
| prefill tokens (uncached + cache write) | 29895 | 37200 | -7305 * | [-10303, -4529] | -19.6% [-25.7%, -13.2%] |
| cache-read tokens | 137335 | 190088 | -52753 * | [-66564, -39732] | -27.8% [-33.0%, -22.1%] |
| decode tokens (output + reasoning) | 2596 | 2884 | -287 * | [-534, -56] | -10.0% [-17.1%, -2.1%] |
| of which reasoning | 742 | 726 | 17 | [-76, 114] | +2.3% [-9.8%, +16.5%] |
| LLM time, modelled from tokens + turns (s) | 83.41 | 99.56 | -16.15 * | [-22.51, -10.27] | -16.2% [-21.2%, -10.9%] |
|   · from turns (s) | 37.29 | 48.34 | -11.05 * | [-13.26, -8.93] | -22.9% [-26.2%, -19.4%] |
|   · from prefill (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from cache read (s) | 0.00 | 0.00 | 0.00 | [0.00, 0.00] | — [—, —] |
|   · from decode (s) | 46.12 | 51.23 | -5.11 * | [-9.49, -1.00] | -10.0% [-17.1%, -2.1%] |
| LLM time, modelled, rollouts without subagents (s) | 83.41 | 80.95 | -3.42 * | [-6.50, -0.15] | -4.2% [-7.9%, -0.2%] |
| LLM time, measured (s) | 93.68 | 93.48 | 0.19 | [-6.64, 6.53] | +0.2% [-6.7%, +7.4%] |
| tool time, bench-measured, contended (s) | 304.66 | 317.37 | -12.71 | [-35.37, 10.44] | -4.0% [-10.7%, +3.5%] |
| tool time per call, bench (s) | 14.32 | 13.69 | 0.63 | [-0.36, 1.69] | +4.6% [-2.6%, +12.8%] |
|   calls: sweet search (ss-*) | 1.5 | 0.0 | 1.5 * | [1.3, 1.7] | — [—, —] |
|   time: sweet search (ss-*) (s) | 0.58 | 0.00 | 0.58 * | [0.47, 0.73] | — [—, —] |
|   calls: native search (grep/rg/find/Glob) | 2.6 | 4.4 | -1.8 * | [-2.4, -1.3] | -40.5% [-47.9%, -32.4%] |
|   time: native search (grep/rg/find/Glob) (s) | 0.38 | 0.41 | -0.03 | [-0.16, 0.14] | -8.4% [-36.0%, +35.0%] |
|   calls: native read (cat/Read) | 4.4 | 8.2 | -3.8 * | [-4.8, -2.9] | -45.9% [-51.6%, -39.6%] |
|   time: native read (cat/Read) (s) | 0.57 | 0.90 | -0.33 * | [-0.48, -0.19] | -36.4% [-46.8%, -23.8%] |
|   calls: edit | 1.6 | 1.7 | -0.1 | [-0.2, 0.0] | -6.5% [-12.6%, +0.0%] |
|   time: edit (s) | 4.22 | 11.10 | -6.88 * | [-8.43, -5.45] | -62.0% [-71.1%, -51.8%] |
|   calls: tests and builds | 2.5 | 2.6 | -0.0 | [-0.1, 0.1] | -1.2% [-5.0%, +2.8%] |
|   time: tests and builds (s) | 298.71 | 300.18 | -1.47 | [-23.62, 21.27] | -0.5% [-7.5%, +7.6%] |
|   calls: other shell | 8.3 | 7.2 | 1.1 * | [0.9, 1.4] | +15.4% [+11.7%, +19.3%] |
|   time: other shell (s) | 0.92 | 5.40 | -4.48 * | [-4.83, -4.14] | -83.0% [-86.4%, -78.4%] |
| harness start/stop (s) | 76.07 | 3.22 | 72.85 * | [70.72, 76.57] | +2260.1% [+2112.0%, +2430.5%] |
| wall time, bench (s) | 474.41 | 414.08 | 60.33 * | [34.92, 86.13] | +14.6% [+7.9%, +22.3%] |

break-even (search + read calls: ss, nativeGrep, nativeRead; other tool time at its bench value): sweet stays faster while its mean tool time per call is below 3.56 s (bench-measured, contended: 0.22 s).

Held-out: aggregates only (no per-task value).
wrote eval/task-completion-bench/stats/task-latency-ho2-290.json
