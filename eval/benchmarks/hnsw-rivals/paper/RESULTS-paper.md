# HNSW rivals paper: held-out results (frozen points)

Freeze: files of commit `4a0d884254` (2026-10-17T15:26:07Z), delta = 0.005, fractions [0.98, 0.99, 0.995], one-sided alpha 0.025, bootstrap 10000 resamples (seed 42). Latency = median over R rounds of the per-round median per-query time (one pinned core, warm page cache). Ratio = median over rounds of rival / median over rounds of ours (> 1: ours faster), 95% percentile interval from a bootstrap over rounds (10,000 resamples, seed 42). Meets f: the held-out point estimate of retained quality >= f / the one-sided 97.5% cluster-bootstrap bound of mean(Q_sys - f Q_exact) >= 0 (the dev selection rule, applied once to held-out).

## Summary at f = 0.98: ours vs the rival that was fastest on dev at f (its frozen point, held-out)

| CPU | Set | Model | Ours µs | Ours meets f (point / bound) | Rival (fastest on dev) | Rival µs | Rival meets f | rival/ours [95% CI] |
|---|---|---|---:|---|---|---:|---|---|
| amd | advtest | CodeRankEmbed | 86.3 | yes / no | faiss_bin_flat | 69.2 | no / no | 0.80 [0.79, 0.87] |
| amd | advtest | bge-base-en-v1.5 | 112.1 | yes / yes | faiss_ivfpq_fs | 103.7 | yes / yes | 0.93 [0.92, 0.94] |
| amd | advtest | jina-v2-base-code | 76.2 | yes / yes | faiss_hnsw_sq8 | 49.6 | yes / no | 0.65 [0.64, 0.66] |
| amd | csn1m | CodeRankEmbed | 190.2 | yes / yes | faiss_hnsw_sq8 | 537.5 | yes / yes | 2.83 [2.78, 2.88] |
| amd | csn1m | bge-base-en-v1.5 | 445.8 | yes / yes | faiss_hnsw_sq8 | 794.4 | yes / yes | 1.78 [1.50, 1.90] |
| amd | csn1m | jina-v2-base-code | 106.9 | yes / yes | faiss_hnsw_sq8 | 200.9 | yes / no | 1.88 [0.02, 1.92] |
| amd | d20k | CodeRankEmbed | 75.0 | yes / yes | faiss_bin_flat | 48.7 | yes / no | 0.65 [0.64, 0.77] |
| amd | d20k | bge-base-en-v1.5 | 122.7 | yes / yes | faiss_bin_flat | 110.6 | yes / yes | 0.90 [0.90, 0.92] |
| amd | d20k | jina-v2-base-code | 74.8 | yes / yes | usearch_i8 | 35.8 | yes / yes | 0.48 [0.48, 0.48] |
| amd | dall | CodeRankEmbed | 251.5 | yes / no | faiss_bin_flat | 254.8 | yes / no | 1.01 [1.00, 1.03] |
| amd | dall | bge-base-en-v1.5 | 326.7 | yes / no | faiss_ivfpq_fs | 403.5 | yes / yes | 1.24 [1.19, 1.28] |
| amd | dall | jina-v2-base-code | 248.3 | yes / yes | faiss_rabitq_hnsw | 95.1 | yes / yes | 0.38 [0.37, 0.40] |
| amd | fiqa | CodeRankEmbed | 219.8 | yes / no | faiss_ivfpq_fs | 70.5 | no / no | 0.32 [0.31, 0.34] |
| amd | fiqa | bge-base-en-v1.5 | 144.2 | yes / no | faiss_ivfpq_fs | 113.1 | yes / yes | 0.78 [0.77, 0.81] |
| amd | fiqa | jina-v2-base-code | 181.8 | yes / yes | faiss_rabitq_hnsw | 118.5 | no / no | 0.65 [0.64, 0.67] |
| amd | gcsn | CodeRankEmbed | 49.6 | yes / yes | faiss_bin_flat | 27.5 | yes / yes | 0.55 [0.54, 0.58] |
| amd | gcsn | bge-base-en-v1.5 | 65.9 | yes / yes | faiss_bin_flat | 56.6 | yes / yes | 0.86 [0.83, 0.89] |
| amd | gcsn | jina-v2-base-code | 49.8 | yes / yes | faiss_bin_flat | 26.3 | yes / yes | 0.53 [0.52, 0.53] |
| amd | quora | CodeRankEmbed | 72.6 | yes / yes | usearch_b1_rescore | 132.7 | yes / no | 1.83 [1.80, 1.87] |
| amd | quora | bge-base-en-v1.5 | 67.0 | yes / yes | faiss_hnsw_sq8 | 59.4 | yes / no | 0.89 [0.86, 0.91] |
| amd | quora | jina-v2-base-code | 67.2 | yes / yes | usearch_b1_rescore | 116.7 | yes / no | 1.74 [1.66, 1.79] |
| arm | advtest | CodeRankEmbed | 147.8 | yes / no | faiss_bin_flat | 94.7 | no / no | 0.64 [0.63, 0.65] |
| arm | advtest | bge-base-en-v1.5 | 218.9 | yes / yes | faiss_ivfpq_fs | 298.8 | yes / yes | 1.36 [1.36, 1.39] |
| arm | advtest | jina-v2-base-code | 130.9 | yes / yes | faiss_bin_flat | 94.6 | yes / yes | 0.72 [0.71, 0.74] |
| arm | csn1m | CodeRankEmbed | 501.4 | yes / yes | faiss_bin_hnsw | 1224.3 | yes / yes | 2.44 [2.11, 2.66] |
| arm | csn1m | bge-base-en-v1.5 | 1173.3 | yes / yes | faiss_hnsw_flat | 1875.7 | yes / yes | 1.60 [1.43, 1.81] |
| arm | csn1m | jina-v2-base-code | 263.0 | yes / yes | faiss_bin_hnsw | 309.5 | yes / yes | 1.18 [0.02, 1.35] |
| arm | d20k | CodeRankEmbed | 135.4 | yes / yes | faiss_bin_flat | 65.4 | yes / no | 0.48 [0.48, 0.51] |
| arm | d20k | bge-base-en-v1.5 | 225.5 | yes / yes | faiss_bin_flat | 155.5 | yes / yes | 0.69 [0.66, 0.74] |
| arm | d20k | jina-v2-base-code | 131.7 | yes / yes | faiss_bin_flat | 62.7 | yes / yes | 0.48 [0.47, 0.48] |
| arm | dall | CodeRankEmbed | 386.5 | yes / no | faiss_bin_flat | 339.5 | yes / no | 0.88 [0.72, 1.01] |
| arm | dall | bge-base-en-v1.5 | 496.1 | yes / no | faiss_bin_flat | 753.3 | yes / yes | 1.52 [1.28, 1.75] |
| arm | dall | jina-v2-base-code | 348.0 | yes / yes | faiss_bin_hnsw | 189.6 | yes / no | 0.54 [0.46, 0.57] |
| arm | fiqa | CodeRankEmbed | 321.3 | yes / no | faiss_ivfpq_fs | 239.6 | no / no | 0.75 [0.68, 0.80] |
| arm | fiqa | bge-base-en-v1.5 | 234.1 | yes / no | faiss_ivfpq_fs | 292.7 | yes / yes | 1.25 [1.21, 1.28] |
| arm | fiqa | jina-v2-base-code | 321.6 | yes / yes | faiss_rabitq_hnsw | 447.7 | no / no | 1.39 [1.33, 1.41] |
| arm | gcsn | CodeRankEmbed | 106.2 | yes / yes | faiss_bin_flat | 40.7 | yes / yes | 0.38 [0.37, 0.41] |
| arm | gcsn | bge-base-en-v1.5 | 157.4 | yes / yes | faiss_bin_flat | 89.9 | yes / yes | 0.57 [0.54, 0.64] |
| arm | gcsn | jina-v2-base-code | 104.5 | yes / yes | faiss_bin_flat | 38.8 | yes / yes | 0.37 [0.36, 0.40] |
| arm | quora | CodeRankEmbed | 179.2 | yes / yes | faiss_bin_hnsw | 179.1 | yes / yes | 1.00 [0.01, 1.16] |
| arm | quora | bge-base-en-v1.5 | 154.3 | yes / yes | faiss_bin_hnsw | 87.4 | yes / no | 0.57 [0.09, 0.61] |
| arm | quora | jina-v2-base-code | 142.3 | yes / yes | faiss_bin_hnsw | 163.1 | yes / no | 1.15 [0.01, 1.28] |
| box | advtest | CodeRankEmbed | 119.1 | yes / no | faiss_bin_flat | 90.5 | no / no | 0.76 [0.74, 0.77] |
| box | d20k | CodeRankEmbed | 102.8 | yes / yes | faiss_bin_flat | 62.9 | yes / no | 0.61 [0.61, 0.63] |
| box | dall | CodeRankEmbed | 323.3 | yes / no | faiss_bin_flat | 312.6 | yes / no | 0.97 [0.95, 0.98] |
| box | fiqa | bge-base-en-v1.5 | 185.7 | yes / no | faiss_ivfpq_fs | 178.6 | yes / yes | 0.96 [0.95, 0.99] |
| box | gcsn | CodeRankEmbed | 69.6 | yes / yes | faiss_bin_flat | 36.1 | yes / yes | 0.52 [0.50, 0.54] |
| box | quora | bge-base-en-v1.5 | 91.1 | yes / yes | faiss_hnsw_sq8 | 89.5 | yes / no | 0.98 [0.97, 1.00] |
| intel | advtest | CodeRankEmbed | 130.0 | yes / no | faiss_bin_flat | 82.4 | no / no | 0.63 [0.61, 0.65] |
| intel | advtest | bge-base-en-v1.5 | 180.1 | yes / yes | faiss_ivfpq_fs | 192.3 | yes / yes | 1.07 [1.05, 1.10] |
| intel | advtest | jina-v2-base-code | 105.6 | yes / yes | svs_vamana_leanvec | 46.8 | yes / yes | 0.44 [0.44, 0.45] |
| intel | csn1m | CodeRankEmbed | 310.7 | yes / yes | svs_vamana_lvq | 841.0 | yes / yes | 2.71 [2.53, 2.93] |
| intel | csn1m | bge-base-en-v1.5 | 709.1 | yes / yes | faiss_hnsw_flat | 1939.2 | yes / yes | 2.73 [2.54, 2.81] |
| intel | csn1m | jina-v2-base-code | 160.0 | yes / yes | usearch_b1_rescore | 229.8 | yes / no | 1.44 [0.01, 1.60] |
| intel | d20k | CodeRankEmbed | 102.1 | yes / yes | faiss_bin_flat | 56.6 | yes / no | 0.55 [0.55, 0.57] |
| intel | d20k | bge-base-en-v1.5 | 171.7 | yes / yes | faiss_bin_flat | 141.2 | yes / yes | 0.82 [0.76, 0.85] |
| intel | d20k | jina-v2-base-code | 102.1 | yes / yes | svs_vamana_leanvec | 49.2 | yes / no | 0.48 [0.45, 0.50] |
| intel | dall | CodeRankEmbed | 421.4 | yes / no | faiss_bin_flat | 376.1 | yes / no | 0.89 [0.85, 0.91] |
| intel | dall | bge-base-en-v1.5 | 500.9 | yes / no | faiss_bin_flat | 705.9 | yes / yes | 1.41 [1.38, 1.43] |
| intel | dall | jina-v2-base-code | 421.7 | yes / yes | faiss_rabitq_hnsw | 124.7 | yes / yes | 0.30 [0.29, 0.33] |
| intel | fiqa | CodeRankEmbed | 302.5 | yes / no | faiss_ivfpq_fs | 142.2 | no / no | 0.47 [0.47, 0.49] |
| intel | fiqa | bge-base-en-v1.5 | 242.8 | yes / no | hnswlib_f32 | 170.0 | yes / no | 0.70 [0.68, 0.71] |
| intel | fiqa | jina-v2-base-code | 298.5 | yes / yes | svs_vamana_lvq | 100.2 | no / no | 0.34 [0.33, 0.34] |
| intel | gcsn | CodeRankEmbed | 69.5 | yes / yes | faiss_bin_flat | 36.9 | yes / yes | 0.53 [0.50, 0.55] |
| intel | gcsn | bge-base-en-v1.5 | 104.2 | yes / yes | faiss_bin_flat | 80.5 | yes / yes | 0.77 [0.70, 0.81] |
| intel | gcsn | jina-v2-base-code | 67.4 | yes / yes | faiss_bin_flat | 33.5 | yes / yes | 0.50 [0.46, 0.52] |
| intel | quora | CodeRankEmbed | 102.7 | yes / yes | svs_vamana_leanvec | 104.1 | yes / no | 1.01 [0.81, 1.27] |
| intel | quora | bge-base-en-v1.5 | 98.1 | yes / yes | svs_vamana_leanvec | 42.8 | yes / yes | 0.44 [0.02, 0.55] |
| intel | quora | jina-v2-base-code | 96.3 | yes / yes | usearch_b1_rescore | 117.5 | yes / no | 1.22 [0.83, 1.52] |
| mac | advtest | CodeRankEmbed | 67.9 | yes / no | faiss_bin_flat | 64.5 | no / no | 0.95 [0.93, 0.96] |
| mac | csn1m | CodeRankEmbed | 215.9 | yes / yes | faiss_bin_hnsw | 873.1 | yes / yes | 4.04 [4.01, 4.13] |
| mac | d20k | CodeRankEmbed | 60.1 | yes / yes | faiss_bin_flat | 42.8 | yes / no | 0.71 [0.69, 0.72] |
| mac | dall | CodeRankEmbed | 191.3 | yes / no | faiss_bin_flat | 207.4 | yes / no | 1.08 [1.08, 1.10] |
| mac | fiqa | bge-base-en-v1.5 | 113.2 | yes / no | faiss_ivfpq_fs | 166.1 | yes / yes | 1.47 [1.46, 1.47] |
| mac | gcsn | CodeRankEmbed | 44.4 | yes / yes | faiss_bin_flat | 25.3 | yes / yes | 0.57 [0.56, 0.58] |
| mac | quora | bge-base-en-v1.5 | 72.0 | yes / yes | faiss_bin_hnsw | 61.2 | yes / no | 0.85 [0.83, 0.87] |

Geometric mean of rival/ours per CPU: amd 0.88 (n = 21); arm 0.84 (n = 21); box 0.78 (n = 6); intel 0.76 (n = 21); mac 1.11 (n = 7)

## Summary at f = 0.99: ours vs the rival that was fastest on dev at f (its frozen point, held-out)

| CPU | Set | Model | Ours µs | Ours meets f (point / bound) | Rival (fastest on dev) | Rival µs | Rival meets f | rival/ours [95% CI] |
|---|---|---|---:|---|---|---:|---|---|
| amd | advtest | CodeRankEmbed | 92.0 | yes / no | faiss_ivfpq_fs | 105.9 | yes / yes | 1.15 [1.13, 1.16] |
| amd | advtest | bge-base-en-v1.5 | 112.1 | yes / no | faiss_ivfpq_fs | 103.7 | yes / yes | 0.93 [0.92, 0.94] |
| amd | advtest | jina-v2-base-code | 76.2 | yes / yes | faiss_ivfpq_fs | 60.0 | yes / yes | 0.79 [0.78, 0.80] |
| amd | csn1m | CodeRankEmbed | 267.6 | yes / yes | faiss_hnsw_sq8 | 927.4 | yes / yes | 3.47 [3.42, 3.58] |
| amd | csn1m | bge-base-en-v1.5 | 698.9 | yes / no | faiss_hnsw_sq8 | 1484.0 | yes / yes | 2.12 [1.94, 2.25] |
| amd | csn1m | jina-v2-base-code | 126.5 | yes / yes | faiss_hnsw_sq8 | 304.4 | yes / no | 2.41 [0.03, 2.54] |
| amd | d20k | CodeRankEmbed | 75.0 | yes / no | faiss_bin_flat | 62.9 | yes / no | 0.84 [0.83, 0.99] |
| amd | d20k | bge-base-en-v1.5 | 145.9 | yes / no | faiss_ivfpq_fs | 166.4 | yes / yes | 1.14 [1.12, 1.17] |
| amd | d20k | jina-v2-base-code | 74.8 | yes / yes | faiss_bin_flat | 47.4 | yes / yes | 0.63 [0.63, 0.64] |
| amd | dall | CodeRankEmbed | 280.0 | yes / no | faiss_bin_flat | 295.2 | yes / no | 1.05 [1.03, 1.07] |
| amd | dall | bge-base-en-v1.5 | 384.9 | yes / no | faiss_ivfpq_fs | 403.5 | yes / yes | 1.05 [1.01, 1.08] |
| amd | dall | jina-v2-base-code | 248.3 | yes / yes | usearch_b1_rescore | 141.3 | no / no | 0.57 [0.56, 0.58] |
| amd | fiqa | bge-base-en-v1.5 | 163.6 | yes / no | faiss_ivfpq_fs | 113.1 | yes / yes | 0.69 [0.68, 0.71] |
| amd | fiqa | jina-v2-base-code | 181.8 | yes / yes | hnswlib_f32 | 153.2 | no / no | 0.84 [0.82, 0.86] |
| amd | gcsn | CodeRankEmbed | 49.6 | yes / no | faiss_bin_flat | 27.5 | no / no | 0.55 [0.54, 0.58] |
| amd | gcsn | bge-base-en-v1.5 | 83.2 | yes / no | faiss_bin_flat | 56.6 | yes / no | 0.68 [0.66, 0.70] |
| amd | gcsn | jina-v2-base-code | 49.8 | yes / yes | faiss_bin_flat | 26.3 | yes / yes | 0.53 [0.52, 0.53] |
| amd | quora | CodeRankEmbed | 72.6 | yes / no | usearch_b1_rescore | 210.6 | yes / no | 2.90 [2.85, 2.94] |
| amd | quora | bge-base-en-v1.5 | 67.0 | yes / yes | faiss_rabitq_hnsw | 83.4 | no / no | 1.24 [1.21, 1.31] |
| amd | quora | jina-v2-base-code | 79.3 | yes / yes | faiss_bin_hnsw | 255.8 | yes / yes | 3.22 [0.71, 3.29] |
| arm | advtest | CodeRankEmbed | 163.0 | yes / no | faiss_bin_flat | 225.4 | yes / no | 1.38 [1.37, 1.41] |
| arm | advtest | bge-base-en-v1.5 | 218.9 | yes / no | faiss_ivfpq_fs | 298.8 | yes / yes | 1.36 [1.36, 1.39] |
| arm | advtest | jina-v2-base-code | 130.9 | yes / yes | faiss_bin_flat | 94.6 | yes / yes | 0.72 [0.71, 0.74] |
| arm | csn1m | CodeRankEmbed | 750.3 | yes / yes | faiss_bin_hnsw | 1977.8 | yes / no | 2.64 [2.31, 3.00] |
| arm | csn1m | bge-base-en-v1.5 | 1903.1 | yes / no | faiss_hnsw_flat | 3514.7 | yes / yes | 1.85 [1.63, 2.13] |
| arm | csn1m | jina-v2-base-code | 307.4 | yes / yes | usearch_b1_rescore | 589.2 | no / no | 1.92 [0.05, 2.21] |
| arm | d20k | CodeRankEmbed | 135.4 | yes / no | faiss_bin_flat | 86.1 | yes / no | 0.64 [0.62, 0.67] |
| arm | d20k | bge-base-en-v1.5 | 269.6 | yes / no | faiss_bin_flat | 306.3 | yes / yes | 1.14 [1.08, 1.22] |
| arm | d20k | jina-v2-base-code | 131.7 | yes / yes | faiss_bin_flat | 62.7 | yes / yes | 0.48 [0.47, 0.48] |
| arm | dall | CodeRankEmbed | 453.8 | yes / yes | faiss_bin_flat | 395.9 | yes / no | 0.87 [0.73, 1.07] |
| arm | dall | bge-base-en-v1.5 | 602.2 | yes / no | faiss_ivfpq_fs | 1522.2 | yes / yes | 2.53 [2.17, 3.04] |
| arm | dall | jina-v2-base-code | 348.0 | yes / yes | faiss_bin_flat | 300.0 | yes / yes | 0.86 [0.80, 0.93] |
| arm | fiqa | bge-base-en-v1.5 | 275.9 | yes / no | faiss_ivfpq_fs | 388.8 | yes / no | 1.41 [1.31, 1.45] |
| arm | fiqa | jina-v2-base-code | 321.6 | yes / yes | faiss_hnsw_flat | 597.9 | no / no | 1.86 [1.78, 1.90] |
| arm | gcsn | CodeRankEmbed | 106.2 | yes / no | faiss_bin_flat | 40.7 | no / no | 0.38 [0.37, 0.41] |
| arm | gcsn | bge-base-en-v1.5 | 203.4 | yes / no | faiss_bin_flat | 89.9 | yes / no | 0.44 [0.42, 0.49] |
| arm | gcsn | jina-v2-base-code | 104.5 | yes / yes | faiss_bin_flat | 38.8 | yes / yes | 0.37 [0.36, 0.40] |
| arm | quora | CodeRankEmbed | 179.2 | yes / no | faiss_bin_hnsw | 278.7 | yes / no | 1.56 [0.02, 1.82] |
| arm | quora | bge-base-en-v1.5 | 154.3 | yes / yes | faiss_bin_hnsw | 115.5 | yes / yes | 0.75 [0.11, 0.81] |
| arm | quora | jina-v2-base-code | 168.9 | yes / yes | faiss_bin_hnsw | 340.4 | yes / yes | 2.02 [0.02, 2.22] |
| box | advtest | CodeRankEmbed | 125.5 | yes / no | faiss_ivfpq_fs | 158.6 | yes / yes | 1.26 [1.24, 1.28] |
| box | d20k | CodeRankEmbed | 102.8 | yes / no | faiss_bin_flat | 83.1 | yes / no | 0.81 [0.79, 0.83] |
| box | dall | CodeRankEmbed | 360.3 | yes / no | faiss_bin_flat | 368.4 | yes / no | 1.02 [1.01, 1.03] |
| box | fiqa | bge-base-en-v1.5 | 215.1 | yes / no | faiss_ivfpq_fs | 178.6 | yes / yes | 0.83 [0.81, 0.87] |
| box | gcsn | CodeRankEmbed | 69.6 | yes / no | faiss_bin_flat | 36.1 | no / no | 0.52 [0.50, 0.54] |
| box | quora | bge-base-en-v1.5 | 91.1 | yes / yes | faiss_rabitq_hnsw | 135.3 | no / no | 1.49 [1.45, 1.59] |
| intel | advtest | CodeRankEmbed | 134.6 | yes / no | faiss_ivfpq_fs | 192.4 | yes / yes | 1.43 [1.42, 1.47] |
| intel | advtest | bge-base-en-v1.5 | 180.1 | yes / no | faiss_ivfpq_fs | 192.3 | yes / yes | 1.07 [1.05, 1.10] |
| intel | advtest | jina-v2-base-code | 105.6 | yes / yes | svs_vamana_leanvec | 82.1 | yes / yes | 0.78 [0.77, 0.79] |
| intel | csn1m | CodeRankEmbed | 432.5 | yes / yes | svs_vamana_lvq | 1627.7 | yes / yes | 3.76 [3.61, 3.94] |
| intel | csn1m | bge-base-en-v1.5 | 1643.5 | yes / yes | faiss_hnsw_flat | 3578.7 | yes / yes | 2.18 [2.02, 2.30] |
| intel | csn1m | jina-v2-base-code | 186.6 | yes / yes | usearch_b1_rescore | 345.4 | no / no | 1.85 [0.01, 2.09] |
| intel | d20k | CodeRankEmbed | 102.1 | yes / no | faiss_bin_flat | 76.1 | yes / no | 0.75 [0.73, 0.76] |
| intel | d20k | bge-base-en-v1.5 | 208.7 | yes / no | faiss_ivfpq_fs | 273.5 | yes / yes | 1.31 [1.20, 1.42] |
| intel | d20k | jina-v2-base-code | 102.1 | yes / yes | faiss_bin_flat | 53.5 | yes / yes | 0.52 [0.48, 0.54] |
| intel | dall | CodeRankEmbed | 472.9 | yes / no | faiss_bin_flat | 433.1 | yes / no | 0.92 [0.83, 0.96] |
| intel | dall | bge-base-en-v1.5 | 550.3 | yes / no | faiss_ivfpq_fs | 817.4 | yes / yes | 1.49 [1.42, 1.56] |
| intel | dall | jina-v2-base-code | 421.7 | yes / yes | usearch_b1_rescore | 170.4 | no / no | 0.40 [0.40, 0.47] |
| intel | fiqa | bge-base-en-v1.5 | 267.4 | yes / no | svs_vamana_leanvec | 234.1 | yes / yes | 0.88 [0.87, 0.91] |
| intel | fiqa | jina-v2-base-code | 298.5 | yes / yes | svs_vamana_lvq | 100.2 | no / no | 0.34 [0.33, 0.34] |
| intel | gcsn | CodeRankEmbed | 69.5 | yes / no | faiss_bin_flat | 36.9 | no / no | 0.53 [0.50, 0.55] |
| intel | gcsn | bge-base-en-v1.5 | 136.3 | yes / no | faiss_bin_flat | 80.5 | yes / no | 0.59 [0.53, 0.61] |
| intel | gcsn | jina-v2-base-code | 67.4 | yes / yes | faiss_bin_flat | 33.5 | yes / yes | 0.50 [0.46, 0.52] |
| intel | quora | CodeRankEmbed | 102.7 | yes / no | usearch_b1_rescore | 194.8 | yes / no | 1.90 [1.46, 2.46] |
| intel | quora | bge-base-en-v1.5 | 98.1 | yes / yes | svs_vamana_leanvec | 57.6 | yes / yes | 0.59 [0.03, 0.68] |
| intel | quora | jina-v2-base-code | 115.3 | yes / yes | faiss_bin_hnsw | 278.6 | yes / yes | 2.42 [1.98, 3.16] |
| mac | advtest | CodeRankEmbed | 73.1 | yes / no | faiss_bin_flat | 161.6 | yes / no | 2.21 [2.19, 2.23] |
| mac | csn1m | CodeRankEmbed | 285.1 | yes / yes | faiss_bin_hnsw | 1478.1 | yes / no | 5.19 [4.96, 5.95] |
| mac | d20k | CodeRankEmbed | 60.1 | yes / no | faiss_bin_flat | 57.4 | yes / no | 0.96 [0.92, 0.96] |
| mac | dall | CodeRankEmbed | 212.6 | yes / yes | faiss_bin_flat | 248.0 | yes / no | 1.17 [1.15, 1.19] |
| mac | fiqa | bge-base-en-v1.5 | 130.5 | yes / no | faiss_ivfpq_fs | 210.1 | yes / no | 1.61 [1.57, 1.63] |
| mac | gcsn | CodeRankEmbed | 44.4 | yes / no | faiss_bin_flat | 25.3 | no / no | 0.57 [0.56, 0.58] |
| mac | quora | bge-base-en-v1.5 | 72.0 | yes / yes | faiss_bin_hnsw | 77.6 | yes / yes | 1.08 [1.05, 1.10] |

Geometric mean of rival/ours per CPU: amd 1.11 (n = 20); arm 1.06 (n = 20); box 0.94 (n = 6); intel 0.98 (n = 20); mac 1.44 (n = 7)

## Summary at f = 0.995: ours vs the rival that was fastest on dev at f (its frozen point, held-out)

| CPU | Set | Model | Ours µs | Ours meets f (point / bound) | Rival (fastest on dev) | Rival µs | Rival meets f | rival/ours [95% CI] |
|---|---|---|---:|---|---|---:|---|---|
| amd | advtest | CodeRankEmbed | 97.6 | no / no | faiss_ivfpq_fs | 105.9 | yes / yes | 1.09 [1.07, 1.10] |
| amd | advtest | bge-base-en-v1.5 | 127.3 | yes / no | faiss_ivfpq_fs | 103.7 | yes / yes | 0.81 [0.81, 0.86] |
| amd | advtest | jina-v2-base-code | 86.7 | yes / yes | faiss_ivfpq_fs | 68.2 | yes / no | 0.79 [0.78, 0.80] |
| amd | csn1m | CodeRankEmbed | 331.8 | yes / no | faiss_hnsw_flat | 1499.5 | yes / no | 4.52 [4.40, 4.61] |
| amd | csn1m | jina-v2-base-code | 167.5 | yes / yes | faiss_hnsw_sq8 | 419.0 | yes / no | 2.50 [0.05, 2.66] |
| amd | d20k | CodeRankEmbed | 93.6 | no / no | faiss_bin_flat | 62.9 | no / no | 0.67 [0.66, 0.70] |
| amd | d20k | bge-base-en-v1.5 | 157.2 | yes / no | faiss_ivfpq_fs | 166.4 | yes / yes | 1.06 [1.04, 1.07] |
| amd | d20k | jina-v2-base-code | 74.8 | yes / yes | faiss_bin_flat | 47.4 | yes / yes | 0.63 [0.63, 0.64] |
| amd | dall | CodeRankEmbed | 301.2 | yes / no | faiss_bin_flat | 360.6 | yes / no | 1.20 [1.18, 1.21] |
| amd | dall | bge-base-en-v1.5 | 492.0 | no / no | faiss_ivfpq_fs | 550.0 | yes / yes | 1.12 [1.11, 1.15] |
| amd | dall | jina-v2-base-code | 267.9 | yes / no | faiss_bin_hnsw | 230.2 | yes / no | 0.86 [0.85, 0.87] |
| amd | fiqa | jina-v2-base-code | 181.8 | yes / yes | hnswlib_f32 | 153.2 | no / no | 0.84 [0.82, 0.86] |
| amd | gcsn | CodeRankEmbed | 61.3 | yes / no | faiss_bin_flat | 40.9 | yes / no | 0.67 [0.65, 0.71] |
| amd | gcsn | bge-base-en-v1.5 | 99.4 | yes / yes | faiss_rabitq_flat | 116.2 | yes / yes | 1.17 [1.14, 1.23] |
| amd | gcsn | jina-v2-base-code | 49.8 | yes / yes | faiss_bin_flat | 26.3 | yes / yes | 0.53 [0.52, 0.53] |
| amd | quora | CodeRankEmbed | 104.8 | yes / yes | faiss_bin_hnsw | 382.6 | yes / no | 3.65 [3.56, 3.75] |
| amd | quora | bge-base-en-v1.5 | 67.0 | yes / yes | faiss_hnsw_sq8 | 115.3 | yes / no | 1.72 [1.68, 1.76] |
| amd | quora | jina-v2-base-code | 152.3 | yes / yes | faiss_hnsw_sq8 | 450.0 | yes / yes | 2.95 [1.09, 3.03] |
| arm | advtest | CodeRankEmbed | 174.7 | no / no | faiss_bin_flat | 225.4 | yes / no | 1.29 [1.27, 1.31] |
| arm | advtest | bge-base-en-v1.5 | 262.7 | yes / no | faiss_ivfpq_fs | 298.8 | yes / yes | 1.14 [1.12, 1.15] |
| arm | advtest | jina-v2-base-code | 150.7 | yes / yes | faiss_bin_flat | 94.6 | yes / yes | 0.63 [0.62, 0.64] |
| arm | csn1m | CodeRankEmbed | 961.4 | yes / no | faiss_hnsw_flat | 2881.3 | yes / no | 3.00 [2.57, 3.37] |
| arm | csn1m | jina-v2-base-code | 426.5 | yes / yes | faiss_bin_hnsw | 714.8 | yes / yes | 1.68 [0.08, 1.94] |
| arm | d20k | CodeRankEmbed | 163.1 | no / no | faiss_bin_flat | 86.1 | no / no | 0.53 [0.51, 0.55] |
| arm | d20k | bge-base-en-v1.5 | 310.1 | yes / no | faiss_bin_flat | 306.3 | yes / no | 0.99 [0.93, 1.05] |
| arm | d20k | jina-v2-base-code | 131.7 | yes / yes | faiss_bin_flat | 62.7 | yes / yes | 0.48 [0.47, 0.48] |
| arm | dall | CodeRankEmbed | 479.0 | yes / no | faiss_bin_flat | 495.4 | yes / no | 1.03 [0.86, 1.32] |
| arm | dall | bge-base-en-v1.5 | 769.6 | no / no | faiss_ivfpq_fs | 1765.9 | yes / yes | 2.29 [1.97, 2.82] |
| arm | dall | jina-v2-base-code | 373.1 | yes / no | faiss_bin_flat | 300.0 | yes / no | 0.80 [0.75, 0.86] |
| arm | fiqa | jina-v2-base-code | 321.6 | yes / yes | faiss_hnsw_flat | 597.9 | no / no | 1.86 [1.78, 1.90] |
| arm | gcsn | CodeRankEmbed | 137.6 | yes / no | faiss_bin_flat | 62.6 | yes / no | 0.45 [0.44, 0.50] |
| arm | gcsn | bge-base-en-v1.5 | 262.3 | yes / yes | faiss_bin_flat | 334.6 | yes / yes | 1.28 [1.15, 1.44] |
| arm | gcsn | jina-v2-base-code | 104.5 | yes / yes | faiss_bin_flat | 38.8 | yes / yes | 0.37 [0.36, 0.40] |
| arm | quora | CodeRankEmbed | 272.1 | yes / yes | faiss_bin_hnsw | 500.3 | yes / no | 1.84 [0.07, 2.20] |
| arm | quora | bge-base-en-v1.5 | 154.3 | yes / yes | faiss_bin_hnsw | 163.6 | yes / yes | 1.06 [0.16, 1.15] |
| arm | quora | jina-v2-base-code | 321.4 | yes / yes | faiss_bin_hnsw | 722.7 | yes / yes | 2.25 [0.03, 2.52] |
| box | advtest | CodeRankEmbed | 136.5 | no / no | faiss_ivfpq_fs | 158.6 | yes / yes | 1.16 [1.14, 1.17] |
| box | d20k | CodeRankEmbed | 126.9 | no / no | faiss_bin_flat | 83.1 | no / no | 0.66 [0.64, 0.67] |
| box | dall | CodeRankEmbed | 372.3 | yes / no | faiss_bin_flat | 460.4 | yes / no | 1.24 [1.22, 1.25] |
| box | gcsn | CodeRankEmbed | 92.8 | yes / no | faiss_bin_flat | 52.8 | yes / no | 0.57 [0.56, 0.58] |
| box | quora | bge-base-en-v1.5 | 91.1 | yes / yes | faiss_hnsw_sq8 | 168.4 | yes / no | 1.85 [1.84, 1.88] |
| intel | advtest | CodeRankEmbed | 143.6 | no / no | faiss_ivfpq_fs | 192.4 | yes / yes | 1.34 [1.33, 1.37] |
| intel | advtest | bge-base-en-v1.5 | 212.0 | yes / no | faiss_ivfpq_fs | 192.3 | yes / yes | 0.91 [0.89, 0.94] |
| intel | advtest | jina-v2-base-code | 124.6 | yes / yes | svs_vamana_leanvec | 82.1 | yes / yes | 0.66 [0.65, 0.67] |
| intel | csn1m | CodeRankEmbed | 543.0 | yes / no | faiss_hnsw_flat | 2930.4 | yes / no | 5.40 [5.07, 5.58] |
| intel | csn1m | jina-v2-base-code | 252.1 | yes / yes | usearch_b1_rescore | 772.8 | yes / no | 3.07 [0.02, 3.53] |
| intel | d20k | CodeRankEmbed | 131.8 | no / no | faiss_bin_flat | 76.1 | no / no | 0.58 [0.57, 0.59] |
| intel | d20k | bge-base-en-v1.5 | 230.8 | yes / no | faiss_ivfpq_fs | 273.5 | yes / yes | 1.18 [1.09, 1.29] |
| intel | d20k | jina-v2-base-code | 102.1 | yes / yes | faiss_bin_flat | 53.5 | yes / yes | 0.52 [0.48, 0.54] |
| intel | dall | CodeRankEmbed | 474.7 | yes / no | faiss_bin_flat | 518.0 | yes / no | 1.09 [1.05, 1.13] |
| intel | dall | bge-base-en-v1.5 | 641.2 | no / no | faiss_ivfpq_fs | 982.7 | yes / yes | 1.53 [1.43, 1.58] |
| intel | dall | jina-v2-base-code | 445.1 | yes / no | faiss_bin_hnsw | 272.9 | yes / no | 0.61 [0.55, 0.68] |
| intel | fiqa | jina-v2-base-code | 298.5 | yes / yes | svs_vamana_lvq | 100.2 | no / no | 0.34 [0.33, 0.34] |
| intel | gcsn | CodeRankEmbed | 92.8 | yes / no | faiss_bin_flat | 55.8 | yes / no | 0.60 [0.58, 0.63] |
| intel | gcsn | bge-base-en-v1.5 | 177.9 | yes / yes | faiss_rabitq_flat | 152.4 | yes / yes | 0.86 [0.77, 0.89] |
| intel | gcsn | jina-v2-base-code | 67.4 | yes / yes | faiss_bin_flat | 33.5 | yes / yes | 0.50 [0.46, 0.52] |
| intel | quora | CodeRankEmbed | 150.1 | yes / yes | faiss_bin_hnsw | 354.5 | yes / no | 2.36 [2.15, 3.61] |
| intel | quora | bge-base-en-v1.5 | 98.1 | yes / yes | svs_vamana_leanvec | 87.9 | yes / yes | 0.90 [0.05, 1.18] |
| intel | quora | jina-v2-base-code | 203.3 | yes / yes | usearch_b1_rescore | 495.8 | yes / yes | 2.44 [1.86, 3.27] |
| mac | advtest | CodeRankEmbed | 78.6 | no / no | faiss_bin_flat | 161.6 | yes / no | 2.05 [2.03, 2.08] |
| mac | csn1m | CodeRankEmbed | 354.8 | yes / no | faiss_hnsw_flat | 1889.1 | yes / no | 5.32 [5.26, 5.40] |
| mac | d20k | CodeRankEmbed | 74.0 | no / no | faiss_bin_flat | 57.4 | no / no | 0.78 [0.76, 0.79] |
| mac | dall | CodeRankEmbed | 220.9 | yes / no | faiss_bin_flat | 311.4 | yes / no | 1.41 [1.39, 1.43] |
| mac | gcsn | CodeRankEmbed | 55.3 | yes / no | faiss_bin_flat | 37.6 | yes / no | 0.68 [0.66, 0.70] |
| mac | quora | bge-base-en-v1.5 | 72.0 | yes / yes | faiss_bin_hnsw | 104.6 | yes / yes | 1.45 [1.42, 1.48] |

Geometric mean of rival/ours per CPU: amd 1.20 (n = 18); arm 1.08 (n = 18); box 1.00 (n = 5); intel 1.04 (n = 18); mac 1.51 (n = 6)

## Primary comparisons (pairs fixed on dev: quality non-inferiority of ours vs that rival at f = 0.99; Holm over the pairs with power >= 0.8)

| CPU | Set | Model | Rival | rival/ours latency [95% CI] | Meets 0.99 ours ; rival | mean(ours − rival) | lower bound | p | Holm |
|---|---|---|---|---|---|---:|---:|---:|---|
| intel | fiqa | bge-base-en-v1.5 | svs_vamana_leanvec | 0.88 [0.87, 0.91] | yes / no ; yes / yes | -0.0015 | -0.0066 | 0.0852 | fail |
| intel | fiqa | jina-v2-base-code | svs_vamana_lvq | 0.34 [0.33, 0.34] | yes / yes ; no / no | +0.0039 | -0.0001 | 0.0001 | pass |
| intel | quora | CodeRankEmbed | usearch_b1_rescore | 1.90 [1.46, 2.46] | yes / no ; yes / no | +0.0019 | -0.0005 | 0.0001 | pass |
| intel | quora | bge-base-en-v1.5 | svs_vamana_leanvec | 0.59 [0.03, 0.68] | yes / yes ; yes / yes | +0.0039 | +0.0018 | 0.0001 | pass |
| intel | quora | jina-v2-base-code | faiss_bin_hnsw | 2.42 [1.98, 3.16] | yes / yes ; yes / yes | +0.0008 | -0.0009 | 0.0001 | pass |
| amd | fiqa | bge-base-en-v1.5 | faiss_ivfpq_fs | 0.69 [0.68, 0.71] | yes / no ; yes / yes | -0.0013 | -0.0061 | 0.0650 | descriptive (power 0.59) |
| amd | fiqa | jina-v2-base-code | hnswlib_f32 | 0.84 [0.82, 0.86] | yes / yes ; no / no | +0.0092 | +0.0012 | 0.0001 | pass |
| amd | quora | CodeRankEmbed | usearch_b1_rescore | 2.90 [2.85, 2.94] | yes / no ; yes / no | +0.0019 | -0.0005 | 0.0001 | pass |
| amd | quora | bge-base-en-v1.5 | faiss_rabitq_hnsw | 1.24 [1.21, 1.31] | yes / yes ; no / no | +0.0077 | +0.0049 | 0.0001 | pass |
| amd | quora | jina-v2-base-code | faiss_bin_hnsw | 3.22 [0.71, 3.29] | yes / yes ; yes / yes | +0.0008 | -0.0009 | 0.0001 | pass |
| arm | fiqa | bge-base-en-v1.5 | faiss_ivfpq_fs | 1.41 [1.31, 1.45] | yes / no ; yes / no | +0.0005 | -0.0048 | 0.0200 | descriptive (power 0.74) |
| arm | fiqa | jina-v2-base-code | faiss_hnsw_flat | 1.86 [1.78, 1.90] | yes / yes ; no / no | +0.0023 | +0.0000 | 0.0001 | pass |
| arm | quora | CodeRankEmbed | faiss_bin_hnsw | 1.56 [0.02, 1.82] | yes / no ; yes / no | +0.0005 | -0.0019 | 0.0001 | pass |
| arm | quora | bge-base-en-v1.5 | faiss_bin_hnsw | 0.75 [0.11, 0.81] | yes / yes ; yes / yes | +0.0035 | +0.0014 | 0.0001 | pass |
| arm | quora | jina-v2-base-code | faiss_bin_hnsw | 2.02 [0.02, 2.22] | yes / yes ; yes / yes | +0.0008 | -0.0009 | 0.0001 | pass |

## intel (frozen points from the intel shortlist, R = 5)

### advtest / CodeRankEmbed (n_ho = 1200, exact quality 0.4732)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 465.1 | 5 | 1.0009 | yes / yes | 3.58 [3.41, 3.68] | 106 | 372 |
| diskann_vamana | 0.99 | 744.9 | 5 | 0.9977 | yes / yes | 5.53 [5.50, 5.71] | 106 | 364 |
| diskann_vamana | 0.995 | 1262.2 | 5 | 0.9980 | yes / no | 8.79 [8.74, 9.02] | 107 | 372 |
| faiss_bin_flat | 0.98 | 82.4 | 5 | 0.9796 | no / no | 0.63 [0.61, 0.65] | 84 | 416 |
| faiss_bin_flat | 0.99 | 205.1 | 5 | 0.9954 | yes / no | 1.52 [1.51, 1.57] | 84 | 414 |
| faiss_bin_flat | 0.995 | 205.1 | 5 | 0.9954 | yes / no | 1.43 [1.42, 1.47] | 84 | 414 |
| faiss_bin_hnsw | 0.98 | 303.0 | 5 | 0.9778 | no / no | 2.33 [2.22, 2.40] | 96 | 454 |
| faiss_bin_hnsw | 0.99 | 447.7 | 5 | 0.9963 | yes / no | 3.33 [3.31, 3.43] | 95 | 448 |
| faiss_bin_hnsw | 0.995 | 567.3 | 5 | 0.9963 | yes / no | 3.95 [3.93, 4.05] | 90 | 438 |
| faiss_exact | 0.98 | 2254.1 | 5 | 1.0000 | yes / yes | 17.34 [16.55, 17.84] | 83 | 217 |
| faiss_exact | 0.99 | 2254.1 | 5 | 1.0000 | yes / yes | 16.74 [16.65, 17.26] | 83 | 217 |
| faiss_exact | 0.995 | 2254.1 | 5 | 1.0000 | yes / yes | 15.70 [15.61, 16.10] | 83 | 217 |
| faiss_hnsw_flat | 0.98 | 325.5 | 5 | 0.9935 | yes / yes | 2.50 [2.39, 2.58] | 86 | 222 |
| faiss_hnsw_flat | 0.99 | 444.2 | 5 | 0.9971 | yes / yes | 3.30 [3.28, 3.40] | 89 | 237 |
| faiss_hnsw_flat | 0.995 | 786.4 | 5 | 0.9995 | yes / yes | 5.48 [5.45, 5.62] | 89 | 236 |
| faiss_hnsw_sq8 | 0.98 | 307.2 | 5 | 0.9864 | yes / no | 2.36 [2.26, 2.43] | 111 | 502 |
| faiss_hnsw_sq8 | 0.99 | 458.0 | 5 | 0.9971 | yes / yes | 3.40 [3.34, 3.51] | 105 | 485 |
| faiss_hnsw_sq8 | 0.995 | 810.6 | 5 | 0.9996 | yes / yes | 5.65 [5.59, 5.79] | 105 | 486 |
| faiss_ivfpq_fs | 0.98 | 192.4 | 5 | 0.9999 | yes / yes | 1.48 [1.41, 1.52] | 88 | 446 |
| faiss_ivfpq_fs | 0.99 | 192.4 | 5 | 0.9999 | yes / yes | 1.43 [1.42, 1.47] | 88 | 446 |
| faiss_ivfpq_fs | 0.995 | 192.4 | 5 | 0.9999 | yes / yes | 1.34 [1.33, 1.37] | 88 | 446 |
| faiss_rabitq_flat | 0.98 | 317.5 | 5 | 0.9937 | yes / yes | 2.44 [2.33, 2.62] | 85 | 418 |
| faiss_rabitq_flat | 0.99 | 337.7 | 5 | 0.9986 | yes / yes | 2.51 [2.38, 2.63] | 85 | 416 |
| faiss_rabitq_flat | 0.995 | 337.7 | 5 | 0.9986 | yes / yes | 2.35 [2.23, 2.45] | 85 | 416 |
| faiss_rabitq_hnsw | 0.98 | 137.0 | 5 | 0.9881 | yes / no | 1.05 [1.01, 1.08] | 97 | 461 |
| faiss_rabitq_hnsw | 0.99 | 237.1 | 5 | 0.9979 | yes / yes | 1.76 [1.75, 1.82] | 97 | 463 |
| faiss_rabitq_hnsw | 0.995 | 295.3 | 5 | 0.9989 | yes / no | 2.06 [2.04, 2.11] | 97 | 461 |
| faiss_rabitq_ivf | 0.98 | 468.3 | 5 | 1.0000 | yes / yes | 3.60 [3.44, 3.71] | 86 | 438 |
| faiss_rabitq_ivf | 0.99 | 468.3 | 5 | 1.0000 | yes / yes | 3.48 [3.45, 3.59] | 86 | 438 |
| faiss_rabitq_ivf | 0.995 | 468.3 | 5 | 1.0000 | yes / yes | 3.26 [3.23, 3.35] | 86 | 438 |
| hnswlib_f32 | 0.98 | 283.9 | 5 | 0.9854 | yes / no | 2.18 [2.08, 2.25] | 97 | 216 |
| hnswlib_f32 | 0.99 | 447.8 | 5 | 0.9953 | yes / no | 3.33 [3.31, 3.43] | 92 | 201 |
| hnswlib_f32 | 0.995 | 505.7 | 5 | 1.0000 | yes / yes | 3.52 [3.50, 3.61] | 97 | 211 |
| ours_cascade | 0.98 | 130.0 | 5 | 0.9852 | yes / no |  | 174 | 215 |
| ours_cascade | 0.99 | 134.6 | 5 | 0.9909 | yes / no |  | 174 | 258 |
| ours_cascade | 0.995 | 143.6 | 5 | 0.9946 | no / no |  | 166 | 305 |
| scann | 0.98 | 359.4 | 5 | 1.0000 | yes / yes | 2.77 [2.64, 2.91] | 127 | 397 |
| scann | 0.99 | 359.4 | 5 | 1.0000 | yes / yes | 2.67 [2.62, 2.81] | 127 | 397 |
| scann | 0.995 | 359.4 | 5 | 1.0000 | yes / yes | 2.50 [2.45, 2.64] | 127 | 397 |
| svs_vamana_leanvec | 0.98 | 117.0 | 5 | 0.9834 | yes / no | 0.90 [0.86, 0.93] | 58 | 175 |
| svs_vamana_leanvec | 0.99 | 233.2 | 5 | 0.9911 | yes / no | 1.73 [1.72, 1.79] | 59 | 174 |
| svs_vamana_leanvec | 0.995 | 233.2 | 5 | 0.9911 | no / no | 1.62 [1.61, 1.67] | 59 | 174 |
| svs_vamana_lvq | 0.98 | 167.4 | 5 | 0.9954 | yes / yes | 1.29 [1.23, 1.33] | 62 | 181 |
| svs_vamana_lvq | 0.99 | 332.7 | 5 | 0.9990 | yes / yes | 2.47 [2.45, 2.55] | 62 | 189 |
| svs_vamana_lvq | 0.995 | 648.8 | 5 | 0.9995 | yes / yes | 4.52 [4.49, 4.64] | 62 | 184 |
| usearch_b1_rescore | 0.98 | 306.8 | 5 | 0.9914 | yes / yes | 2.36 [2.25, 2.43] | 92 | 427 |
| usearch_b1_rescore | 0.99 | 366.5 | 5 | 0.9902 | yes / no | 2.72 [2.69, 2.87] | 98 | 454 |
| usearch_b1_rescore | 0.995 | 366.5 | 5 | 0.9902 | no / no | 2.55 [2.53, 2.69] | 98 | 454 |
| usearch_f16 | 0.98 | 552.4 | 5 | 0.9859 | yes / no | 4.25 [4.06, 4.37] | 58 | 179 |
| usearch_f16 | 0.99 | 635.2 | 5 | 1.0010 | yes / yes | 4.72 [4.69, 4.86] | 64 | 199 |
| usearch_f16 | 0.995 | 1103.2 | 5 | 1.0013 | yes / yes | 7.68 [7.64, 7.88] | 64 | 201 |
| usearch_i8 | 0.98 | 395.2 | 5 | 0.9948 | yes / yes | 3.04 [2.90, 3.13] | 42 | 107 |
| usearch_i8 | 0.99 | 800.0 | 5 | 0.9973 | yes / no | 5.94 [5.84, 6.13] | 48 | 127 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 704.8 / 0.9988 | 752.5 / 0.9988 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2849.4 / 1.0000 | 2902.9 / 1.0000 | 3777.5 / 1.0000 |
| diskann_vamana | L 200 | 1083.5 / 0.9984 | 1133.0 / 0.9984 | 1104.5 / 0.9984 | 1154.3 / 0.9984 | 1248.9 / 0.9984 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3862.7 / 1.0000 | 3913.8 / 1.0000 | 4809.0 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1676.9 / 0.9994 | 1728.0 / 0.9994 | 1826.8 / 0.9994 | 1706.7 / 0.9995 | 1762.1 / 0.9994 | 2053.0 / 0.9994 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2478.2 / 1.0000 | 2535.4 / 1.0000 | 2833.0 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 140.6 / 0.9818 | 190.2 / 0.9818 | 187.5 / 0.9908 | 239.4 / 0.9906 | 338.4 / 0.9906 | 279.0 / 0.9972 | 329.9 / 0.9972 | 617.3 / 0.9972 | 532.6 / 0.9999 | 581.9 / 0.9999 | 1442.0 / 0.9999 |
| faiss_bin_hnsw | ef 100 | 177.6 / 0.9646 | 226.2 / 0.9646 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1217.6 / 0.9999 | 1260.1 / 0.9999 | 2137.6 / 0.9999 |
| faiss_bin_hnsw | ef 200 | 260.9 / 0.9792 | 313.7 / 0.9792 | 300.7 / 0.9882 | 352.2 / 0.9879 | 448.0 / 0.9879 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1990.0 / 0.9999 | 2027.8 / 0.9999 | 2921.5 / 0.9999 |
| faiss_bin_hnsw | ef 400 |  |  | 463.9 / 0.9923 | 517.5 / 0.9921 | 621.0 / 0.9921 | 542.6 / 0.9958 | 594.6 / 0.9958 | 882.2 / 0.9958 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 836.0 / 0.9969 | 893.4 / 0.9969 | 1199.9 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 443.1 / 0.9992 | 492.3 / 0.9991 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2519.0 / 1.0000 | 2571.0 / 1.0000 | 3477.0 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 725.7 / 0.9970 | 777.8 / 0.9969 | 757.8 / 0.9970 | 809.6 / 0.9969 | 912.4 / 0.9969 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3783.0 / 1.0000 | 3839.7 / 1.0000 | 4755.3 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1234.3 / 1.0000 | 1285.1 / 1.0000 | 1384.0 / 1.0000 | 1296.5 / 1.0000 | 1349.5 / 1.0000 | 1642.3 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2028.2 / 1.0000 | 2086.2 / 1.0000 | 2375.7 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 443.3 / 0.9999 | 495.7 / 0.9999 | 479.8 / 1.0000 | 524.3 / 1.0000 | 626.3 / 1.0000 | 527.1 / 1.0000 | 576.9 / 1.0000 | 868.8 / 1.0000 | 679.9 / 1.0000 | 725.2 / 1.0000 | 1579.3 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 140.9 / 0.6766 | 190.3 / 0.6764 | 286.8 / 0.6764 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 223.2 / 0.7543 | 274.2 / 0.7543 | 559.1 / 0.7543 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 390.2 / 0.7675 | 440.2 / 0.7675 | 1297.8 / 0.7675 |
| faiss_rabitq_ivf | nprobe 3 | 91.3 / 0.4830 | 138.8 / 0.4830 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 489.1 / 0.8765 | 537.5 / 0.8769 | 1392.2 / 0.8769 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 121.0 / 0.5606 | 170.0 / 0.5607 | 263.8 / 0.5607 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 101.5 / 0.5815 | 150.1 / 0.5815 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 183.7 / 0.6516 | 234.3 / 0.6515 | 519.8 / 0.6515 |  |  |  |
| hnswlib_f32 | ef 100 | 424.1 / 0.9938 | 482.5 / 0.9937 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2357.5 / 1.0000 | 2402.3 / 1.0000 | 3302.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 722.0 / 0.9998 | 772.7 / 0.9996 | 743.6 / 0.9998 | 785.7 / 0.9996 | 882.5 / 0.9996 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 3340.3 / 1.0000 | 3388.5 / 1.0000 | 4282.0 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1226.6 / 0.9995 | 1276.8 / 0.9995 | 1368.2 / 0.9995 | 1244.7 / 0.9995 | 1298.2 / 0.9995 | 1610.0 / 0.9995 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1954.9 / 1.0000 | 2001.6 / 1.0000 | 2324.9 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 89.5 / 0.9832 | 112.5 / 0.9832 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 170.4 / 0.9999 | 192.5 / 0.9999 | 635.5 / 0.9999 |
| ours_scan | ef 200 |  |  | 98.9 / 0.9913 | 122.7 / 0.9909 | 164.2 / 0.9909 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 118.2 / 0.9970 | 140.0 / 0.9970 | 274.6 / 0.9970 |  |  |  |
| ours_walk | ef 100 | 90.7 / 0.9821 | 109.6 / 0.9821 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 254.7 / 0.9999 | 275.1 / 0.9999 | 715.4 / 0.9999 |
| ours_walk | ef 200 | 107.1 / 0.9851 | 127.1 / 0.9851 | 115.7 / 0.9936 | 135.8 / 0.9932 | 179.0 / 0.9932 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 302.3 / 0.9999 | 324.1 / 0.9999 | 772.7 / 0.9999 |
| ours_walk | ef 400 |  |  | 143.2 / 0.9917 | 163.9 / 0.9915 | 208.9 / 0.9915 | 159.2 / 0.9968 | 179.9 / 0.9966 | 319.3 / 0.9966 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 196.0 / 0.9969 | 217.4 / 0.9969 | 354.8 / 0.9969 |  |  |  |
| scann | reorder 100 | 438.7 / 1.0000 | 481.6 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 855.9 / 1.0000 | 888.8 / 1.0000 | 1783.9 / 1.0000 |
| scann | reorder 200 |  |  | 496.2 / 1.0000 | 535.8 / 1.0000 | 645.7 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 580.1 / 1.0000 | 638.2 / 1.0000 | 910.8 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 154.2 / 0.9618 | 203.7 / 0.9618 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 891.3 / 0.9940 | 941.7 / 0.9940 | 1830.9 / 0.9940 |
| usearch_b1_rescore | ef 200 | 231.3 / 0.9748 | 283.7 / 0.9748 | 244.9 / 0.9819 | 295.0 / 0.9819 | 398.5 / 0.9819 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1477.8 / 0.9931 | 1530.6 / 0.9931 | 2421.9 / 0.9931 |
| usearch_b1_rescore | ef 400 |  |  | 384.7 / 0.9862 | 437.1 / 0.9858 | 540.5 / 0.9858 | 412.6 / 0.9904 | 464.5 / 0.9904 | 776.7 / 0.9904 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 677.2 / 0.9912 | 730.8 / 0.9912 | 1043.8 / 0.9912 |  |  |  |

### advtest / bge-base-en-v1.5 (n_ho = 1200, exact quality 0.2223)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 926.2 | 5 | 0.9905 | yes / no | 5.14 [5.11, 5.29] | 106 | 375 |
| diskann_vamana | 0.99 | 1409.7 | 5 | 0.9946 | yes / no | 7.83 [7.77, 8.06] | 106 | 364 |
| diskann_vamana | 0.995 | 1426.3 | 5 | 0.9908 | no / no | 6.73 [6.65, 6.98] | 106 | 368 |
| faiss_exact | 0.98 | 2253.0 | 5 | 1.0000 | yes / yes | 12.51 [12.42, 12.88] | 83 | 219 |
| faiss_exact | 0.99 | 2253.0 | 5 | 1.0000 | yes / yes | 12.51 [12.42, 12.88] | 83 | 219 |
| faiss_exact | 0.995 | 2253.0 | 5 | 1.0000 | yes / yes | 10.63 [10.50, 11.02] | 83 | 219 |
| faiss_hnsw_flat | 0.98 | 472.8 | 5 | 0.9809 | yes / no | 2.63 [2.61, 2.70] | 89 | 236 |
| faiss_hnsw_flat | 0.99 | 844.1 | 5 | 0.9934 | yes / no | 4.69 [4.65, 4.82] | 89 | 239 |
| faiss_hnsw_flat | 0.995 | 1333.4 | 5 | 0.9963 | yes / no | 6.29 [6.21, 6.52] | 86 | 225 |
| faiss_hnsw_sq8 | 0.98 | 491.8 | 5 | 0.9810 | yes / no | 2.73 [2.65, 2.81] | 105 | 491 |
| faiss_hnsw_sq8 | 0.99 | 865.8 | 5 | 0.9971 | yes / yes | 4.81 [4.71, 4.95] | 105 | 491 |
| faiss_hnsw_sq8 | 0.995 | 1546.4 | 5 | 0.9975 | yes / no | 7.30 [7.21, 7.57] | 105 | 491 |
| faiss_ivfpq_fs | 0.98 | 192.3 | 5 | 1.0013 | yes / yes | 1.07 [1.05, 1.10] | 88 | 443 |
| faiss_ivfpq_fs | 0.99 | 192.3 | 5 | 1.0013 | yes / yes | 1.07 [1.05, 1.10] | 88 | 443 |
| faiss_ivfpq_fs | 0.995 | 192.3 | 5 | 1.0013 | yes / yes | 0.91 [0.89, 0.94] | 88 | 443 |
| faiss_rabitq_flat | 0.98 | 340.9 | 5 | 0.9851 | yes / no | 1.89 [1.74, 1.95] | 85 | 421 |
| faiss_rabitq_flat | 0.99 | 340.9 | 5 | 0.9851 | no / no | 1.89 [1.74, 1.95] | 85 | 421 |
| faiss_rabitq_flat | 0.995 | 331.2 | 5 | 1.0021 | yes / yes | 1.56 [1.53, 1.67] | 85 | 422 |
| faiss_rabitq_hnsw | 0.98 | 286.4 | 5 | 0.9878 | yes / no | 1.59 [1.58, 1.64] | 97 | 462 |
| faiss_rabitq_hnsw | 0.99 | 286.4 | 5 | 0.9878 | no / no | 1.59 [1.58, 1.64] | 97 | 462 |
| faiss_rabitq_hnsw | 0.995 | 531.0 | 5 | 1.0022 | yes / yes | 2.51 [2.47, 2.60] | 97 | 463 |
| faiss_rabitq_ivf | 0.98 | 473.7 | 5 | 1.0005 | yes / yes | 2.63 [2.61, 2.71] | 86 | 433 |
| faiss_rabitq_ivf | 0.99 | 473.7 | 5 | 1.0005 | yes / yes | 2.63 [2.61, 2.71] | 86 | 433 |
| faiss_rabitq_ivf | 0.995 | 473.7 | 5 | 1.0005 | yes / yes | 2.23 [2.21, 2.32] | 86 | 433 |
| hnswlib_f32 | 0.98 | 713.6 | 5 | 0.9897 | yes / no | 3.96 [3.93, 4.08] | 89 | 193 |
| hnswlib_f32 | 0.99 | 1244.3 | 5 | 0.9884 | no / no | 6.91 [6.86, 7.11] | 90 | 197 |
| hnswlib_f32 | 0.995 | 1383.0 | 5 | 0.9921 | no / no | 6.53 [6.45, 6.77] | 92 | 204 |
| ours_cascade | 0.98 | 180.1 | 5 | 0.9960 | yes / yes |  | 176 | 481 |
| ours_cascade | 0.99 | 180.1 | 5 | 0.9960 | yes / no |  | 176 | 481 |
| ours_cascade | 0.995 | 212.0 | 5 | 0.9964 | yes / no |  | 176 | 656 |
| scann | 0.98 | 327.5 | 5 | 0.9991 | yes / yes | 1.82 [1.77, 1.88] | 127 | 404 |
| scann | 0.99 | 327.5 | 5 | 0.9991 | yes / yes | 1.82 [1.77, 1.88] | 127 | 404 |
| scann | 0.995 | 327.5 | 5 | 0.9991 | yes / yes | 1.55 [1.51, 1.60] | 127 | 404 |
| svs_vamana_leanvec | 0.98 | 217.5 | 5 | 1.0000 | yes / yes | 1.21 [1.20, 1.24] | 59 | 174 |
| svs_vamana_leanvec | 0.99 | 690.2 | 5 | 0.9928 | yes / no | 3.83 [3.80, 3.94] | 56 | 165 |
| svs_vamana_leanvec | 0.995 | 985.6 | 5 | 0.9984 | yes / yes | 4.65 [4.59, 4.82] | 59 | 178 |
| svs_vamana_lvq | 0.98 | 373.4 | 5 | 0.9854 | yes / no | 2.07 [2.05, 2.13] | 62 | 185 |
| svs_vamana_lvq | 0.99 | 780.4 | 5 | 1.0018 | yes / yes | 4.33 [4.30, 4.46] | 62 | 188 |
| svs_vamana_lvq | 0.995 | 1674.4 | 5 | 1.0019 | yes / yes | 7.90 [7.80, 8.19] | 62 | 188 |
| usearch_f16 | 0.98 | 875.3 | 5 | 0.9861 | yes / no | 4.86 [4.82, 5.00] | 56 | 170 |
| usearch_f16 | 0.99 | 1789.5 | 5 | 0.9934 | yes / no | 9.94 [9.86, 10.23] | 64 | 214 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 584.0 / 0.9717 | 633.5 / 0.9717 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2309.0 / 1.0000 | 2360.5 / 1.0000 | 3232.0 / 1.0000 |
| diskann_vamana | L 200 | 859.0 / 0.9863 | 909.4 / 0.9862 | 876.8 / 0.9863 | 927.4 / 0.9862 | 1023.7 / 0.9862 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3323.8 / 1.0004 | 3377.3 / 0.9999 | 4257.2 / 0.9999 |
| diskann_vamana | L 400 |  |  | 1305.8 / 0.9908 | 1354.2 / 0.9908 | 1454.1 / 0.9908 | 1336.8 / 0.9908 | 1385.0 / 0.9908 | 1677.8 / 0.9908 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1977.8 / 0.9963 | 2026.0 / 0.9963 | 2319.5 / 0.9962 |  |  |  |
| faiss_bin_flat | exhaustive | 135.2 / 0.9638 | 183.6 / 0.9638 | 181.9 / 0.9837 | 232.6 / 0.9837 | 331.6 / 0.9837 | 270.3 / 0.9978 | 321.1 / 0.9978 | 611.2 / 0.9978 | 521.2 / 0.9960 | 577.0 / 0.9959 | 1430.8 / 0.9959 |
| faiss_bin_hnsw | ef 100 | 158.5 / 0.8978 | 202.2 / 0.8978 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1082.1 / 0.9980 | 1134.1 / 0.9979 | 2006.1 / 0.9979 |
| faiss_bin_hnsw | ef 200 | 226.8 / 0.9375 | 277.0 / 0.9375 | 261.7 / 0.9586 | 312.3 / 0.9586 | 403.1 / 0.9586 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1821.5 / 0.9957 | 1895.7 / 0.9956 | 2762.1 / 0.9956 |
| faiss_bin_hnsw | ef 400 |  |  | 396.3 / 0.9848 | 448.7 / 0.9848 | 545.1 / 0.9848 | 465.5 / 0.9940 | 516.4 / 0.9940 | 800.4 / 0.9940 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 732.0 / 0.9991 | 784.6 / 0.9991 | 1073.2 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 100 | 295.2 / 0.9494 | 343.1 / 0.9494 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1823.6 / 0.9941 | 1878.6 / 0.9937 | 2758.3 / 0.9936 |
| faiss_hnsw_flat | ef 200 | 467.5 / 0.9693 | 515.2 / 0.9693 | 495.4 / 0.9693 | 543.5 / 0.9693 | 641.2 / 0.9693 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3027.9 / 0.9954 | 3079.4 / 0.9950 | 3980.8 / 0.9950 |
| faiss_hnsw_flat | ef 400 |  |  | 801.9 / 0.9934 | 850.7 / 0.9934 | 949.5 / 0.9934 | 857.4 / 0.9934 | 906.1 / 0.9934 | 1200.3 / 0.9934 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1396.3 / 0.9941 | 1445.9 / 0.9937 | 1741.9 / 0.9936 |  |  |  |
| faiss_rabitq_flat | exhaustive | 443.2 / 1.0003 | 478.3 / 1.0003 | 468.9 / 1.0004 | 517.7 / 0.9999 | 624.9 / 0.9999 | 534.9 / 1.0004 | 579.5 / 0.9999 | 871.6 / 0.9999 | 676.1 / 1.0004 | 723.4 / 0.9999 | 1573.7 / 0.9999 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 129.0 / 0.4793 | 177.2 / 0.4793 | 269.4 / 0.4793 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 202.7 / 0.6648 | 252.2 / 0.6648 | 537.8 / 0.6648 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 351.2 / 0.6955 | 401.7 / 0.6955 | 1259.1 / 0.6955 |
| faiss_rabitq_ivf | nprobe 3 | 83.9 / 0.2970 | 128.8 / 0.2966 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 440.3 / 0.8188 | 491.8 / 0.8188 | 1345.8 / 0.8188 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 110.6 / 0.3626 | 158.6 / 0.3626 | 250.3 / 0.3626 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 93.4 / 0.3899 | 139.5 / 0.3899 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 168.5 / 0.4555 | 217.9 / 0.4555 | 502.9 / 0.4555 |  |  |  |
| hnswlib_f32 | ef 100 | 279.8 / 0.9497 | 326.4 / 0.9497 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1585.0 / 0.9921 | 1653.5 / 0.9921 | 2536.3 / 0.9920 |
| hnswlib_f32 | ef 200 | 444.8 / 0.9783 | 496.2 / 0.9782 | 460.5 / 0.9783 | 508.7 / 0.9782 | 601.1 / 0.9782 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2470.9 / 1.0005 | 2542.6 / 1.0001 | 3430.9 / 1.0001 |
| hnswlib_f32 | ef 400 |  |  | 753.1 / 0.9906 | 802.6 / 0.9906 | 894.4 / 0.9906 | 784.1 / 0.9906 | 826.2 / 0.9906 | 1128.2 / 0.9906 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1284.5 / 0.9924 | 1321.2 / 0.9924 | 1628.3 / 0.9923 |  |  |  |
| ours_scan | ef 100 | 89.4 / 0.9592 | 111.6 / 0.9592 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 169.8 / 0.9965 | 192.3 / 0.9964 | 634.4 / 0.9964 |
| ours_scan | ef 200 |  |  | 100.5 / 0.9841 | 122.0 / 0.9841 | 163.7 / 0.9841 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 117.6 / 0.9985 | 140.1 / 0.9985 | 275.0 / 0.9985 |  |  |  |
| ours_walk | ef 100 | 81.2 / 0.9332 | 99.5 / 0.9332 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 236.9 / 0.9951 | 258.1 / 0.9951 | 696.4 / 0.9951 |
| ours_walk | ef 200 | 94.3 / 0.9504 | 114.2 / 0.9504 | 102.5 / 0.9716 | 122.8 / 0.9716 | 164.8 / 0.9716 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 291.6 / 0.9956 | 310.8 / 0.9956 | 752.1 / 0.9956 |
| ours_walk | ef 400 |  |  | 128.5 / 0.9819 | 149.5 / 0.9819 | 190.8 / 0.9819 | 144.0 / 0.9924 | 164.9 / 0.9924 | 304.2 / 0.9924 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 177.8 / 0.9964 | 198.5 / 0.9964 | 336.3 / 0.9964 |  |  |  |
| scann | reorder 100 | 447.2 / 0.9994 | 485.7 / 0.9994 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 837.5 / 1.0004 | 886.8 / 0.9999 | 1755.6 / 0.9999 |
| scann | reorder 200 |  |  | 481.1 / 1.0004 | 537.3 / 0.9999 | 634.9 / 0.9999 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 578.3 / 1.0004 | 629.1 / 0.9999 | 902.8 / 0.9999 |  |  |  |
| usearch_b1_rescore | ef 100 | 136.8 / 0.8882 | 186.5 / 0.8882 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 790.2 / 0.9958 | 843.5 / 0.9957 | 1731.5 / 0.9957 |
| usearch_b1_rescore | ef 200 | 201.7 / 0.9450 | 253.2 / 0.9450 | 213.9 / 0.9646 | 265.0 / 0.9646 | 366.1 / 0.9646 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1338.7 / 0.9963 | 1393.4 / 0.9962 | 2279.1 / 0.9962 |
| usearch_b1_rescore | ef 400 |  |  | 335.2 / 0.9936 | 386.0 / 0.9936 | 489.1 / 0.9936 | 360.4 / 0.9979 | 412.7 / 0.9979 | 719.3 / 0.9979 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 593.2 / 0.9981 | 646.6 / 0.9981 | 959.9 / 0.9981 |  |  |  |

### advtest / jina-v2-base-code (n_ho = 1200, exact quality 0.3577)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 221.5 | 5 | 0.9860 | yes / no | 2.10 [2.07, 2.12] | 108 | 370 |
| diskann_vamana | 0.99 | 298.1 | 5 | 0.9911 | yes / no | 2.82 [2.79, 2.85] | 108 | 373 |
| diskann_vamana | 0.995 | 381.5 | 5 | 0.9954 | yes / no | 3.06 [3.02, 3.10] | 104 | 349 |
| faiss_bin_flat | 0.98 | 82.8 | 5 | 1.0013 | yes / yes | 0.78 [0.77, 0.80] | 84 | 409 |
| faiss_bin_flat | 0.99 | 82.8 | 5 | 1.0013 | yes / yes | 0.78 [0.77, 0.80] | 84 | 409 |
| faiss_bin_flat | 0.995 | 82.8 | 5 | 1.0013 | yes / yes | 0.66 [0.65, 0.67] | 84 | 409 |
| faiss_bin_hnsw | 0.98 | 80.9 | 5 | 0.9950 | yes / yes | 0.77 [0.76, 0.78] | 90 | 428 |
| faiss_bin_hnsw | 0.99 | 119.7 | 5 | 0.9987 | yes / yes | 1.13 [1.12, 1.15] | 90 | 432 |
| faiss_bin_hnsw | 0.995 | 181.1 | 5 | 0.9987 | yes / no | 1.45 [1.43, 1.47] | 90 | 428 |
| faiss_exact | 0.98 | 2252.8 | 5 | 1.0000 | yes / yes | 21.33 [21.07, 21.57] | 83 | 212 |
| faiss_exact | 0.99 | 2252.8 | 5 | 1.0000 | yes / yes | 21.33 [21.07, 21.57] | 83 | 212 |
| faiss_exact | 0.995 | 2252.8 | 5 | 1.0000 | yes / yes | 18.08 [17.85, 18.29] | 83 | 212 |
| faiss_hnsw_flat | 0.98 | 118.4 | 5 | 0.9951 | yes / yes | 1.12 [1.11, 1.14] | 94 | 246 |
| faiss_hnsw_flat | 0.99 | 158.4 | 5 | 0.9880 | no / no | 1.50 [1.48, 1.52] | 94 | 236 |
| faiss_hnsw_flat | 0.995 | 199.3 | 5 | 0.9956 | yes / no | 1.60 [1.58, 1.62] | 94 | 244 |
| faiss_hnsw_sq8 | 0.98 | 116.2 | 5 | 0.9889 | yes / no | 1.10 [1.09, 1.11] | 105 | 486 |
| faiss_hnsw_sq8 | 0.99 | 168.0 | 5 | 0.9892 | no / no | 1.59 [1.57, 1.61] | 111 | 498 |
| faiss_hnsw_sq8 | 0.995 | 267.4 | 5 | 0.9977 | yes / no | 2.15 [2.12, 2.17] | 103 | 480 |
| faiss_ivfpq_fs | 0.98 | 97.6 | 5 | 0.9970 | yes / yes | 0.92 [0.91, 0.93] | 88 | 439 |
| faiss_ivfpq_fs | 0.99 | 97.6 | 5 | 0.9970 | yes / yes | 0.92 [0.91, 0.93] | 88 | 439 |
| faiss_ivfpq_fs | 0.995 | 110.7 | 5 | 0.9970 | yes / no | 0.89 [0.88, 0.90] | 87 | 434 |
| faiss_rabitq_flat | 0.98 | 320.3 | 5 | 0.9971 | yes / yes | 3.03 [2.95, 3.11] | 85 | 422 |
| faiss_rabitq_flat | 0.99 | 320.3 | 5 | 0.9971 | yes / yes | 3.03 [2.95, 3.11] | 85 | 422 |
| faiss_rabitq_flat | 0.995 | 320.3 | 5 | 0.9971 | yes / no | 2.57 [2.50, 2.64] | 85 | 422 |
| faiss_rabitq_hnsw | 0.98 | 106.9 | 5 | 0.9937 | yes / yes | 1.01 [1.00, 1.02] | 97 | 456 |
| faiss_rabitq_hnsw | 0.99 | 176.4 | 5 | 0.9986 | yes / yes | 1.67 [1.65, 1.69] | 97 | 455 |
| faiss_rabitq_hnsw | 0.995 | 280.2 | 5 | 0.9998 | yes / yes | 2.25 [2.22, 2.28] | 97 | 459 |
| faiss_rabitq_ivf | 0.98 | 216.1 | 5 | 0.9970 | yes / yes | 2.05 [2.01, 2.07] | 86 | 423 |
| faiss_rabitq_ivf | 0.99 | 216.1 | 5 | 0.9970 | yes / yes | 2.05 [2.01, 2.07] | 86 | 423 |
| faiss_rabitq_ivf | 0.995 | 407.2 | 5 | 1.0001 | yes / yes | 3.27 [3.23, 3.32] | 88 | 428 |
| hnswlib_f32 | 0.98 | 107.4 | 5 | 0.9848 | yes / no | 1.02 [1.00, 1.04] | 92 | 200 |
| hnswlib_f32 | 0.99 | 194.7 | 5 | 0.9971 | yes / yes | 1.84 [1.82, 1.87] | 97 | 218 |
| hnswlib_f32 | 0.995 | 223.8 | 5 | 0.9960 | yes / no | 1.80 [1.77, 1.82] | 89 | 188 |
| ours_cascade | 0.98 | 105.6 | 5 | 0.9987 | yes / yes |  | 174 | 129 |
| ours_cascade | 0.99 | 105.6 | 5 | 0.9987 | yes / yes |  | 174 | 129 |
| ours_cascade | 0.995 | 124.6 | 5 | 1.0008 | yes / yes |  | 174 | 193 |
| scann | 0.98 | 333.5 | 5 | 1.0000 | yes / yes | 3.16 [3.06, 3.61] | 127 | 393 |
| scann | 0.99 | 333.5 | 5 | 1.0000 | yes / yes | 3.16 [3.06, 3.61] | 127 | 393 |
| scann | 0.995 | 333.5 | 5 | 1.0000 | yes / yes | 2.68 [2.59, 3.06] | 127 | 393 |
| svs_vamana_leanvec | 0.98 | 46.8 | 5 | 0.9970 | yes / yes | 0.44 [0.44, 0.45] | 56 | 160 |
| svs_vamana_leanvec | 0.99 | 82.1 | 5 | 1.0012 | yes / yes | 0.78 [0.77, 0.79] | 56 | 160 |
| svs_vamana_leanvec | 0.995 | 82.1 | 5 | 1.0012 | yes / yes | 0.66 [0.65, 0.67] | 56 | 160 |
| svs_vamana_lvq | 0.98 | 85.1 | 5 | 0.9981 | yes / yes | 0.81 [0.80, 0.81] | 62 | 180 |
| svs_vamana_lvq | 0.99 | 118.3 | 5 | 0.9950 | yes / no | 1.12 [1.11, 1.13] | 60 | 169 |
| svs_vamana_lvq | 0.995 | 163.4 | 5 | 0.9998 | yes / yes | 1.31 [1.29, 1.33] | 62 | 180 |
| usearch_b1_rescore | 0.98 | 70.7 | 5 | 0.9884 | yes / no | 0.67 [0.66, 0.68] | 92 | 429 |
| usearch_b1_rescore | 0.99 | 104.1 | 5 | 0.9967 | yes / no | 0.99 [0.97, 1.00] | 92 | 424 |
| usearch_b1_rescore | 0.995 | 259.0 | 5 | 0.9955 | yes / no | 2.08 [2.05, 2.10] | 92 | 432 |
| usearch_f16 | 0.98 | 173.7 | 5 | 0.9882 | yes / no | 1.64 [1.62, 1.67] | 56 | 163 |
| usearch_f16 | 0.99 | 228.8 | 5 | 0.9914 | yes / no | 2.17 [2.14, 2.19] | 58 | 182 |
| usearch_f16 | 0.995 | 310.2 | 5 | 0.9937 | no / no | 2.49 [2.46, 2.52] | 55 | 162 |
| usearch_i8 | 0.98 | 163.7 | 5 | 0.9942 | yes / no | 1.55 [1.52, 1.57] | 43 | 108 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 537.6 / 0.9977 | 585.0 / 0.9977 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2208.0 / 1.0000 | 2263.2 / 1.0000 | 3156.1 / 1.0000 |
| diskann_vamana | L 200 | 793.7 / 1.0000 | 844.3 / 1.0000 | 811.9 / 1.0000 | 863.3 / 1.0000 | 959.1 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3212.1 / 1.0000 | 3265.6 / 1.0000 | 4162.7 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1222.8 / 1.0000 | 1270.8 / 1.0000 | 1373.8 / 1.0000 | 1252.1 / 1.0000 | 1304.3 / 1.0000 | 1600.1 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1875.1 / 1.0000 | 1934.8 / 1.0000 | 2227.0 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 135.5 / 1.0005 | 185.3 / 1.0005 | 182.1 / 0.9999 | 233.5 / 0.9999 | 332.3 / 0.9999 | 271.5 / 0.9997 | 321.1 / 0.9997 | 610.8 / 0.9997 | 528.0 / 1.0000 | 577.0 / 1.0000 | 1433.3 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 153.8 / 0.9964 | 197.8 / 0.9964 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1021.6 / 1.0000 | 1074.4 / 1.0000 | 1940.3 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 219.4 / 0.9996 | 268.5 / 0.9996 | 252.7 / 0.9993 | 301.3 / 0.9993 | 392.2 / 0.9993 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1742.1 / 1.0000 | 1815.1 / 1.0000 | 2678.0 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 376.8 / 0.9981 | 429.0 / 0.9981 | 522.4 / 0.9981 | 443.8 / 0.9974 | 494.1 / 0.9974 | 774.8 / 0.9974 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 690.6 / 0.9997 | 743.7 / 0.9997 | 1024.3 / 0.9997 |  |  |  |
| faiss_hnsw_flat | ef 100 | 344.1 / 0.9999 | 395.3 / 0.9999 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2004.8 / 1.0000 | 2053.1 / 1.0000 | 2959.1 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 550.3 / 1.0001 | 598.3 / 1.0001 | 577.1 / 1.0001 | 626.1 / 1.0001 | 727.2 / 1.0001 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3221.6 / 1.0000 | 3276.5 / 1.0000 | 4196.0 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 929.8 / 1.0000 | 978.1 / 1.0000 | 1074.4 / 1.0000 | 980.6 / 1.0000 | 1033.2 / 1.0000 | 1334.5 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1566.3 / 1.0000 | 1618.7 / 1.0000 | 1912.9 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 437.9 / 1.0000 | 485.5 / 1.0000 | 478.5 / 1.0000 | 517.4 / 1.0000 | 626.0 / 1.0000 | 532.5 / 1.0000 | 576.0 / 1.0000 | 862.0 / 1.0000 | 671.4 / 1.0000 | 719.2 / 1.0000 | 1566.4 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 140.5 / 0.8566 | 188.7 / 0.8566 | 284.2 / 0.8566 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 219.4 / 0.9088 | 269.5 / 0.9088 | 553.2 / 0.9088 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 383.4 / 0.9190 | 433.5 / 0.9190 | 1284.9 / 0.9190 |
| faiss_rabitq_ivf | nprobe 3 | 90.7 / 0.6559 | 138.4 / 0.6559 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 468.3 / 0.9747 | 519.7 / 0.9747 | 1366.0 / 0.9747 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 120.6 / 0.7737 | 169.0 / 0.7737 | 261.5 / 0.7737 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 101.1 / 0.7887 | 149.2 / 0.7887 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 183.2 / 0.8431 | 232.9 / 0.8431 | 517.0 / 0.8431 |  |  |  |
| hnswlib_f32 | ef 100 | 332.7 / 0.9983 | 383.5 / 0.9983 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1819.3 / 1.0000 | 1886.9 / 1.0000 | 2791.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 541.7 / 1.0000 | 590.7 / 1.0000 | 555.5 / 1.0000 | 605.0 / 1.0000 | 699.6 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2738.2 / 1.0000 | 2818.4 / 1.0000 | 3720.6 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 903.9 / 1.0000 | 955.8 / 1.0000 | 1044.0 / 1.0000 | 937.7 / 1.0000 | 980.6 / 1.0000 | 1290.8 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1495.8 / 1.0000 | 1533.4 / 1.0000 | 1850.3 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 90.2 / 1.0008 | 112.4 / 1.0008 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 170.6 / 1.0000 | 191.5 / 1.0000 | 633.3 / 1.0000 |
| ours_scan | ef 200 |  |  | 99.9 / 1.0004 | 121.6 / 1.0004 | 163.6 / 1.0004 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 117.9 / 0.9997 | 141.3 / 0.9997 | 274.2 / 0.9997 |  |  |  |
| ours_walk | ef 100 | 74.0 / 1.0006 | 90.5 / 1.0006 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 214.7 / 1.0000 | 234.6 / 1.0000 | 674.4 / 1.0000 |
| ours_walk | ef 200 | 86.8 / 1.0013 | 105.9 / 1.0013 | 94.1 / 1.0005 | 113.0 / 1.0005 | 154.2 / 1.0005 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 275.0 / 1.0000 | 296.1 / 1.0000 | 736.7 / 1.0000 |
| ours_walk | ef 400 |  |  | 112.5 / 1.0005 | 131.7 / 1.0005 | 174.0 / 1.0005 | 127.2 / 0.9997 | 146.8 / 0.9997 | 286.1 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 157.4 / 0.9997 | 177.3 / 0.9997 | 316.3 / 0.9997 |  |  |  |
| scann | reorder 100 | 436.2 / 1.0000 | 494.9 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 858.6 / 1.0000 | 888.5 / 1.0000 | 1778.5 / 1.0000 |
| scann | reorder 200 |  |  | 485.4 / 1.0000 | 547.8 / 1.0000 | 635.4 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 581.8 / 1.0000 | 618.9 / 1.0000 | 927.7 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 132.8 / 0.9920 | 182.1 / 0.9920 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 740.5 / 0.9946 | 792.9 / 0.9946 | 1677.7 / 0.9946 |
| usearch_b1_rescore | ef 200 | 193.2 / 0.9960 | 243.5 / 0.9960 | 205.1 / 0.9962 | 255.3 / 0.9962 | 355.4 / 0.9962 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1243.9 / 0.9946 | 1295.1 / 0.9946 | 2182.3 / 0.9946 |
| usearch_b1_rescore | ef 400 |  |  | 327.7 / 0.9957 | 377.7 / 0.9957 | 479.3 / 0.9957 | 353.0 / 0.9955 | 404.3 / 0.9955 | 703.4 / 0.9955 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 553.4 / 0.9943 | 606.0 / 0.9943 | 914.1 / 0.9943 |  |  |  |

### csn1m / CodeRankEmbed (n_ho = 2400, exact quality 0.5497)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 1903.6 | 5 | 0.9928 | yes / yes | 6.13 [5.36, 6.63] | 3425 | 14311 |
| diskann_vamana | 0.99 | 3220.5 | 5 | 0.9974 | yes / yes | 7.45 [7.02, 7.96] | 3425 | 14362 |
| diskann_vamana | 0.995 | 5193.6 | 5 | 0.9968 | yes / no | 9.56 [8.85, 10.10] | 3383 | 14151 |
| faiss_bin_flat | 0.98 | 3376.6 | 5 | 0.9942 | yes / yes | 10.87 [9.28, 13.50] | 3064 | 19696 |
| faiss_bin_flat | 0.99 | 3376.6 | 5 | 0.9942 | yes / no | 7.81 [6.67, 9.70] | 3064 | 19696 |
| faiss_bin_flat | 0.995 | 3002.8 | 5 | 0.9969 | yes / no | 5.53 [5.09, 7.10] | 3064 | 19651 |
| faiss_bin_hnsw | 0.98 | 1499.2 | 5 | 0.9935 | yes / yes | 4.82 [4.51, 5.22] | 3559 | 21498 |
| faiss_bin_hnsw | 0.99 | 2366.3 | 5 | 0.9946 | yes / no | 5.47 [4.96, 5.78] | 3559 | 21514 |
| faiss_bin_hnsw | 0.995 | 5583.7 | 5 | 0.9971 | yes / no | 10.28 [8.73, 10.85] | 3559 | 21509 |
| faiss_exact | 0.98 | 203883.7 | 5 | 1.0000 | yes / yes | 656.16 [638.63, 710.26] | 2971 | 10186 |
| faiss_exact | 0.99 | 203883.7 | 5 | 1.0000 | yes / yes | 471.43 [457.66, 494.12] | 2971 | 10186 |
| faiss_exact | 0.995 | 203883.7 | 5 | 1.0000 | yes / yes | 375.44 [359.26, 388.53] | 2971 | 10186 |
| faiss_hnsw_flat | 0.98 | 1583.0 | 5 | 0.9930 | yes / yes | 5.09 [4.83, 5.51] | 3479 | 11782 |
| faiss_hnsw_flat | 0.99 | 2281.5 | 5 | 0.9965 | yes / yes | 5.28 [4.99, 5.53] | 3479 | 11842 |
| faiss_hnsw_flat | 0.995 | 2930.4 | 5 | 0.9969 | yes / no | 5.40 [5.07, 5.58] | 3478 | 11809 |
| faiss_hnsw_sq8 | 0.98 | 2023.0 | 5 | 0.9905 | yes / yes | 6.51 [6.27, 7.05] | 3989 | 22847 |
| faiss_hnsw_sq8 | 0.99 | 3764.5 | 5 | 0.9974 | yes / yes | 8.70 [8.20, 9.12] | 4234 | 23801 |
| faiss_hnsw_sq8 | 0.995 | 6919.5 | 5 | 0.9986 | yes / yes | 12.74 [12.18, 13.59] | 4234 | 23793 |
| faiss_ivfpq_fs | 0.98 | 3818.2 | 5 | 0.9909 | yes / yes | 12.29 [10.55, 13.30] | 3107 | 19815 |
| faiss_ivfpq_fs | 0.99 | 4943.8 | 5 | 0.9940 | yes / no | 11.43 [9.03, 11.98] | 3088 | 19813 |
| faiss_ivfpq_fs | 0.995 | 7225.6 | 5 | 0.9963 | yes / no | 13.31 [10.80, 14.15] | 3107 | 19851 |
| faiss_rabitq_flat | 0.98 | 33153.0 | 5 | 0.9965 | yes / yes | 106.70 [99.12, 115.49] | 3103 | 19814 |
| faiss_rabitq_flat | 0.99 | 33153.0 | 5 | 0.9965 | yes / yes | 76.66 [71.17, 80.35] | 3103 | 19814 |
| faiss_rabitq_flat | 0.995 | 32393.4 | 5 | 1.0001 | yes / yes | 59.65 [55.62, 62.61] | 3103 | 19838 |
| faiss_rabitq_hnsw | 0.98 | 906.5 | 5 | 0.9873 | yes / no | 2.92 [2.67, 3.16] | 3598 | 21613 |
| faiss_rabitq_hnsw | 0.99 | 1659.3 | 5 | 0.9942 | yes / no | 3.84 [3.46, 4.03] | 3598 | 21641 |
| faiss_rabitq_hnsw | 0.995 | 3062.8 | 5 | 0.9973 | yes / no | 5.64 [5.32, 5.85] | 3598 | 21591 |
| faiss_rabitq_ivf | 0.98 | 11430.7 | 5 | 0.9908 | yes / yes | 36.79 [34.29, 39.82] | 3091 | 19870 |
| faiss_rabitq_ivf | 0.99 | 18992.1 | 5 | 0.9938 | yes / no | 43.91 [42.10, 47.90] | 3082 | 19835 |
| faiss_rabitq_ivf | 0.995 | 22247.5 | 5 | 0.9961 | yes / no | 40.97 [38.50, 42.40] | 3092 | 19862 |
| hnswlib_f32 | 0.98 | 1329.5 | 5 | 0.9932 | yes / yes | 4.28 [4.06, 4.63] | 3328 | 9944 |
| hnswlib_f32 | 0.99 | 2466.6 | 5 | 0.9957 | yes / yes | 5.70 [5.38, 5.98] | 3328 | 9961 |
| hnswlib_f32 | 0.995 | 3163.2 | 5 | 0.9987 | yes / yes | 5.82 [5.56, 6.03] | 3573 | 10657 |
| ours_cascade | 0.98 | 310.7 | 5 | 0.9899 | yes / yes |  | 3929 | 3502 |
| ours_cascade | 0.99 | 432.5 | 5 | 0.9957 | yes / yes |  | 3930 | 3518 |
| ours_cascade | 0.995 | 543.0 | 5 | 0.9976 | yes / no |  | 3900 | 3616 |
| scann | 0.98 | 7637.8 | 5 | 0.9904 | yes / yes | 24.58 [23.91, 26.61] | 3397 | 16488 |
| scann | 0.99 | 21826.8 | 5 | 0.9926 | yes / no | 50.47 [49.14, 52.90] | 3221 | 13376 |
| scann | 0.995 | 22030.6 | 5 | 0.9962 | yes / no | 40.57 [38.57, 41.98] | 3243 | 13408 |
| svs_vamana_leanvec | 0.98 | 1100.7 | 5 | 0.9900 | yes / yes | 3.54 [3.31, 3.83] | 1168 | 4955 |
| svs_vamana_leanvec | 0.99 | 2142.6 | 5 | 0.9937 | yes / no | 4.95 [4.67, 5.19] | 1168 | 4961 |
| svs_vamana_leanvec | 0.995 | 4304.5 | 5 | 0.9960 | yes / no | 7.93 [7.40, 8.20] | 1168 | 4957 |
| svs_vamana_lvq | 0.98 | 841.0 | 5 | 0.9914 | yes / yes | 2.71 [2.53, 2.93] | 1403 | 5986 |
| svs_vamana_lvq | 0.99 | 1627.7 | 5 | 0.9974 | yes / yes | 3.76 [3.61, 3.94] | 1403 | 5971 |
| svs_vamana_lvq | 0.995 | 3235.2 | 5 | 0.9994 | yes / yes | 5.96 [5.62, 6.17] | 1403 | 5997 |
| usearch_b1_rescore | 0.98 | 1240.1 | 5 | 0.9834 | yes / no | 3.99 [3.67, 4.32] | 3407 | 20568 |
| usearch_b1_rescore | 0.99 | 2552.9 | 5 | 0.9959 | yes / yes | 5.90 [5.27, 6.24] | 3652 | 21373 |
| usearch_f16 | 0.98 | 2543.8 | 5 | 0.9912 | yes / yes | 8.19 [7.46, 8.86] | 1867 | 7295 |
| usearch_f16 | 0.99 | 4691.9 | 5 | 0.9945 | yes / no | 10.85 [10.04, 11.52] | 1867 | 7297 |
| usearch_f16 | 0.995 | 8917.4 | 5 | 0.9995 | yes / yes | 16.42 [14.87, 17.19] | 2112 | 8064 |
| usearch_i8 | 0.98 | 2017.6 | 5 | 0.9873 | yes / no | 6.49 [5.92, 7.19] | 1376 | 4889 |
| usearch_i8 | 0.99 | 3633.2 | 5 | 0.9936 | yes / no | 8.40 [7.83, 9.39] | 1131 | 4114 |
| usearch_i8 | 0.995 | 12762.0 | 5 | 0.9958 | yes / no | 23.50 [21.94, 26.42] | 1131 | 4123 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 2097.7 / 0.9930 | 2215.2 / 0.9932 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 14744.0 / 0.9998 | 14708.9 / 0.9998 | 15871.5 / 0.9998 |
| diskann_vamana | L 200 | 3534.9 / 0.9953 | 3612.3 / 0.9953 | 3594.1 / 0.9952 | 3692.4 / 0.9953 | 3854.3 / 0.9953 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 26698.7 / 0.9998 | 26158.7 / 0.9998 | 27541.3 / 0.9998 |
| diskann_vamana | L 400 |  |  | 6534.0 / 0.9990 | 6593.5 / 0.9991 | 6932.6 / 0.9991 | 6695.9 / 0.9990 | 6739.3 / 0.9991 | 7203.0 / 0.9991 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 12116.9 / 0.9998 | 12144.6 / 0.9998 | 12567.5 / 0.9998 |  |  |  |
| faiss_bin_flat | exhaustive | 2787.6 / 0.9913 | 2756.8 / 0.9913 | 3018.3 / 0.9943 | 2978.4 / 0.9943 | 3266.9 / 0.9943 | 3302.1 / 0.9977 | 3547.7 / 0.9977 | 4049.1 / 0.9977 | 4574.9 / 0.9999 | 4049.4 / 0.9998 | 5929.9 / 0.9998 |
| faiss_bin_hnsw | ef 100 | 531.1 / 0.9540 | 583.9 / 0.9540 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3969.2 / 0.9946 | 4026.0 / 0.9946 | 5234.4 / 0.9946 |
| faiss_bin_hnsw | ef 200 | 844.6 / 0.9718 | 929.7 / 0.9718 | 929.3 / 0.9743 | 999.7 / 0.9743 | 1107.0 / 0.9743 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 7178.6 / 0.9995 | 7100.0 / 0.9995 | 8408.5 / 0.9995 |
| faiss_bin_hnsw | ef 400 |  |  | 1532.7 / 0.9833 | 1615.9 / 0.9833 | 1758.5 / 0.9833 | 1690.6 / 0.9872 | 1767.9 / 0.9871 | 2213.9 / 0.9871 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2897.7 / 0.9928 | 2988.3 / 0.9927 | 3414.7 / 0.9927 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1409.0 / 0.9892 | 1415.3 / 0.9892 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 11044.8 / 1.0000 | 11017.4 / 1.0000 | 12402.2 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 2523.6 / 0.9951 | 2526.6 / 0.9951 | 2595.0 / 0.9952 | 2607.9 / 0.9951 | 2765.7 / 0.9951 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 20180.5 / 1.0000 | 20185.7 / 1.0000 | 21337.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 4693.4 / 0.9991 | 4693.3 / 0.9991 | 4844.0 / 0.9991 | 4791.8 / 0.9991 | 4874.4 / 0.9991 | 5239.8 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 8702.5 / 1.0000 | 8769.7 / 1.0000 | 9217.9 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 34949.8 / 0.9999 | 36330.3 / 1.0000 | 36762.6 / 1.0000 | 36896.8 / 1.0000 | 32836.8 / 1.0000 | 33009.9 / 1.0000 | 37182.6 / 1.0000 | 37004.8 / 1.0000 | 32718.6 / 1.0000 | 33467.1 / 1.0000 | 38833.0 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 260.7 / 0.4390 | 337.9 / 0.4390 | 318.0 / 0.4390 | 402.0 / 0.4390 | 550.7 / 0.4390 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 316.0 / 0.5791 | 387.1 / 0.5790 | 374.7 / 0.5790 | 452.7 / 0.5790 | 601.5 / 0.5790 | 482.8 / 0.5790 | 559.8 / 0.5790 | 1008.5 / 0.5790 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 788.5 / 0.6485 | 904.2 / 0.6485 | 2103.3 / 0.6485 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 575.8 / 0.7009 | 664.5 / 0.7009 | 1088.0 / 0.7009 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 994.3 / 0.7542 | 1066.8 / 0.7542 | 2303.9 / 0.7542 |
| hnswlib_f32 | ef 100 | 1326.7 / 0.9903 | 1417.9 / 0.9903 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 10311.8 / 0.9996 | 10281.1 / 0.9996 | 11572.0 / 0.9996 |
| hnswlib_f32 | ef 200 | 2354.4 / 0.9950 | 2437.3 / 0.9950 | 2431.2 / 0.9949 | 2508.2 / 0.9949 | 2607.9 / 0.9950 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 18755.8 / 1.0000 | 18709.0 / 1.0000 | 19932.0 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 4418.4 / 0.9979 | 4443.9 / 0.9980 | 4569.7 / 0.9980 | 4507.9 / 0.9980 | 4563.4 / 0.9980 | 5002.6 / 0.9980 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 8171.6 / 0.9986 | 8272.0 / 0.9986 | 8724.4 / 0.9986 |  |  |  |
| ours_scan | ef 100 | 182.8 / 0.9781 | 200.2 / 0.9781 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 722.6 / 0.9980 | 738.3 / 0.9980 | 1386.2 / 0.9980 |
| ours_scan | ef 200 |  |  | 252.2 / 0.9900 | 293.4 / 0.9899 | 342.7 / 0.9899 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 379.9 / 0.9958 | 400.3 / 0.9957 | 602.8 / 0.9957 |  |  |  |
| ours_walk | ef 100 | 176.3 / 0.9781 | 205.0 / 0.9781 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 766.8 / 0.9980 | 723.1 / 0.9980 | 1403.8 / 0.9980 |
| ours_walk | ef 200 | 239.2 / 0.9861 | 259.2 / 0.9861 | 309.4 / 0.9900 | 332.5 / 0.9899 | 413.9 / 0.9899 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 1109.6 / 0.9997 | 1036.6 / 0.9996 | 1825.4 / 0.9996 |
| ours_walk | ef 400 |  |  | 505.8 / 0.9924 | 1112.2 / 0.9923 | 1170.3 / 0.9923 | 451.6 / 0.9958 | 412.5 / 0.9957 | 733.3 / 0.9957 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 855.1 / 0.9958 | 671.6 / 0.9957 | 1413.6 / 0.9957 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 372.3 / 0.4356 | 458.5 / 0.4356 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 435.4 / 0.4356 | 540.3 / 0.4356 | 704.6 / 0.4356 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 413.4 / 0.5741 | 501.5 / 0.5740 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 499.5 / 0.5740 | 589.5 / 0.5740 | 745.8 / 0.5740 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 666.7 / 0.5740 | 708.4 / 0.5740 | 1251.3 / 0.5740 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 1200.6 / 0.6568 | 1239.6 / 0.6568 | 2519.1 / 0.6568 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 733.8 / 0.6948 | 830.3 / 0.6948 | 1315.1 / 0.6948 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 1325.6 / 0.7508 | 1405.6 / 0.7508 | 2694.8 / 0.7508 |
| usearch_b1_rescore | ef 100 | 483.0 / 0.9492 | 468.3 / 0.9492 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 3438.4 / 0.9987 | 3443.8 / 0.9987 | 4864.9 / 0.9987 |
| usearch_b1_rescore | ef 200 | 742.1 / 0.9721 | 794.2 / 0.9721 | 814.3 / 0.9744 | 899.4 / 0.9744 | 910.8 / 0.9744 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 6590.5 / 1.0001 | 6395.8 / 1.0001 | 7798.7 / 1.0001 |
| usearch_b1_rescore | ef 400 |  |  | 1364.1 / 0.9856 | 1429.7 / 0.9856 | 1476.9 / 0.9856 | 1438.2 / 0.9904 | 1521.2 / 0.9903 | 1943.5 / 0.9903 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2579.3 / 0.9956 | 2637.5 / 0.9955 | 3113.7 / 0.9955 |  |  |  |

### csn1m / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.2580)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 2179.0 | 5 | 0.9883 | yes / no | 3.07 [2.72, 3.16] | 3313 | 13968 |
| diskann_vamana | 0.99 | 3621.0 | 5 | 0.9878 | no / no | 2.20 [2.08, 2.32] | 3313 | 13950 |
| diskann_vamana | 0.995 | 8802.6 | 5 | 1.0008 | yes / yes |  | 3432 | 14452 |
| faiss_bin_flat | 0.98 | 3075.4 | 5 | 0.9873 | yes / no | 4.34 [3.73, 5.10] | 3064 | 19888 |
| faiss_bin_hnsw | 0.98 | 4886.8 | 5 | 0.9821 | yes / no | 6.89 [5.62, 7.15] | 3559 | 21744 |
| faiss_exact | 0.98 | 203496.6 | 5 | 1.0000 | yes / yes | 287.00 [281.39, 295.35] | 2971 | 10275 |
| faiss_exact | 0.99 | 203496.6 | 5 | 1.0000 | yes / yes | 123.82 [121.12, 130.55] | 2971 | 10275 |
| faiss_exact | 0.995 | 203496.6 | 5 | 1.0000 | yes / yes |  | 2971 | 10275 |
| faiss_hnsw_flat | 0.98 | 1939.2 | 5 | 0.9895 | yes / yes | 2.73 [2.54, 2.81] | 3479 | 11909 |
| faiss_hnsw_flat | 0.99 | 3578.7 | 5 | 0.9970 | yes / yes | 2.18 [2.02, 2.30] | 3479 | 11941 |
| faiss_hnsw_flat | 0.995 | 12246.4 | 5 | 0.9984 | yes / no |  | 3479 | 11966 |
| faiss_hnsw_sq8 | 0.98 | 3039.8 | 5 | 0.9896 | yes / yes | 4.29 [4.20, 4.60] | 4234 | 24024 |
| faiss_hnsw_sq8 | 0.99 | 5585.7 | 5 | 0.9970 | yes / yes | 3.40 [3.33, 3.75] | 4234 | 24017 |
| faiss_hnsw_sq8 | 0.995 | 10433.7 | 5 | 0.9984 | yes / no |  | 4234 | 23991 |
| faiss_ivfpq_fs | 0.98 | 9746.7 | 5 | 1.0020 | yes / yes | 13.75 [10.75, 14.15] | 3088 | 19991 |
| faiss_ivfpq_fs | 0.99 | 9746.7 | 5 | 1.0020 | yes / yes | 5.93 [4.64, 6.25] | 3088 | 19991 |
| faiss_ivfpq_fs | 0.995 | 9746.7 | 5 | 1.0020 | yes / yes |  | 3088 | 19991 |
| faiss_rabitq_flat | 0.98 | 29101.7 | 5 | 1.0006 | yes / yes | 41.04 [38.31, 43.79] | 3103 | 19985 |
| faiss_rabitq_flat | 0.99 | 29101.7 | 5 | 1.0006 | yes / yes | 17.71 [16.53, 18.92] | 3103 | 19985 |
| faiss_rabitq_flat | 0.995 | 29101.7 | 5 | 1.0006 | yes / yes |  | 3103 | 19985 |
| faiss_rabitq_hnsw | 0.98 | 5252.6 | 5 | 0.9845 | yes / no | 7.41 [6.68, 7.62] | 3598 | 21855 |
| faiss_rabitq_ivf | 0.98 | 39338.3 | 5 | 0.9998 | yes / yes | 55.48 [54.76, 57.09] | 3082 | 20006 |
| faiss_rabitq_ivf | 0.99 | 39338.3 | 5 | 0.9998 | yes / yes | 23.94 [23.46, 25.24] | 3082 | 20006 |
| faiss_rabitq_ivf | 0.995 | 39338.3 | 5 | 0.9998 | yes / yes |  | 3082 | 20006 |
| hnswlib_f32 | 0.98 | 2213.5 | 5 | 0.9907 | yes / yes | 3.12 [2.95, 3.21] | 3328 | 10059 |
| hnswlib_f32 | 0.99 | 3890.9 | 5 | 0.9951 | yes / no | 2.37 [2.22, 2.50] | 3573 | 10781 |
| hnswlib_f32 | 0.995 | 7248.9 | 5 | 0.9981 | yes / no |  | 3573 | 10813 |
| ours_cascade | 0.98 | 709.1 | 5 | 0.9909 | yes / yes |  | 3901 | 4030 |
| ours_cascade | 0.99 | 1643.5 | 5 | 0.9971 | yes / yes |  | 3905 | 5384 |
| scann | 0.98 | 21961.3 | 5 | 0.9999 | yes / yes | 30.97 [30.02, 31.87] | 3223 | 13529 |
| scann | 0.99 | 22756.5 | 5 | 0.9961 | yes / yes | 13.85 [13.57, 14.60] | 3394 | 16704 |
| scann | 0.995 | 37613.3 | 5 | 1.0000 | yes / yes |  | 3394 | 16707 |
| svs_vamana_lvq | 0.98 | 3197.8 | 5 | 0.9940 | yes / yes | 4.51 [4.42, 4.64] | 1403 | 5993 |
| svs_vamana_lvq | 0.99 | 6447.9 | 5 | 0.9942 | yes / no | 3.92 [3.84, 4.14] | 1403 | 6000 |
| usearch_f16 | 0.98 | 4061.4 | 5 | 0.9924 | yes / yes | 5.73 [5.36, 5.89] | 2112 | 8131 |
| usearch_f16 | 0.99 | 7476.7 | 5 | 0.9966 | yes / yes | 4.55 [4.11, 4.80] | 2112 | 8133 |
| usearch_f16 | 0.995 | 14106.4 | 5 | 0.9980 | yes / no |  | 1867 | 7336 |
| usearch_i8 | 0.98 | 10548.9 | 5 | 0.9849 | yes / no | 14.88 [13.80, 15.68] | 1376 | 4938 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1926.0 / 0.9797 | 2057.2 / 0.9799 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 12786.6 / 0.9993 | 13036.7 / 0.9989 | 14405.3 / 0.9991 |
| diskann_vamana | L 200 | 3200.5 / 0.9907 | 3275.4 / 0.9909 | 3231.1 / 0.9910 | 3291.2 / 0.9909 | 3474.5 / 0.9909 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 22634.6 / 0.9993 | 23124.2 / 0.9989 | 24148.3 / 0.9991 |
| diskann_vamana | L 400 |  |  | 5716.7 / 0.9931 | 5805.3 / 0.9930 | 5941.3 / 0.9930 | 5858.7 / 0.9931 | 5912.4 / 0.9930 | 6275.0 / 0.9930 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 10491.6 / 0.9993 | 10567.6 / 0.9989 | 10925.8 / 0.9991 |  |  |  |
| faiss_bin_flat | exhaustive | 2996.9 / 0.9719 | 2976.8 / 0.9719 | 2962.6 / 0.9827 | 3287.1 / 0.9827 | 3242.1 / 0.9827 | 3232.4 / 0.9893 | 3366.7 / 0.9895 | 3863.7 / 0.9895 | 4293.4 / 0.9957 | 4616.0 / 0.9956 | 6701.2 / 0.9956 |
| faiss_bin_hnsw | ef 100 | 520.4 / 0.8970 | 580.6 / 0.8970 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3848.1 / 0.9937 | 3894.2 / 0.9936 | 5156.7 / 0.9935 |
| faiss_bin_hnsw | ef 200 | 828.8 / 0.9357 | 902.1 / 0.9357 | 880.3 / 0.9454 | 959.7 / 0.9452 | 1069.6 / 0.9452 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 6845.6 / 0.9952 | 6862.6 / 0.9951 | 8166.7 / 0.9951 |
| faiss_bin_hnsw | ef 400 |  |  | 1478.8 / 0.9707 | 1562.8 / 0.9707 | 1686.0 / 0.9707 | 1587.9 / 0.9762 | 1669.7 / 0.9764 | 2118.9 / 0.9764 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2734.8 / 0.9862 | 2841.3 / 0.9864 | 3217.6 / 0.9864 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1295.0 / 0.9840 | 1286.9 / 0.9842 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 9716.7 / 0.9984 | 9807.5 / 0.9980 | 10990.9 / 0.9982 |
| faiss_hnsw_flat | ef 200 | 2287.1 / 0.9915 | 2268.2 / 0.9917 | 2303.0 / 0.9918 | 2333.5 / 0.9917 | 2473.5 / 0.9917 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 17486.6 / 0.9985 | 17614.5 / 0.9981 | 18836.0 / 0.9983 |
| faiss_hnsw_flat | ef 400 |  |  | 4113.7 / 0.9970 | 4174.9 / 0.9969 | 4267.3 / 0.9969 | 4211.8 / 0.9970 | 4249.8 / 0.9967 | 4656.9 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 7618.4 / 0.9979 | 7604.2 / 0.9975 | 8024.6 / 0.9977 |  |  |  |
| faiss_rabitq_flat | exhaustive | 33693.1 / 1.0000 | 36848.8 / 0.9999 | 35971.1 / 0.9999 | 35940.3 / 0.9997 | 33322.0 / 0.9997 | 32368.3 / 1.0001 | 36657.2 / 1.0000 | 33962.1 / 0.9999 | 33888.5 / 1.0001 | 33848.3 / 0.9998 | 39517.2 / 0.9999 |
| faiss_rabitq_ivf | nprobe 1 | 267.2 / 0.2257 | 338.7 / 0.2257 | 315.6 / 0.2257 | 401.2 / 0.2257 | 543.2 / 0.2257 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 311.8 / 0.3084 | 391.1 / 0.3084 | 362.3 / 0.3084 | 450.1 / 0.3084 | 595.6 / 0.3084 | 471.7 / 0.3084 | 550.0 / 0.3084 | 993.4 / 0.3084 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 787.6 / 0.3582 | 906.9 / 0.3582 | 2100.9 / 0.3582 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 565.1 / 0.3896 | 658.2 / 0.3896 | 1065.4 / 0.3896 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 994.1 / 0.4355 | 1076.6 / 0.4354 | 2282.0 / 0.4354 |
| hnswlib_f32 | ef 100 | 1259.2 / 0.9793 | 1322.9 / 0.9793 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 9412.9 / 0.9974 | 9494.3 / 0.9971 | 10750.8 / 0.9973 |
| hnswlib_f32 | ef 200 | 2209.6 / 0.9911 | 2261.9 / 0.9913 | 2207.8 / 0.9914 | 2330.2 / 0.9913 | 2457.1 / 0.9913 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 16755.5 / 0.9982 | 16835.0 / 0.9979 | 18068.3 / 0.9981 |
| hnswlib_f32 | ef 400 |  |  | 4019.5 / 0.9966 | 4143.1 / 0.9965 | 4256.7 / 0.9965 | 4133.4 / 0.9966 | 4166.1 / 0.9963 | 4584.2 / 0.9965 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 7417.8 / 0.9974 | 7471.5 / 0.9971 | 7925.4 / 0.9973 |  |  |  |
| ours_scan | ef 100 | 165.6 / 0.9327 | 195.9 / 0.9327 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 657.6 / 0.9911 | 680.3 / 0.9909 | 1317.1 / 0.9909 |
| ours_scan | ef 200 |  |  | 2699.4 / 0.9583 | 264.1 / 0.9582 | 341.4 / 0.9582 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 384.4 / 0.9710 | 2106.6 / 0.9712 | 2255.6 / 0.9712 |  |  |  |
| ours_walk | ef 100 | 167.6 / 0.9327 | 193.7 / 0.9327 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 650.2 / 0.9911 | 658.6 / 0.9909 | 1308.3 / 0.9909 |
| ours_walk | ef 200 | 215.4 / 0.9462 | 243.7 / 0.9462 | 287.3 / 0.9583 | 263.7 / 0.9582 | 321.4 / 0.9582 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 914.3 / 0.9935 | 941.4 / 0.9933 | 1581.8 / 0.9933 |
| ours_walk | ef 400 |  |  | 5730.4 / 0.9657 | 351.2 / 0.9657 | 408.6 / 0.9657 | 2083.8 / 0.9710 | 2087.0 / 0.9712 | 2278.8 / 0.9712 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 2202.3 / 0.9800 | 2127.4 / 0.9802 | 2367.5 / 0.9802 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 370.5 / 0.2315 | 456.7 / 0.2315 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 431.7 / 0.2315 | 539.0 / 0.2315 | 702.0 / 0.2315 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 412.9 / 0.3199 | 503.8 / 0.3199 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 491.9 / 0.3199 | 585.5 / 0.3199 | 744.2 / 0.3199 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 661.5 / 0.3199 | 703.1 / 0.3199 | 1251.1 / 0.3199 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 1199.0 / 0.3646 | 1231.6 / 0.3646 | 2513.0 / 0.3646 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 732.1 / 0.3945 | 825.8 / 0.3945 | 1309.4 / 0.3945 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 1310.6 / 0.4493 | 1411.6 / 0.4493 | 2699.6 / 0.4493 |
| usearch_b1_rescore | ef 100 | 489.8 / 0.8977 | 479.6 / 0.8977 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 3376.4 / 0.9851 | 3427.3 / 0.9849 | 4821.8 / 0.9849 |
| usearch_b1_rescore | ef 200 | 769.4 / 0.9332 | 811.5 / 0.9332 | 799.0 / 0.9447 | 841.0 / 0.9447 | 871.3 / 0.9447 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 6319.3 / 0.9861 | 6354.7 / 0.9861 | 7719.7 / 0.9860 |
| usearch_b1_rescore | ef 400 |  |  | 1303.2 / 0.9579 | 1393.4 / 0.9579 | 1412.4 / 0.9579 | 1422.7 / 0.9642 | 1448.3 / 0.9644 | 1884.8 / 0.9644 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2521.1 / 0.9755 | 2622.6 / 0.9757 | 3058.5 / 0.9757 |  |  |  |

### csn1m / jina-v2-base-code (n_ho = 2400, exact quality 0.4412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 545.7 | 5 | 0.9802 | yes / no | 3.41 [0.01, 3.76] | 3412 | 14256 |
| diskann_vamana | 0.99 | 830.7 | 5 | 0.9917 | yes / no | 4.45 [0.02, 5.08] | 3412 | 14270 |
| diskann_vamana | 0.995 | 1334.2 | 5 | 0.9959 | yes / no | 5.29 [0.03, 6.20] | 3412 | 14278 |
| faiss_bin_flat | 0.98 | 2503.8 | 5 | 0.9976 | yes / yes | 15.65 [0.06, 21.38] | 3064 | 19697 |
| faiss_bin_flat | 0.99 | 2503.8 | 5 | 0.9976 | yes / yes | 13.42 [0.07, 18.33] | 3064 | 19697 |
| faiss_bin_flat | 0.995 | 2503.8 | 5 | 0.9976 | yes / no | 9.93 [0.06, 13.56] | 3064 | 19697 |
| faiss_bin_hnsw | 0.98 | 370.9 | 5 | 0.9893 | yes / yes | 2.32 [0.01, 2.59] | 3314 | 20610 |
| faiss_bin_hnsw | 0.99 | 579.9 | 5 | 0.9952 | yes / yes | 3.11 [0.02, 3.64] | 3559 | 21511 |
| faiss_bin_hnsw | 0.995 | 850.6 | 5 | 0.9977 | yes / yes | 3.37 [0.02, 3.86] | 3559 | 21527 |
| faiss_exact | 0.98 | 196510.2 | 5 | 1.0000 | yes / yes | 1228.53 [4.70, 1344.77] | 2971 | 10194 |
| faiss_exact | 0.99 | 196510.2 | 5 | 1.0000 | yes / yes | 1053.22 [5.49, 1187.12] | 2971 | 10194 |
| faiss_exact | 0.995 | 196510.2 | 5 | 1.0000 | yes / yes | 779.50 [4.51, 894.41] | 2971 | 10194 |
| faiss_hnsw_flat | 0.98 | 398.5 | 5 | 0.9819 | yes / no | 2.49 [0.01, 2.74] | 3234 | 10873 |
| faiss_hnsw_flat | 0.99 | 696.6 | 5 | 0.9932 | yes / no | 3.73 [0.02, 4.27] | 3234 | 10953 |
| faiss_hnsw_flat | 0.995 | 942.2 | 5 | 0.9955 | yes / no | 3.74 [0.02, 4.27] | 3479 | 11860 |
| faiss_hnsw_sq8 | 0.98 | 655.1 | 5 | 0.9819 | yes / no | 4.10 [0.02, 4.60] | 3867 | 22456 |
| faiss_hnsw_sq8 | 0.99 | 1044.9 | 5 | 0.9919 | yes / no | 5.60 [0.03, 6.46] | 4234 | 23781 |
| faiss_hnsw_sq8 | 0.995 | 1486.4 | 5 | 0.9955 | yes / no | 5.90 [0.03, 6.74] | 4234 | 23856 |
| faiss_ivfpq_fs | 0.98 | 1708.9 | 5 | 0.9966 | yes / yes | 10.68 [0.04, 12.92] | 3107 | 19852 |
| faiss_ivfpq_fs | 0.99 | 1901.0 | 5 | 0.9982 | yes / yes | 10.19 [0.05, 13.67] | 3088 | 19750 |
| faiss_ivfpq_fs | 0.995 | 1901.0 | 5 | 0.9982 | yes / no | 7.54 [0.04, 10.12] | 3088 | 19750 |
| faiss_rabitq_flat | 0.98 | 28106.2 | 5 | 1.0001 | yes / yes | 175.71 [0.67, 195.23] | 3103 | 19806 |
| faiss_rabitq_flat | 0.99 | 28106.2 | 5 | 1.0001 | yes / yes | 150.64 [0.79, 173.28] | 3103 | 19806 |
| faiss_rabitq_flat | 0.995 | 28106.2 | 5 | 1.0001 | yes / yes | 111.49 [0.65, 129.58] | 3103 | 19806 |
| faiss_rabitq_hnsw | 0.98 | 404.7 | 5 | 0.9913 | yes / yes | 2.53 [0.01, 2.82] | 3598 | 21637 |
| faiss_rabitq_hnsw | 0.99 | 700.0 | 5 | 0.9977 | yes / yes | 3.75 [0.02, 4.33] | 3598 | 21641 |
| faiss_rabitq_hnsw | 0.995 | 806.1 | 5 | 0.9983 | yes / no | 3.20 [0.02, 3.65] | 3598 | 21650 |
| faiss_rabitq_ivf | 0.98 | 5185.7 | 5 | 0.9966 | yes / yes | 32.42 [0.12, 35.90] | 3092 | 19855 |
| faiss_rabitq_ivf | 0.99 | 8635.6 | 5 | 0.9982 | yes / yes | 46.28 [0.24, 57.05] | 3082 | 19825 |
| faiss_rabitq_ivf | 0.995 | 8635.6 | 5 | 0.9982 | yes / no | 34.26 [0.20, 42.22] | 3082 | 19825 |
| hnswlib_f32 | 0.98 | 431.7 | 5 | 0.9813 | yes / no | 2.70 [0.01, 2.98] | 3573 | 10714 |
| hnswlib_f32 | 0.99 | 725.5 | 5 | 0.9951 | yes / yes | 3.89 [0.02, 4.53] | 3573 | 10716 |
| hnswlib_f32 | 0.995 | 1045.1 | 5 | 0.9964 | yes / no | 4.15 [0.02, 4.74] | 3573 | 10696 |
| ours_cascade | 0.98 | 160.0 | 5 | 0.9927 | yes / yes |  | 3899 | 3295 |
| ours_cascade | 0.99 | 186.6 | 5 | 0.9954 | yes / yes |  | 3930 | 3344 |
| ours_cascade | 0.995 | 252.1 | 5 | 0.9977 | yes / yes |  | 3894 | 3449 |
| scann | 0.98 | 2421.1 | 5 | 0.9888 | yes / yes | 15.14 [0.06, 16.59] | 3388 | 16478 |
| scann | 0.99 | 2421.1 | 5 | 0.9888 | no / no | 12.98 [0.07, 14.73] | 3388 | 16478 |
| scann | 0.995 | 7583.4 | 5 | 0.9979 | yes / no | 30.08 [0.17, 34.32] | 3388 | 16507 |
| svs_vamana_leanvec | 0.98 | 269.1 | 5 | 0.9890 | yes / yes | 1.68 [0.01, 1.88] | 1168 | 4942 |
| svs_vamana_leanvec | 0.99 | 511.0 | 5 | 0.9949 | yes / yes | 2.74 [0.01, 3.11] | 1168 | 4938 |
| svs_vamana_leanvec | 0.995 | 1012.1 | 5 | 0.9981 | yes / yes | 4.01 [0.02, 4.62] | 1168 | 4935 |
| svs_vamana_lvq | 0.98 | 387.7 | 5 | 0.9895 | yes / yes | 2.42 [0.01, 2.65] | 1403 | 5954 |
| svs_vamana_lvq | 0.99 | 741.5 | 5 | 0.9975 | yes / yes | 3.97 [0.02, 4.51] | 1403 | 5937 |
| svs_vamana_lvq | 0.995 | 1456.1 | 5 | 0.9996 | yes / yes | 5.78 [0.03, 6.62] | 1403 | 5933 |
| usearch_b1_rescore | 0.98 | 229.8 | 5 | 0.9810 | yes / no | 1.44 [0.01, 1.60] | 3407 | 20633 |
| usearch_b1_rescore | 0.99 | 345.4 | 5 | 0.9882 | no / no | 1.85 [0.01, 2.09] | 3407 | 20584 |
| usearch_b1_rescore | 0.995 | 772.8 | 5 | 0.9972 | yes / no | 3.07 [0.02, 3.53] | 3407 | 20639 |
| usearch_f16 | 0.98 | 767.7 | 5 | 0.9859 | yes / yes | 4.80 [0.02, 5.29] | 2112 | 8056 |
| usearch_f16 | 0.99 | 1075.0 | 5 | 0.9877 | no / no | 5.76 [0.03, 6.61] | 2112 | 8067 |
| usearch_f16 | 0.995 | 2226.0 | 5 | 0.9971 | yes / no | 8.83 [0.05, 10.85] | 1867 | 7282 |
| usearch_i8 | 0.98 | 856.3 | 5 | 0.9805 | yes / no | 5.35 [0.02, 5.89] | 1376 | 4889 |
| usearch_i8 | 0.99 | 1742.8 | 5 | 0.9893 | no / no | 9.34 [0.05, 10.66] | 1131 | 4128 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1488.5 / 0.9990 | 1503.0 / 0.9990 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 10127.1 / 1.0000 | 10282.8 / 1.0000 | 11269.5 / 1.0000 |
| diskann_vamana | L 200 | 2579.0 / 0.9999 | 2595.8 / 0.9999 | 2570.9 / 0.9999 | 2680.3 / 0.9999 | 2708.7 / 0.9999 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 18343.8 / 1.0000 | 18198.2 / 1.0000 | 19251.8 / 1.0000 |
| diskann_vamana | L 400 |  |  | 4434.8 / 0.9999 | 4607.1 / 0.9999 | 4576.4 / 0.9999 | 4721.8 / 0.9999 | 4608.7 / 0.9999 | 5061.1 / 0.9999 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 8326.4 / 1.0000 | 8163.9 / 1.0000 | 8624.5 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 2590.2 / 0.9972 | 2745.8 / 0.9972 | 2832.3 / 0.9982 | 2825.7 / 0.9982 | 2910.4 / 0.9982 | 2935.9 / 0.9998 | 2983.2 / 0.9998 | 3459.5 / 0.9998 | 3526.8 / 1.0000 | 3653.9 / 1.0000 | 4818.3 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 449.6 / 0.9883 | 509.6 / 0.9883 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3051.9 / 1.0000 | 3101.1 / 1.0000 | 4097.5 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 679.9 / 0.9926 | 746.9 / 0.9926 | 713.8 / 0.9946 | 812.6 / 0.9946 | 872.0 / 0.9946 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5409.6 / 1.0000 | 5555.9 / 1.0000 | 6656.6 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 1218.3 / 0.9982 | 1276.4 / 0.9982 | 1294.0 / 0.9982 | 1335.2 / 0.9998 | 1428.4 / 0.9998 | 1707.2 / 0.9998 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2243.3 / 0.9998 | 2279.6 / 0.9998 | 2747.3 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1153.0 / 0.9967 | 1152.5 / 0.9967 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 8439.9 / 1.0000 | 8449.4 / 1.0000 | 9510.7 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 2020.1 / 0.9989 | 2004.2 / 0.9989 | 2077.7 / 0.9989 | 2061.8 / 0.9989 | 2190.4 / 0.9989 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 15377.2 / 1.0000 | 15386.3 / 1.0000 | 16588.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 3636.9 / 1.0000 | 3638.2 / 1.0000 | 3784.9 / 1.0000 | 3694.3 / 1.0000 | 3773.0 / 1.0000 | 4069.6 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 6724.7 / 1.0000 | 6745.4 / 1.0000 | 7076.6 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 32942.2 / 1.0000 | 34180.4 / 1.0000 | 33066.7 / 1.0000 | 33503.6 / 1.0000 | 32011.5 / 1.0000 | 30744.7 / 1.0000 | 35107.6 / 1.0000 | 33450.3 / 1.0000 | 29775.2 / 1.0000 | 32539.6 / 1.0000 | 35040.4 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 251.2 / 0.5727 | 321.9 / 0.5727 | 296.9 / 0.5727 | 371.9 / 0.5727 | 523.5 / 0.5727 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 292.5 / 0.7199 | 370.5 / 0.7199 | 344.8 / 0.7199 | 415.9 / 0.7199 | 562.2 / 0.7199 | 440.8 / 0.7199 | 508.0 / 0.7199 | 938.3 / 0.7199 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 732.2 / 0.7876 | 805.7 / 0.7876 | 2088.9 / 0.7876 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 507.8 / 0.8236 | 582.2 / 0.8236 | 1014.4 / 0.8236 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 841.7 / 0.8709 | 921.5 / 0.8708 | 2120.4 / 0.8708 |
| hnswlib_f32 | ef 100 | 1117.8 / 0.9975 | 1170.2 / 0.9975 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 7975.4 / 1.0000 | 8089.9 / 1.0000 | 9240.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 1947.4 / 0.9988 | 2010.8 / 0.9988 | 1970.8 / 0.9988 | 2018.9 / 0.9988 | 2119.4 / 0.9988 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 14290.9 / 1.0000 | 14479.1 / 1.0000 | 15594.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 3478.9 / 1.0000 | 3551.6 / 1.0000 | 3617.0 / 1.0000 | 3546.4 / 1.0000 | 3599.9 / 1.0000 | 3954.2 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 6463.1 / 1.0000 | 6517.0 / 1.0000 | 6816.5 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 122.4 / 0.9927 | 154.0 / 0.9927 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 477.9 / 0.9999 | 502.9 / 0.9999 | 1111.0 / 0.9999 |
| ours_scan | ef 200 |  |  | 168.9 / 0.9960 | 207.5 / 0.9960 | 267.2 / 0.9960 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 249.1 / 0.9989 | 299.7 / 0.9989 | 461.0 / 0.9989 |  |  |  |
| ours_walk | ef 100 | 120.3 / 0.9927 | 149.3 / 0.9927 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 486.9 / 0.9999 | 502.6 / 0.9999 | 1098.1 / 0.9999 |
| ours_walk | ef 200 | 157.2 / 0.9946 | 184.8 / 0.9946 | 171.9 / 0.9960 | 205.6 / 0.9960 | 273.9 / 0.9960 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 692.3 / 0.9999 | 663.5 / 0.9999 | 1300.2 / 0.9999 |
| ours_walk | ef 400 |  |  | 241.5 / 0.9972 | 276.4 / 0.9972 | 343.7 / 0.9972 | 254.2 / 0.9989 | 293.0 / 0.9989 | 492.4 / 0.9989 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 338.2 / 0.9988 | 387.0 / 0.9988 | 577.6 / 0.9988 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 365.7 / 0.5662 | 443.8 / 0.5662 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 432.5 / 0.5662 | 538.0 / 0.5662 | 688.9 / 0.5662 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 410.5 / 0.7001 | 488.2 / 0.7001 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 485.0 / 0.7001 | 576.2 / 0.7001 | 735.0 / 0.7001 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 646.0 / 0.7001 | 686.2 / 0.7001 | 1213.2 / 0.7001 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 1121.2 / 0.7603 | 1190.6 / 0.7603 | 2379.9 / 0.7603 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 728.2 / 0.7999 | 805.6 / 0.7998 | 1293.7 / 0.7998 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 1283.1 / 0.8455 | 1378.5 / 0.8455 | 2554.2 / 0.8455 |
| usearch_b1_rescore | ef 100 | 326.2 / 0.9845 | 358.9 / 0.9845 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2513.4 / 0.9983 | 2562.8 / 0.9983 | 3699.7 / 0.9983 |
| usearch_b1_rescore | ef 200 | 565.6 / 0.9911 | 580.0 / 0.9911 | 595.3 / 0.9939 | 612.4 / 0.9939 | 716.4 / 0.9939 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 4813.3 / 0.9981 | 4813.6 / 0.9981 | 6021.3 / 0.9981 |
| usearch_b1_rescore | ef 400 |  |  | 1017.9 / 0.9955 | 1101.6 / 0.9955 | 1128.5 / 0.9955 | 1049.3 / 0.9972 | 1130.0 / 0.9972 | 1444.2 / 0.9972 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1932.2 / 0.9981 | 1970.1 / 0.9981 | 2383.9 / 0.9981 |  |  |  |

### d20k / CodeRankEmbed (n_ho = 2400, exact quality 0.8271)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 410.3 | 5 | 0.9887 | yes / no | 4.02 [3.96, 4.05] | 110 | 338 |
| diskann_vamana | 0.99 | 441.1 | 5 | 0.9950 | yes / yes | 4.32 [4.26, 4.36] | 108 | 322 |
| diskann_vamana | 0.995 | 637.4 | 5 | 0.9983 | yes / yes | 4.84 [4.79, 4.91] | 110 | 333 |
| faiss_bin_flat | 0.98 | 56.6 | 5 | 0.9872 | yes / no | 0.55 [0.55, 0.57] | 119 | 382 |
| faiss_bin_flat | 0.99 | 76.1 | 5 | 0.9927 | yes / no | 0.75 [0.73, 0.76] | 119 | 382 |
| faiss_bin_flat | 0.995 | 76.1 | 5 | 0.9927 | no / no | 0.58 [0.57, 0.59] | 119 | 382 |
| faiss_bin_hnsw | 0.98 | 166.3 | 5 | 0.9829 | yes / no | 1.63 [1.60, 1.64] | 119 | 418 |
| faiss_bin_hnsw | 0.99 | 224.7 | 5 | 0.9937 | yes / no | 2.20 [2.17, 2.22] | 119 | 419 |
| faiss_bin_hnsw | 0.995 | 282.4 | 5 | 0.9962 | yes / no | 2.14 [2.12, 2.17] | 119 | 405 |
| faiss_exact | 0.98 | 2076.5 | 5 | 1.0000 | yes / yes | 20.34 [20.03, 20.51] | 87 | 198 |
| faiss_exact | 0.99 | 2076.5 | 5 | 1.0000 | yes / yes | 20.34 [20.03, 20.51] | 87 | 198 |
| faiss_exact | 0.995 | 2076.5 | 5 | 1.0000 | yes / yes | 15.75 [15.60, 15.99] | 87 | 198 |
| faiss_hnsw_flat | 0.98 | 178.5 | 5 | 0.9892 | yes / yes | 1.75 [1.72, 1.76] | 90 | 208 |
| faiss_hnsw_flat | 0.99 | 314.7 | 5 | 0.9952 | yes / yes | 3.08 [3.04, 3.11] | 90 | 208 |
| faiss_hnsw_flat | 0.995 | 417.8 | 5 | 0.9990 | yes / yes | 3.17 [3.14, 3.22] | 93 | 220 |
| faiss_hnsw_sq8 | 0.98 | 194.6 | 5 | 0.9907 | yes / yes | 1.91 [1.88, 1.92] | 119 | 443 |
| faiss_hnsw_sq8 | 0.99 | 335.0 | 5 | 0.9952 | yes / yes | 3.28 [3.22, 3.31] | 119 | 433 |
| faiss_hnsw_sq8 | 0.995 | 442.6 | 5 | 0.9990 | yes / yes | 3.36 [3.32, 3.41] | 120 | 445 |
| faiss_ivfpq_fs | 0.98 | 203.1 | 5 | 1.0000 | yes / yes | 1.99 [1.96, 2.01] | 120 | 413 |
| faiss_ivfpq_fs | 0.99 | 203.1 | 5 | 1.0000 | yes / yes | 1.99 [1.96, 2.01] | 120 | 413 |
| faiss_ivfpq_fs | 0.995 | 203.1 | 5 | 1.0000 | yes / yes | 1.54 [1.53, 1.56] | 120 | 413 |
| faiss_rabitq_flat | 0.98 | 297.5 | 5 | 0.9998 | yes / yes | 2.91 [2.87, 2.94] | 118 | 386 |
| faiss_rabitq_flat | 0.99 | 297.5 | 5 | 0.9998 | yes / yes | 2.91 [2.87, 2.94] | 118 | 386 |
| faiss_rabitq_flat | 0.995 | 297.5 | 5 | 0.9998 | yes / yes | 2.26 [2.23, 2.29] | 118 | 386 |
| faiss_rabitq_hnsw | 0.98 | 128.3 | 5 | 0.9917 | yes / yes | 1.26 [1.24, 1.27] | 119 | 428 |
| faiss_rabitq_hnsw | 0.99 | 209.6 | 5 | 0.9981 | yes / yes | 2.05 [2.02, 2.07] | 119 | 429 |
| faiss_rabitq_hnsw | 0.995 | 351.0 | 5 | 0.9991 | yes / yes | 2.66 [2.64, 2.70] | 119 | 430 |
| faiss_rabitq_ivf | 0.98 | 393.7 | 5 | 0.9912 | yes / yes | 3.86 [3.80, 3.89] | 119 | 411 |
| faiss_rabitq_ivf | 0.99 | 427.9 | 5 | 0.9923 | yes / no | 4.19 [4.13, 4.23] | 119 | 408 |
| faiss_rabitq_ivf | 0.995 | 478.2 | 5 | 1.0000 | yes / yes | 3.63 [3.59, 3.68] | 119 | 403 |
| hnswlib_f32 | 0.98 | 172.7 | 5 | 0.9851 | yes / no | 1.69 [1.67, 1.71] | 93 | 182 |
| hnswlib_f32 | 0.99 | 441.4 | 5 | 1.0002 | yes / yes | 4.32 [4.26, 4.36] | 96 | 191 |
| hnswlib_f32 | 0.995 | 553.3 | 5 | 0.9982 | yes / yes | 4.20 [4.16, 4.26] | 93 | 180 |
| ours_cascade | 0.98 | 102.1 | 5 | 0.9902 | yes / yes |  | 188 | 134 |
| ours_cascade | 0.99 | 102.1 | 5 | 0.9902 | yes / no |  | 188 | 134 |
| ours_cascade | 0.995 | 131.8 | 5 | 0.9941 | no / no |  | 204 | 214 |
| scann | 0.98 | 302.0 | 5 | 1.0000 | yes / yes | 2.96 [2.91, 3.25] | 130 | 386 |
| scann | 0.99 | 302.0 | 5 | 1.0000 | yes / yes | 2.96 [2.91, 3.25] | 130 | 386 |
| scann | 0.995 | 302.0 | 5 | 1.0000 | yes / yes | 2.29 [2.27, 2.52] | 130 | 386 |
| svs_vamana_leanvec | 0.98 | 150.0 | 5 | 0.9870 | yes / no | 1.47 [1.45, 1.48] | 64 | 156 |
| svs_vamana_leanvec | 0.99 | 217.6 | 5 | 0.9950 | yes / yes | 2.13 [2.10, 2.19] | 66 | 165 |
| svs_vamana_leanvec | 0.995 | 453.8 | 5 | 0.9989 | yes / yes | 3.44 [3.41, 3.49] | 66 | 167 |
| svs_vamana_lvq | 0.98 | 169.0 | 5 | 0.9933 | yes / yes | 1.66 [1.63, 1.67] | 69 | 175 |
| svs_vamana_lvq | 0.99 | 335.1 | 5 | 0.9980 | yes / yes | 3.28 [3.23, 3.31] | 69 | 170 |
| svs_vamana_lvq | 0.995 | 335.1 | 5 | 0.9980 | yes / yes | 2.54 [2.52, 2.58] | 69 | 170 |
| usearch_b1_rescore | 0.98 | 142.3 | 5 | 0.9822 | yes / no | 1.39 [1.37, 1.41] | 123 | 397 |
| usearch_b1_rescore | 0.99 | 176.5 | 5 | 0.9919 | yes / no | 1.73 [1.70, 1.75] | 125 | 405 |
| usearch_b1_rescore | 0.995 | 263.0 | 5 | 0.9931 | no / no | 2.00 [1.98, 2.03] | 130 | 438 |
| usearch_f16 | 0.98 | 303.9 | 5 | 0.9894 | yes / yes | 2.98 [2.93, 3.00] | 65 | 166 |
| usearch_f16 | 0.99 | 412.1 | 5 | 0.9902 | yes / no | 4.04 [3.98, 4.07] | 70 | 189 |
| usearch_f16 | 0.995 | 717.3 | 5 | 0.9955 | yes / no | 5.44 [5.38, 5.52] | 70 | 187 |
| usearch_i8 | 0.98 | 215.9 | 5 | 0.9877 | yes / yes | 2.11 [2.06, 2.13] | 50 | 98 |
| usearch_i8 | 0.99 | 230.1 | 5 | 0.9921 | yes / no | 2.25 [2.22, 2.27] | 56 | 125 |
| usearch_i8 | 0.995 | 695.9 | 5 | 0.9961 | yes / no | 5.28 [5.23, 5.36] | 56 | 123 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 610.1 / 0.9976 | 658.5 / 0.9976 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2406.0 / 1.0001 | 2454.9 / 1.0000 | 3320.4 / 1.0000 |
| diskann_vamana | L 200 | 917.7 / 0.9996 | 966.4 / 0.9995 | 934.1 / 0.9996 | 981.1 / 0.9995 | 1077.1 / 0.9995 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3347.3 / 1.0001 | 3391.7 / 1.0000 | 4261.9 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1399.2 / 1.0001 | 1451.8 / 1.0000 | 1543.9 / 1.0000 | 1424.5 / 1.0001 | 1477.5 / 1.0000 | 1762.6 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2081.3 / 1.0001 | 2130.8 / 1.0000 | 2418.7 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 130.3 / 0.9946 | 181.8 / 0.9946 | 180.1 / 0.9973 | 228.7 / 0.9973 | 328.6 / 0.9973 | 267.6 / 0.9978 | 317.7 / 0.9978 | 607.2 / 0.9978 | 512.2 / 0.9995 | 562.1 / 0.9994 | 1416.2 / 0.9993 |
| faiss_bin_hnsw | ef 100 | 168.5 / 0.9872 | 218.5 / 0.9872 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1139.9 / 0.9995 | 1191.6 / 0.9994 | 2078.6 / 0.9993 |
| faiss_bin_hnsw | ef 200 | 248.1 / 0.9920 | 299.0 / 0.9920 | 285.0 / 0.9945 | 335.6 / 0.9945 | 435.1 / 0.9945 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1896.6 / 0.9995 | 1949.4 / 0.9994 | 2796.6 / 0.9993 |
| faiss_bin_hnsw | ef 400 |  |  | 434.6 / 0.9975 | 487.6 / 0.9975 | 590.0 / 0.9975 | 510.4 / 0.9984 | 561.2 / 0.9983 | 854.4 / 0.9983 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 787.2 / 0.9978 | 836.7 / 0.9978 | 1140.1 / 0.9978 |  |  |  |
| faiss_hnsw_flat | ef 100 | 418.0 / 0.9978 | 466.8 / 0.9978 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2254.8 / 1.0001 | 2301.1 / 1.0000 | 3189.8 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 669.8 / 0.9996 | 719.2 / 0.9995 | 700.3 / 0.9996 | 748.7 / 0.9995 | 848.0 / 0.9995 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3447.3 / 1.0001 | 3492.2 / 1.0000 | 4389.4 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1107.9 / 1.0001 | 1158.8 / 1.0000 | 1257.3 / 1.0000 | 1172.0 / 1.0001 | 1219.7 / 1.0000 | 1509.6 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1809.3 / 1.0001 | 1853.4 / 1.0000 | 2144.1 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 386.1 / 0.9999 | 453.8 / 0.9999 | 424.6 / 1.0001 | 487.9 / 1.0000 | 581.0 / 1.0000 | 485.7 / 1.0001 | 542.4 / 1.0000 | 828.6 / 1.0000 | 637.3 / 1.0001 | 676.5 / 1.0000 | 1532.4 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 140.3 / 0.8142 | 186.9 / 0.8142 | 278.2 / 0.8142 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 224.2 / 0.8766 | 272.6 / 0.8766 | 555.0 / 0.8766 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 394.0 / 0.8989 | 443.6 / 0.8989 | 1290.4 / 0.8989 |
| faiss_rabitq_ivf | nprobe 3 | 87.6 / 0.6302 | 131.9 / 0.6302 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 492.6 / 0.9526 | 542.0 / 0.9526 | 1390.7 / 0.9526 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 118.2 / 0.7165 | 163.2 / 0.7165 | 256.4 / 0.7165 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 98.9 / 0.7436 | 143.5 / 0.7436 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 183.9 / 0.7978 | 231.5 / 0.7978 | 513.5 / 0.7978 |  |  |  |
| hnswlib_f32 | ef 100 | 424.8 / 1.0001 | 478.6 / 1.0000 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2104.0 / 1.0001 | 2127.3 / 1.0000 | 3009.4 / 1.0000 |
| hnswlib_f32 | ef 200 | 696.8 / 1.0004 | 741.7 / 1.0003 | 703.2 / 1.0005 | 755.9 / 1.0003 | 856.0 / 1.0003 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2994.7 / 1.0001 | 3010.6 / 1.0000 | 3889.4 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1115.0 / 1.0001 | 1175.4 / 1.0000 | 1271.3 / 1.0000 | 1156.8 / 1.0001 | 1207.4 / 1.0000 | 1488.8 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1762.9 / 1.0001 | 1813.5 / 1.0000 | 2085.0 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 82.6 / 0.9941 | 104.9 / 0.9941 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 161.8 / 0.9989 | 183.3 / 0.9989 | 628.0 / 0.9988 |
| ours_scan | ef 200 |  |  | 92.5 / 0.9973 | 113.4 / 0.9973 | 159.7 / 0.9973 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 110.5 / 0.9979 | 132.6 / 0.9979 | 272.0 / 0.9979 |  |  |  |
| ours_walk | ef 100 | 82.3 / 0.9920 | 101.6 / 0.9920 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 234.6 / 0.9995 | 255.9 / 0.9994 | 702.4 / 0.9993 |
| ours_walk | ef 200 | 97.9 / 0.9931 | 115.7 / 0.9931 | 105.6 / 0.9967 | 123.8 / 0.9967 | 169.0 / 0.9967 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 286.5 / 0.9995 | 306.4 / 0.9994 | 752.5 / 0.9993 |
| ours_walk | ef 400 |  |  | 130.9 / 0.9973 | 151.3 / 0.9973 | 198.6 / 0.9973 | 146.6 / 0.9978 | 167.7 / 0.9978 | 311.2 / 0.9978 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 176.9 / 0.9978 | 199.2 / 0.9978 | 342.6 / 0.9978 |  |  |  |
| scann | reorder 100 | 392.1 / 1.0001 | 448.1 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 818.1 / 1.0001 | 854.4 / 1.0000 | 1755.2 / 1.0000 |
| scann | reorder 200 |  |  | 450.5 / 1.0001 | 500.8 / 1.0000 | 594.5 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 546.7 / 1.0001 | 585.8 / 1.0000 | 875.9 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 149.8 / 0.9834 | 199.0 / 0.9834 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 843.4 / 0.9972 | 896.3 / 0.9971 | 1779.9 / 0.9971 |
| usearch_b1_rescore | ef 200 | 221.3 / 0.9901 | 272.2 / 0.9901 | 233.8 / 0.9919 | 284.1 / 0.9919 | 384.4 / 0.9919 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1394.4 / 0.9972 | 1451.6 / 0.9971 | 2336.0 / 0.9971 |
| usearch_b1_rescore | ef 400 |  |  | 366.4 / 0.9950 | 416.8 / 0.9950 | 521.2 / 0.9950 | 393.5 / 0.9956 | 442.5 / 0.9957 | 749.9 / 0.9956 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 639.4 / 0.9961 | 690.1 / 0.9961 | 1002.3 / 0.9961 |  |  |  |

### d20k / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.6987)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 819.2 | 5 | 0.9873 | yes / no | 4.77 [4.43, 6.57] | 110 | 339 |
| diskann_vamana | 0.99 | 1274.9 | 5 | 0.9987 | yes / yes | 6.11 [5.55, 7.78] | 110 | 340 |
| diskann_vamana | 0.995 | 1502.3 | 5 | 0.9996 | yes / yes | 6.51 [5.96, 6.93] | 113 | 350 |
| faiss_bin_flat | 0.98 | 141.2 | 5 | 0.9932 | yes / yes | 0.82 [0.76, 0.85] | 118 | 394 |
| faiss_bin_flat | 0.99 | 280.6 | 5 | 0.9965 | yes / yes | 1.34 [1.21, 1.40] | 118 | 385 |
| faiss_bin_flat | 0.995 | 280.6 | 5 | 0.9965 | yes / no | 1.22 [1.11, 1.27] | 118 | 385 |
| faiss_bin_hnsw | 0.98 | 441.5 | 5 | 0.9893 | yes / yes | 2.57 [2.39, 2.74] | 119 | 407 |
| faiss_bin_hnsw | 0.99 | 566.1 | 5 | 0.9965 | yes / yes | 2.71 [2.47, 2.82] | 118 | 410 |
| faiss_bin_hnsw | 0.995 | 911.6 | 5 | 0.9963 | yes / no | 3.95 [3.62, 4.07] | 118 | 410 |
| faiss_exact | 0.98 | 2092.2 | 5 | 1.0000 | yes / yes | 12.19 [11.30, 12.46] | 88 | 200 |
| faiss_exact | 0.99 | 2092.2 | 5 | 1.0000 | yes / yes | 10.02 [9.19, 10.33] | 88 | 200 |
| faiss_exact | 0.995 | 2092.2 | 5 | 1.0000 | yes / yes | 9.07 [8.31, 9.27] | 88 | 200 |
| faiss_hnsw_flat | 0.98 | 272.5 | 5 | 0.9873 | yes / yes | 1.59 [1.47, 1.66] | 91 | 204 |
| faiss_hnsw_flat | 0.99 | 479.3 | 5 | 0.9954 | yes / yes | 2.30 [2.10, 2.40] | 91 | 205 |
| faiss_hnsw_flat | 0.995 | 589.6 | 5 | 0.9978 | yes / yes | 2.55 [2.34, 2.72] | 94 | 210 |
| faiss_hnsw_sq8 | 0.98 | 329.6 | 5 | 0.9867 | yes / no | 1.92 [1.78, 2.08] | 119 | 443 |
| faiss_hnsw_sq8 | 0.99 | 521.7 | 5 | 0.9953 | yes / yes | 2.50 [2.29, 2.73] | 119 | 439 |
| faiss_hnsw_sq8 | 0.995 | 521.7 | 5 | 0.9953 | yes / no | 2.26 [2.07, 2.47] | 119 | 439 |
| faiss_ivfpq_fs | 0.98 | 273.5 | 5 | 1.0000 | yes / yes | 1.59 [1.48, 1.73] | 119 | 418 |
| faiss_ivfpq_fs | 0.99 | 273.5 | 5 | 1.0000 | yes / yes | 1.31 [1.20, 1.42] | 119 | 418 |
| faiss_ivfpq_fs | 0.995 | 273.5 | 5 | 1.0000 | yes / yes | 1.18 [1.09, 1.29] | 119 | 418 |
| faiss_rabitq_flat | 0.98 | 348.0 | 5 | 0.9999 | yes / yes | 2.03 [1.88, 2.06] | 118 | 391 |
| faiss_rabitq_flat | 0.99 | 348.0 | 5 | 0.9999 | yes / yes | 1.67 [1.53, 1.71] | 118 | 391 |
| faiss_rabitq_flat | 0.995 | 348.0 | 5 | 0.9999 | yes / yes | 1.51 [1.38, 1.52] | 118 | 391 |
| faiss_rabitq_hnsw | 0.98 | 370.5 | 5 | 0.9899 | yes / yes | 2.16 [2.00, 2.28] | 119 | 423 |
| faiss_rabitq_hnsw | 0.99 | 606.1 | 5 | 0.9977 | yes / yes | 2.90 [2.61, 3.05] | 119 | 428 |
| faiss_rabitq_hnsw | 0.995 | 606.1 | 5 | 0.9977 | yes / yes | 2.63 [2.41, 2.76] | 119 | 428 |
| faiss_rabitq_ivf | 0.98 | 533.0 | 5 | 0.9881 | yes / no | 3.10 [2.88, 3.23] | 119 | 406 |
| faiss_rabitq_ivf | 0.99 | 566.2 | 5 | 0.9916 | yes / no | 2.71 [2.44, 2.83] | 119 | 412 |
| faiss_rabitq_ivf | 0.995 | 621.2 | 5 | 1.0000 | yes / yes | 2.69 [2.47, 2.79] | 119 | 406 |
| hnswlib_f32 | 0.98 | 314.7 | 5 | 0.9928 | yes / yes | 1.83 [1.70, 2.02] | 97 | 186 |
| hnswlib_f32 | 0.99 | 469.4 | 5 | 0.9954 | yes / yes | 2.25 [2.06, 2.46] | 94 | 175 |
| hnswlib_f32 | 0.995 | 553.6 | 5 | 0.9982 | yes / yes | 2.40 [2.20, 2.54] | 97 | 191 |
| ours_cascade | 0.98 | 171.7 | 5 | 0.9885 | yes / yes |  | 205 | 277 |
| ours_cascade | 0.99 | 208.7 | 5 | 0.9934 | yes / no |  | 190 | 388 |
| ours_cascade | 0.995 | 230.8 | 5 | 0.9980 | yes / no |  | 205 | 562 |
| scann | 0.98 | 377.2 | 5 | 1.0000 | yes / yes | 2.20 [2.04, 4.05] | 136 | 397 |
| scann | 0.99 | 377.2 | 5 | 1.0000 | yes / yes | 1.81 [1.66, 3.33] | 136 | 397 |
| scann | 0.995 | 377.2 | 5 | 1.0000 | yes / yes | 1.63 [1.50, 3.01] | 136 | 397 |
| svs_vamana_leanvec | 0.98 | 417.6 | 5 | 0.9924 | yes / yes | 2.43 [2.26, 2.51] | 67 | 166 |
| svs_vamana_leanvec | 0.99 | 907.8 | 5 | 0.9961 | yes / yes | 4.35 [3.91, 4.53] | 67 | 165 |
| svs_vamana_leanvec | 0.995 | 2039.7 | 5 | 0.9986 | yes / yes | 8.84 [8.10, 9.31] | 67 | 168 |
| svs_vamana_lvq | 0.98 | 406.4 | 5 | 0.9914 | yes / yes | 2.37 [2.12, 2.55] | 70 | 173 |
| svs_vamana_lvq | 0.99 | 780.0 | 5 | 0.9965 | yes / yes | 3.74 [3.42, 3.98] | 70 | 172 |
| svs_vamana_lvq | 0.995 | 1806.7 | 5 | 0.9994 | yes / yes | 7.83 [7.14, 8.18] | 70 | 172 |
| usearch_b1_rescore | 0.98 | 399.6 | 5 | 0.9888 | yes / yes | 2.33 [2.16, 2.42] | 123 | 404 |
| usearch_b1_rescore | 0.99 | 436.4 | 5 | 0.9921 | yes / no | 2.09 [1.91, 2.58] | 125 | 412 |
| usearch_b1_rescore | 0.995 | 1387.6 | 5 | 0.9987 | yes / yes | 6.01 [5.51, 6.84] | 125 | 418 |
| usearch_f16 | 0.98 | 393.1 | 5 | 0.9935 | yes / yes | 2.29 [2.12, 2.46] | 66 | 171 |
| usearch_f16 | 0.99 | 700.8 | 5 | 0.9954 | yes / yes | 3.36 [3.08, 3.49] | 66 | 165 |
| usearch_f16 | 0.995 | 1186.6 | 5 | 0.9991 | yes / yes | 5.14 [4.71, 5.31] | 66 | 166 |
| usearch_i8 | 0.98 | 298.5 | 5 | 0.9852 | yes / no | 1.74 [1.61, 1.81] | 57 | 120 |
| usearch_i8 | 0.99 | 526.9 | 5 | 0.9935 | yes / no | 2.52 [2.29, 2.68] | 57 | 123 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 529.2 / 0.9479 | 589.4 / 0.9482 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2205.5 / 0.9992 | 2234.1 / 0.9992 | 3235.8 / 0.9994 |
| diskann_vamana | L 200 | 762.4 / 0.9801 | 834.4 / 0.9803 | 802.6 / 0.9801 | 854.9 / 0.9803 | 965.6 / 0.9803 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3241.5 / 0.9998 | 3192.6 / 0.9998 | 4224.3 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1208.5 / 0.9960 | 1241.4 / 0.9963 | 1361.2 / 0.9963 | 1203.9 / 0.9960 | 1280.2 / 0.9960 | 1632.0 / 0.9963 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1777.2 / 0.9991 | 1885.4 / 0.9991 | 2238.9 / 0.9993 |  |  |  |
| faiss_bin_flat | exhaustive | 132.4 / 0.9842 | 179.6 / 0.9842 | 178.9 / 0.9932 | 222.5 / 0.9932 | 316.1 / 0.9932 | 262.0 / 0.9960 | 309.3 / 0.9962 | 590.4 / 0.9962 | 493.2 / 0.9990 | 549.6 / 0.9993 | 1406.1 / 0.9993 |
| faiss_bin_hnsw | ef 100 | 162.0 / 0.9524 | 204.2 / 0.9525 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1077.6 / 0.9985 | 1129.8 / 0.9988 | 2012.5 / 0.9988 |
| faiss_bin_hnsw | ef 200 | 236.4 / 0.9745 | 283.4 / 0.9746 | 269.3 / 0.9806 | 320.4 / 0.9806 | 405.7 / 0.9806 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1792.9 / 0.9984 | 1875.2 / 0.9987 | 2756.6 / 0.9987 |
| faiss_bin_hnsw | ef 400 |  |  | 410.2 / 0.9901 | 460.9 / 0.9901 | 557.1 / 0.9901 | 482.0 / 0.9925 | 536.8 / 0.9928 | 808.7 / 0.9928 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 738.0 / 0.9958 | 788.6 / 0.9960 | 1069.8 / 0.9960 |  |  |  |
| faiss_hnsw_flat | ef 100 | 360.9 / 0.9904 | 416.5 / 0.9906 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2061.1 / 0.9998 | 2125.5 / 0.9998 | 3134.1 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 579.1 / 0.9973 | 633.0 / 0.9975 | 610.6 / 0.9973 | 667.9 / 0.9975 | 770.8 / 0.9975 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3245.2 / 0.9998 | 3405.4 / 0.9998 | 4417.5 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 970.9 / 0.9986 | 1022.9 / 0.9988 | 1130.0 / 0.9988 | 1030.6 / 0.9986 | 1098.8 / 0.9986 | 1396.4 / 0.9988 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1589.7 / 0.9992 | 1691.3 / 0.9992 | 2010.3 / 0.9994 |  |  |  |
| faiss_rabitq_flat | exhaustive | 383.5 / 0.9997 | 442.9 / 0.9999 | 418.4 / 0.9998 | 487.8 / 1.0000 | 588.3 / 1.0000 | 478.3 / 0.9998 | 540.5 / 1.0000 | 825.3 / 1.0000 | 628.7 / 0.9998 | 671.5 / 0.9999 | 1560.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 139.4 / 0.6233 | 188.0 / 0.6232 | 282.6 / 0.6232 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 225.6 / 0.7293 | 268.1 / 0.7293 | 553.3 / 0.7293 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 396.6 / 0.7688 | 451.0 / 0.7687 | 1298.3 / 0.7687 |
| faiss_rabitq_ivf | nprobe 3 | 88.1 / 0.4051 | 134.3 / 0.4050 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 494.4 / 0.8904 | 549.0 / 0.8902 | 1398.8 / 0.8902 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 115.2 / 0.4866 | 163.8 / 0.4866 | 259.9 / 0.4866 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 99.1 / 0.5113 | 145.0 / 0.5113 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 184.2 / 0.6011 | 227.5 / 0.6011 | 511.0 / 0.6011 |  |  |  |
| hnswlib_f32 | ef 100 | 332.5 / 0.9867 | 391.5 / 0.9868 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1861.6 / 0.9998 | 1939.8 / 0.9998 | 2907.3 / 1.0000 |
| hnswlib_f32 | ef 200 | 549.0 / 0.9970 | 587.7 / 0.9973 | 569.2 / 0.9970 | 622.8 / 0.9973 | 736.8 / 0.9973 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2727.8 / 0.9998 | 2771.7 / 0.9998 | 3845.6 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 905.3 / 0.9989 | 963.7 / 0.9991 | 1063.6 / 0.9991 | 933.4 / 0.9989 | 1016.4 / 0.9989 | 1290.1 / 0.9991 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1464.2 / 0.9992 | 1539.5 / 0.9992 | 1831.4 / 0.9994 |  |  |  |
| ours_scan | ef 100 | 82.6 / 0.9816 | 102.7 / 0.9817 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 153.4 / 0.9990 | 176.3 / 0.9993 | 627.6 / 0.9993 |
| ours_scan | ef 200 |  |  | 89.0 / 0.9916 | 113.0 / 0.9916 | 155.6 / 0.9916 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 107.5 / 0.9954 | 127.8 / 0.9957 | 261.3 / 0.9957 |  |  |  |
| ours_walk | ef 100 | 78.4 / 0.9678 | 96.1 / 0.9678 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 214.3 / 0.9976 | 234.0 / 0.9978 | 677.6 / 0.9978 |
| ours_walk | ef 200 | 91.4 / 0.9759 | 112.9 / 0.9760 | 98.5 / 0.9858 | 116.3 / 0.9858 | 158.9 / 0.9858 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 265.0 / 0.9989 | 288.8 / 0.9992 | 733.9 / 0.9992 |
| ours_walk | ef 400 |  |  | 119.8 / 0.9885 | 140.5 / 0.9885 | 181.4 / 0.9885 | 133.0 / 0.9912 | 151.1 / 0.9915 | 290.9 / 0.9915 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 159.7 / 0.9940 | 182.2 / 0.9943 | 320.6 / 0.9943 |  |  |  |
| scann | reorder 100 | 605.4 / 0.9998 | 655.0 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1151.6 / 0.9998 | 1295.6 / 0.9998 | 2068.2 / 1.0000 |
| scann | reorder 200 |  |  | 538.9 / 0.9997 | 662.0 / 1.0000 | 705.6 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 570.0 / 0.9998 | 689.4 / 1.0000 | 961.0 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 142.4 / 0.9459 | 195.4 / 0.9459 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 779.7 / 0.9978 | 837.6 / 0.9980 | 1719.5 / 0.9980 |
| usearch_b1_rescore | ef 200 | 210.1 / 0.9674 | 258.9 / 0.9674 | 220.0 / 0.9749 | 270.5 / 0.9749 | 371.7 / 0.9749 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1297.7 / 0.9978 | 1355.8 / 0.9981 | 2265.1 / 0.9981 |
| usearch_b1_rescore | ef 400 |  |  | 345.4 / 0.9880 | 398.2 / 0.9880 | 498.0 / 0.9880 | 365.8 / 0.9898 | 419.2 / 0.9901 | 714.5 / 0.9901 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 590.2 / 0.9937 | 649.5 / 0.9940 | 967.1 / 0.9940 |  |  |  |

### d20k / jina-v2-base-code (n_ho = 2400, exact quality 0.8010)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 186.0 | 5 | 0.9911 | yes / yes | 1.82 [1.69, 2.01] | 106 | 325 |
| diskann_vamana | 0.99 | 245.4 | 5 | 0.9981 | yes / yes | 2.40 [2.23, 2.58] | 108 | 334 |
| diskann_vamana | 0.995 | 245.4 | 5 | 0.9981 | yes / yes | 2.40 [2.23, 2.58] | 108 | 334 |
| faiss_bin_flat | 0.98 | 53.5 | 5 | 0.9986 | yes / yes | 0.52 [0.48, 0.54] | 118 | 381 |
| faiss_bin_flat | 0.99 | 53.5 | 5 | 0.9986 | yes / yes | 0.52 [0.48, 0.54] | 118 | 381 |
| faiss_bin_flat | 0.995 | 53.5 | 5 | 0.9986 | yes / yes | 0.52 [0.48, 0.54] | 118 | 381 |
| faiss_bin_hnsw | 0.98 | 94.9 | 5 | 0.9881 | yes / yes | 0.93 [0.86, 1.01] | 119 | 400 |
| faiss_bin_hnsw | 0.99 | 104.2 | 5 | 0.9904 | yes / no | 1.02 [0.95, 1.08] | 119 | 398 |
| faiss_bin_hnsw | 0.995 | 117.7 | 5 | 0.9975 | yes / no | 1.15 [1.06, 1.21] | 119 | 400 |
| faiss_exact | 0.98 | 2090.2 | 5 | 1.0000 | yes / yes | 20.47 [19.03, 21.27] | 87 | 198 |
| faiss_exact | 0.99 | 2090.2 | 5 | 1.0000 | yes / yes | 20.47 [19.03, 21.27] | 87 | 198 |
| faiss_exact | 0.995 | 2090.2 | 5 | 1.0000 | yes / yes | 20.47 [19.03, 21.27] | 87 | 198 |
| faiss_hnsw_flat | 0.98 | 81.8 | 5 | 0.9852 | yes / no | 0.80 [0.74, 0.84] | 90 | 204 |
| faiss_hnsw_flat | 0.99 | 124.9 | 5 | 0.9970 | yes / yes | 1.22 [1.14, 1.28] | 93 | 216 |
| faiss_hnsw_flat | 0.995 | 144.3 | 5 | 0.9973 | yes / no | 1.41 [1.31, 1.48] | 97 | 237 |
| faiss_hnsw_sq8 | 0.98 | 96.9 | 5 | 0.9822 | yes / no | 0.95 [0.87, 1.04] | 119 | 452 |
| faiss_hnsw_sq8 | 0.99 | 141.4 | 5 | 0.9969 | yes / yes | 1.38 [1.28, 1.48] | 119 | 450 |
| faiss_hnsw_sq8 | 0.995 | 162.8 | 5 | 0.9972 | yes / no | 1.59 [1.45, 1.70] | 119 | 463 |
| faiss_ivfpq_fs | 0.98 | 120.9 | 5 | 0.9876 | yes / yes | 1.18 [1.09, 1.24] | 119 | 407 |
| faiss_ivfpq_fs | 0.99 | 206.3 | 5 | 0.9999 | yes / yes | 2.02 [1.88, 2.11] | 119 | 411 |
| faiss_ivfpq_fs | 0.995 | 206.3 | 5 | 0.9999 | yes / yes | 2.02 [1.88, 2.11] | 119 | 411 |
| faiss_rabitq_flat | 0.98 | 303.4 | 5 | 1.0000 | yes / yes | 2.97 [2.76, 3.08] | 118 | 389 |
| faiss_rabitq_flat | 0.99 | 303.4 | 5 | 1.0000 | yes / yes | 2.97 [2.76, 3.08] | 118 | 389 |
| faiss_rabitq_flat | 0.995 | 303.4 | 5 | 1.0000 | yes / yes | 2.97 [2.76, 3.08] | 118 | 389 |
| faiss_rabitq_hnsw | 0.98 | 63.1 | 5 | 0.9832 | yes / no | 0.62 [0.57, 0.65] | 119 | 403 |
| faiss_rabitq_hnsw | 0.99 | 78.1 | 5 | 0.9940 | yes / no | 0.76 [0.71, 0.82] | 119 | 426 |
| faiss_rabitq_hnsw | 0.995 | 110.1 | 5 | 0.9982 | yes / yes | 1.08 [1.00, 1.13] | 119 | 423 |
| faiss_rabitq_ivf | 0.98 | 243.3 | 5 | 0.9877 | yes / yes | 2.38 [2.22, 2.48] | 119 | 398 |
| faiss_rabitq_ivf | 0.99 | 390.5 | 5 | 0.9964 | yes / yes | 3.82 [3.55, 4.06] | 119 | 412 |
| faiss_rabitq_ivf | 0.995 | 390.5 | 5 | 0.9964 | yes / no | 3.82 [3.55, 4.06] | 119 | 412 |
| hnswlib_f32 | 0.98 | 90.7 | 5 | 0.9865 | yes / yes | 0.89 [0.83, 0.95] | 93 | 183 |
| hnswlib_f32 | 0.99 | 135.4 | 5 | 0.9946 | yes / yes | 1.33 [1.23, 1.40] | 95 | 188 |
| hnswlib_f32 | 0.995 | 149.3 | 5 | 0.9967 | yes / no | 1.46 [1.36, 1.52] | 100 | 200 |
| ours_cascade | 0.98 | 102.1 | 5 | 0.9988 | yes / yes |  | 187 | 139 |
| ours_cascade | 0.99 | 102.1 | 5 | 0.9988 | yes / yes |  | 187 | 139 |
| ours_cascade | 0.995 | 102.1 | 5 | 0.9988 | yes / yes |  | 187 | 139 |
| scann | 0.98 | 394.8 | 5 | 1.0000 | yes / yes | 3.87 [2.85, 4.40] | 135 | 389 |
| scann | 0.99 | 394.8 | 5 | 1.0000 | yes / yes | 3.87 [2.85, 4.40] | 135 | 389 |
| scann | 0.995 | 394.8 | 5 | 1.0000 | yes / yes | 3.87 [2.85, 4.40] | 135 | 389 |
| svs_vamana_leanvec | 0.98 | 49.2 | 5 | 0.9859 | yes / no | 0.48 [0.45, 0.50] | 63 | 156 |
| svs_vamana_leanvec | 0.99 | 64.1 | 5 | 0.9950 | yes / yes | 0.63 [0.58, 0.65] | 66 | 166 |
| svs_vamana_leanvec | 0.995 | 116.1 | 5 | 0.9984 | yes / yes | 1.14 [1.05, 1.18] | 66 | 168 |
| svs_vamana_lvq | 0.98 | 66.2 | 5 | 0.9928 | yes / yes | 0.65 [0.59, 0.67] | 67 | 164 |
| svs_vamana_lvq | 0.99 | 94.7 | 5 | 0.9977 | yes / yes | 0.93 [0.80, 0.98] | 69 | 175 |
| svs_vamana_lvq | 0.995 | 124.5 | 5 | 0.9994 | yes / yes | 1.22 [1.08, 1.27] | 67 | 165 |
| usearch_b1_rescore | 0.98 | 113.3 | 5 | 0.9948 | yes / yes | 1.11 [1.02, 1.15] | 123 | 393 |
| usearch_b1_rescore | 0.99 | 113.3 | 5 | 0.9948 | yes / yes | 1.11 [1.02, 1.15] | 123 | 393 |
| usearch_b1_rescore | 0.995 | 115.4 | 5 | 0.9969 | yes / no | 1.13 [1.05, 1.18] | 123 | 393 |
| usearch_f16 | 0.98 | 104.4 | 5 | 0.9892 | yes / yes | 1.02 [0.95, 1.07] | 62 | 158 |
| usearch_f16 | 0.99 | 150.0 | 5 | 0.9943 | yes / yes | 1.47 [1.35, 1.56] | 65 | 167 |
| usearch_f16 | 0.995 | 256.7 | 5 | 0.9970 | yes / no | 2.51 [2.34, 2.65] | 65 | 167 |
| usearch_i8 | 0.98 | 75.6 | 5 | 0.9910 | yes / yes | 0.74 [0.69, 0.79] | 47 | 90 |
| usearch_i8 | 0.99 | 129.2 | 5 | 0.9963 | yes / yes | 1.26 [1.17, 1.34] | 47 | 89 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 543.1 / 0.9999 | 586.9 / 0.9999 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2281.4 / 1.0000 | 2268.6 / 1.0000 | 3329.6 / 1.0000 |
| diskann_vamana | L 200 | 795.7 / 1.0000 | 847.1 / 1.0000 | 841.5 / 1.0000 | 887.6 / 1.0000 | 1015.0 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3250.5 / 1.0000 | 3354.4 / 1.0000 | 4329.1 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1268.3 / 1.0000 | 1279.6 / 1.0000 | 1489.6 / 1.0000 | 1297.3 / 1.0000 | 1346.6 / 1.0000 | 1655.8 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1927.4 / 1.0000 | 1986.4 / 1.0000 | 2284.8 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 133.9 / 0.9999 | 178.2 / 0.9999 | 181.7 / 0.9998 | 236.3 / 0.9998 | 323.3 / 0.9998 | 266.1 / 0.9998 | 318.4 / 0.9998 | 598.0 / 0.9998 | 503.5 / 0.9998 | 558.3 / 0.9998 | 1394.7 / 0.9998 |
| faiss_bin_hnsw | ef 100 | 155.1 / 0.9997 | 195.8 / 0.9997 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1039.8 / 0.9998 | 1097.3 / 0.9998 | 1967.2 / 0.9998 |
| faiss_bin_hnsw | ef 200 | 226.1 / 0.9996 | 272.1 / 0.9996 | 254.9 / 0.9995 | 303.6 / 0.9995 | 403.6 / 0.9995 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1784.9 / 0.9998 | 1824.2 / 0.9998 | 2723.3 / 0.9998 |
| faiss_bin_hnsw | ef 400 |  |  | 386.7 / 0.9998 | 438.4 / 0.9998 | 535.5 / 0.9998 | 460.2 / 0.9998 | 510.6 / 0.9998 | 781.2 / 0.9998 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 723.2 / 0.9998 | 767.9 / 0.9998 | 1039.4 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 100 | 387.6 / 0.9995 | 443.3 / 0.9995 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2195.3 / 1.0000 | 2269.6 / 1.0000 | 3254.7 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 611.1 / 1.0000 | 661.1 / 1.0000 | 670.0 / 1.0000 | 707.8 / 1.0000 | 825.3 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3431.1 / 1.0000 | 3521.2 / 1.0000 | 4493.5 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1067.5 / 1.0000 | 1074.4 / 1.0000 | 1219.5 / 1.0000 | 1109.8 / 1.0000 | 1161.1 / 1.0000 | 1485.1 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1721.4 / 1.0000 | 1751.0 / 1.0000 | 2090.4 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 377.4 / 1.0000 | 451.4 / 1.0000 | 416.4 / 1.0000 | 481.5 / 1.0000 | 587.6 / 1.0000 | 476.4 / 1.0000 | 543.9 / 1.0000 | 855.3 / 1.0000 | 626.1 / 1.0000 | 671.4 / 1.0000 | 1534.3 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 133.8 / 0.8846 | 189.9 / 0.8846 | 280.4 / 0.8847 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 219.0 / 0.9353 | 261.0 / 0.9353 | 551.3 / 0.9353 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 384.6 / 0.9475 | 439.0 / 0.9475 | 1286.0 / 0.9475 |
| faiss_rabitq_ivf | nprobe 3 | 86.0 / 0.7322 | 132.8 / 0.7322 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 478.5 / 0.9780 | 530.1 / 0.9780 | 1374.1 / 0.9780 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 114.7 / 0.8079 | 167.0 / 0.8079 | 259.8 / 0.8079 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 97.0 / 0.8284 | 143.3 / 0.8284 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 181.1 / 0.8711 | 224.8 / 0.8711 | 511.0 / 0.8711 |  |  |  |
| hnswlib_f32 | ef 100 | 392.2 / 0.9994 | 450.6 / 0.9994 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2019.1 / 1.0000 | 2088.2 / 1.0000 | 3064.2 / 1.0000 |
| hnswlib_f32 | ef 200 | 628.3 / 1.0000 | 678.4 / 1.0000 | 647.8 / 1.0000 | 704.0 / 1.0000 | 843.2 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2903.3 / 1.0000 | 3007.4 / 1.0000 | 3971.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1017.1 / 1.0000 | 1092.1 / 1.0000 | 1188.9 / 1.0000 | 1092.7 / 1.0000 | 1115.8 / 1.0000 | 1515.3 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1611.1 / 1.0000 | 1686.6 / 1.0000 | 2037.7 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 81.0 / 0.9999 | 100.9 / 0.9999 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 155.4 / 0.9998 | 175.1 / 0.9998 | 617.2 / 0.9998 |
| ours_scan | ef 200 |  |  | 89.8 / 0.9998 | 110.8 / 0.9998 | 156.2 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 105.4 / 0.9998 | 127.5 / 0.9998 | 261.7 / 0.9998 |  |  |  |
| ours_walk | ef 100 | 70.3 / 0.9990 | 87.2 / 0.9990 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 206.5 / 0.9998 | 225.4 / 0.9998 | 668.6 / 0.9998 |
| ours_walk | ef 200 | 83.9 / 0.9993 | 101.4 / 0.9993 | 91.3 / 0.9993 | 111.7 / 0.9993 | 154.7 / 0.9993 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 265.5 / 0.9998 | 287.6 / 0.9998 | 720.4 / 0.9998 |
| ours_walk | ef 400 |  |  | 109.7 / 0.9993 | 129.4 / 0.9993 | 171.2 / 0.9993 | 123.6 / 0.9993 | 149.4 / 0.9993 | 281.4 / 0.9993 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 151.3 / 0.9993 | 174.0 / 0.9993 | 313.9 / 0.9993 |  |  |  |
| scann | reorder 100 | 429.7 / 1.0000 | 473.5 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1091.9 / 1.0000 | 1192.5 / 1.0000 | 2111.7 / 1.0000 |
| scann | reorder 200 |  |  | 619.3 / 1.0000 | 732.7 / 1.0000 | 845.7 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 670.5 / 1.0000 | 806.9 / 1.0000 | 1172.6 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 139.9 / 0.9968 | 186.1 / 0.9968 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 750.0 / 0.9973 | 801.6 / 0.9973 | 1692.6 / 0.9973 |
| usearch_b1_rescore | ef 200 | 200.3 / 0.9971 | 247.1 / 0.9971 | 208.7 / 0.9971 | 270.4 / 0.9971 | 365.6 / 0.9971 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1259.8 / 0.9973 | 1316.9 / 0.9973 | 2222.7 / 0.9973 |
| usearch_b1_rescore | ef 400 |  |  | 342.3 / 0.9974 | 400.1 / 0.9974 | 506.1 / 0.9974 | 370.2 / 0.9973 | 413.8 / 0.9973 | 707.0 / 0.9973 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 565.8 / 0.9973 | 627.2 / 0.9973 | 935.0 / 0.9973 |  |  |  |

### dall / CodeRankEmbed (n_ho = 2400, exact quality 0.7906)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 2108.8 | 5 | 0.9930 | yes / yes | 5.00 [4.77, 5.91] | 498 | 2015 |
| diskann_vamana | 0.99 | 3562.2 | 5 | 0.9955 | yes / yes | 7.53 [6.81, 8.99] | 500 | 2044 |
| diskann_vamana | 0.995 | 4435.3 | 5 | 0.9982 | yes / yes | 9.34 [8.98, 11.33] | 507 | 2088 |
| faiss_bin_flat | 0.98 | 376.1 | 5 | 0.9868 | yes / no | 0.89 [0.85, 0.91] | 471 | 2799 |
| faiss_bin_flat | 0.99 | 433.1 | 5 | 0.9944 | yes / no | 0.92 [0.83, 0.96] | 471 | 2784 |
| faiss_bin_flat | 0.995 | 518.0 | 5 | 0.9973 | yes / no | 1.09 [1.05, 1.13] | 471 | 2784 |
| faiss_bin_hnsw | 0.98 | 453.6 | 5 | 0.9828 | yes / no | 1.08 [1.03, 1.23] | 541 | 3039 |
| faiss_bin_hnsw | 0.99 | 872.0 | 5 | 0.9918 | yes / no | 1.84 [1.67, 2.21] | 506 | 2987 |
| faiss_bin_hnsw | 0.995 | 1509.2 | 5 | 0.9965 | yes / no | 3.18 [3.06, 3.67] | 506 | 2904 |
| faiss_exact | 0.98 | 26034.7 | 5 | 1.0000 | yes / yes | 61.78 [55.85, 69.19] | 440 | 1282 |
| faiss_exact | 0.99 | 26034.7 | 5 | 1.0000 | yes / yes | 55.05 [49.80, 63.28] | 440 | 1282 |
| faiss_exact | 0.995 | 26034.7 | 5 | 1.0000 | yes / yes | 54.84 [49.92, 61.45] | 440 | 1282 |
| faiss_hnsw_flat | 0.98 | 992.4 | 5 | 0.9906 | yes / yes | 2.35 [2.20, 2.68] | 460 | 1329 |
| faiss_hnsw_flat | 0.99 | 1303.7 | 5 | 0.9937 | yes / no | 2.76 [2.49, 3.29] | 477 | 1421 |
| faiss_hnsw_flat | 0.995 | 2450.3 | 5 | 0.9993 | yes / yes | 5.16 [4.98, 6.23] | 477 | 1422 |
| faiss_hnsw_sq8 | 0.98 | 878.3 | 5 | 0.9891 | yes / yes | 2.08 [1.84, 3.66] | 575 | 3130 |
| faiss_hnsw_sq8 | 0.99 | 1175.9 | 5 | 0.9943 | yes / no | 2.49 [2.25, 4.36] | 610 | 3179 |
| faiss_hnsw_sq8 | 0.995 | 2166.1 | 5 | 0.9991 | yes / yes | 4.56 [4.13, 8.18] | 610 | 3206 |
| faiss_ivfpq_fs | 0.98 | 839.4 | 5 | 0.9998 | yes / yes | 1.99 [1.85, 2.02] | 472 | 2827 |
| faiss_ivfpq_fs | 0.99 | 839.4 | 5 | 0.9998 | yes / yes | 1.77 [1.61, 1.84] | 472 | 2827 |
| faiss_ivfpq_fs | 0.995 | 839.4 | 5 | 0.9998 | yes / yes | 1.77 [1.66, 1.79] | 472 | 2827 |
| faiss_rabitq_flat | 0.98 | 2456.5 | 5 | 0.9988 | yes / yes | 5.83 [5.29, 5.89] | 471 | 2813 |
| faiss_rabitq_flat | 0.99 | 2456.5 | 5 | 0.9988 | yes / yes | 5.19 [4.70, 5.39] | 471 | 2813 |
| faiss_rabitq_flat | 0.995 | 2456.5 | 5 | 0.9988 | yes / yes | 5.17 [4.73, 5.23] | 471 | 2813 |
| faiss_rabitq_hnsw | 0.98 | 397.8 | 5 | 0.9843 | yes / no | 0.94 [0.90, 1.26] | 541 | 3022 |
| faiss_rabitq_hnsw | 0.99 | 602.3 | 5 | 0.9931 | yes / no | 1.27 [1.15, 1.73] | 541 | 3045 |
| faiss_rabitq_hnsw | 0.995 | 922.5 | 5 | 0.9990 | yes / yes | 1.94 [1.86, 2.47] | 541 | 3039 |
| faiss_rabitq_ivf | 0.98 | 1877.6 | 5 | 0.9938 | yes / yes | 4.46 [4.26, 4.59] | 472 | 2811 |
| faiss_rabitq_ivf | 0.99 | 2854.0 | 5 | 1.0000 | yes / yes | 6.03 [5.46, 6.26] | 472 | 2828 |
| faiss_rabitq_ivf | 0.995 | 2854.0 | 5 | 1.0000 | yes / yes | 6.01 [5.80, 6.22] | 472 | 2828 |
| hnswlib_f32 | 0.98 | 925.3 | 5 | 0.9902 | yes / yes | 2.20 [2.02, 2.52] | 525 | 1316 |
| hnswlib_f32 | 0.99 | 1482.0 | 5 | 0.9980 | yes / yes | 3.13 [2.83, 3.65] | 491 | 1281 |
| hnswlib_f32 | 0.995 | 2733.4 | 5 | 0.9986 | yes / yes | 5.76 [5.51, 6.65] | 491 | 1252 |
| ours_cascade | 0.98 | 421.4 | 5 | 0.9852 | yes / no |  | 554 | 276 |
| ours_cascade | 0.99 | 472.9 | 5 | 0.9946 | yes / no |  | 554 | 335 |
| ours_cascade | 0.995 | 474.7 | 5 | 0.9971 | yes / no |  | 554 | 478 |
| scann | 0.98 | 6233.7 | 5 | 1.0000 | yes / yes | 14.79 [13.98, 15.13] | 508 | 1862 |
| scann | 0.99 | 6233.7 | 5 | 1.0000 | yes / yes | 13.18 [11.92, 13.83] | 508 | 1862 |
| scann | 0.995 | 6233.7 | 5 | 1.0000 | yes / yes | 13.13 [12.53, 13.43] | 508 | 1862 |
| svs_vamana_leanvec | 0.98 | 2303.2 | 5 | 0.9927 | yes / yes | 5.46 [5.04, 6.00] | 200 | 797 |
| svs_vamana_leanvec | 0.99 | 2303.2 | 5 | 0.9927 | yes / no | 4.87 [4.41, 5.45] | 200 | 797 |
| svs_vamana_lvq | 0.98 | 1619.4 | 5 | 0.9868 | yes / no | 3.84 [3.56, 4.10] | 232 | 912 |
| svs_vamana_lvq | 0.99 | 3469.1 | 5 | 0.9941 | yes / no | 7.34 [6.64, 7.93] | 232 | 936 |
| usearch_b1_rescore | 0.98 | 649.5 | 5 | 0.9838 | yes / no | 1.54 [1.46, 1.82] | 523 | 2994 |
| usearch_b1_rescore | 0.99 | 939.8 | 5 | 0.9893 | no / no | 1.99 [1.80, 2.40] | 557 | 3133 |
| usearch_b1_rescore | 0.995 | 1671.7 | 5 | 0.9940 | no / no | 3.52 [2.89, 4.58] | 523 | 2976 |
| usearch_f16 | 0.98 | 1797.8 | 5 | 0.9910 | yes / yes | 4.27 [3.97, 6.01] | 284 | 1140 |
| usearch_f16 | 0.99 | 2407.0 | 5 | 0.9935 | yes / no | 5.09 [4.60, 7.27] | 267 | 1047 |
| usearch_f16 | 0.995 | 3834.6 | 5 | 0.9971 | yes / no | 8.08 [7.27, 11.17] | 319 | 1271 |
| usearch_i8 | 0.98 | 1226.5 | 5 | 0.9917 | yes / yes | 2.91 [2.55, 4.29] | 181 | 620 |
| usearch_i8 | 0.99 | 1226.5 | 5 | 0.9917 | yes / no | 2.59 [2.27, 3.93] | 181 | 620 |
| usearch_i8 | 0.995 | 2347.3 | 5 | 0.9937 | no / no | 4.94 [4.20, 7.10] | 181 | 587 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1059.5 / 0.9665 | 1116.9 / 0.9664 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 6767.3 / 0.9994 | 6863.3 / 0.9999 | 7810.2 / 0.9998 |
| diskann_vamana | L 200 | 1776.0 / 0.9860 | 1865.5 / 0.9859 | 1814.0 / 0.9860 | 1908.7 / 0.9859 | 1968.2 / 0.9859 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 11517.9 / 0.9997 | 11654.8 / 1.0001 | 12593.9 / 1.0001 |
| diskann_vamana | L 400 |  |  | 3113.8 / 0.9985 | 3216.9 / 0.9984 | 3297.2 / 0.9984 | 3185.7 / 0.9984 | 3247.4 / 0.9984 | 3572.1 / 0.9984 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 5540.5 / 0.9990 | 5594.4 / 0.9994 | 6004.7 / 0.9993 |  |  |  |
| faiss_bin_flat | exhaustive | 463.3 / 0.9934 | 521.7 / 0.9934 | 529.5 / 0.9958 | 582.8 / 0.9958 | 681.6 / 0.9958 | 662.8 / 0.9982 | 711.5 / 0.9982 | 986.1 / 0.9981 | 1013.2 / 0.9995 | 1073.3 / 0.9994 | 2000.9 / 0.9994 |
| faiss_bin_hnsw | ef 100 | 227.9 / 0.9456 | 295.4 / 0.9456 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1733.0 / 0.9985 | 1772.0 / 0.9984 | 2776.6 / 0.9984 |
| faiss_bin_hnsw | ef 200 | 339.3 / 0.9707 | 399.5 / 0.9707 | 389.5 / 0.9734 | 445.8 / 0.9734 | 564.2 / 0.9734 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 3135.6 / 0.9992 | 3196.3 / 0.9992 | 4145.9 / 0.9991 |
| faiss_bin_hnsw | ef 400 |  |  | 604.8 / 0.9849 | 670.9 / 0.9849 | 786.6 / 0.9849 | 703.9 / 0.9876 | 757.9 / 0.9876 | 1103.3 / 0.9876 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1175.4 / 0.9969 | 1226.8 / 0.9969 | 1567.0 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 656.3 / 0.9828 | 714.6 / 0.9828 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 5055.1 / 0.9992 | 5100.7 / 0.9995 | 6149.4 / 0.9995 |
| faiss_hnsw_flat | ef 200 | 1125.7 / 0.9914 | 1197.8 / 0.9913 | 1169.1 / 0.9914 | 1248.6 / 0.9913 | 1329.9 / 0.9913 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 8995.5 / 0.9997 | 9054.0 / 1.0001 | 10116.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2104.8 / 0.9979 | 2174.5 / 0.9978 | 2282.5 / 0.9978 | 2216.3 / 0.9978 | 2257.7 / 0.9979 | 2587.2 / 0.9978 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3934.1 / 0.9991 | 4020.1 / 0.9994 | 4316.3 / 0.9993 |  |  |  |
| faiss_rabitq_flat | exhaustive | 2519.0 / 1.0001 | 2593.5 / 1.0001 | 2565.9 / 1.0001 | 2624.0 / 1.0001 | 2663.9 / 1.0001 | 2551.6 / 1.0000 | 2731.2 / 1.0001 | 2999.5 / 1.0000 | 2836.6 / 0.9997 | 2929.5 / 1.0001 | 3875.1 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 97.5 / 0.3543 | 146.7 / 0.3543 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 561.1 / 0.7749 | 609.4 / 0.7749 | 1539.1 / 0.7749 |
| faiss_rabitq_ivf | nprobe 2 | 109.3 / 0.4667 | 159.2 / 0.4667 | 136.6 / 0.4667 | 183.0 / 0.4667 | 285.3 / 0.4667 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 167.6 / 0.5694 | 212.9 / 0.5694 | 318.0 / 0.5694 | 214.0 / 0.5694 | 269.8 / 0.5694 | 560.3 / 0.5694 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 264.9 / 0.6688 | 321.2 / 0.6689 | 611.2 / 0.6689 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 437.3 / 0.6870 | 490.3 / 0.6870 | 1408.7 / 0.6870 |
| hnswlib_f32 | ef 100 | 711.9 / 0.9824 | 736.4 / 0.9824 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 5236.9 / 0.9992 | 5273.0 / 0.9996 | 6308.2 / 0.9995 |
| hnswlib_f32 | ef 200 | 1265.5 / 0.9959 | 1283.0 / 0.9958 | 1230.7 / 0.9959 | 1312.5 / 0.9958 | 1403.9 / 0.9958 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 9034.8 / 0.9991 | 9102.2 / 0.9995 | 10120.2 / 0.9995 |
| hnswlib_f32 | ef 400 |  |  | 2256.6 / 0.9986 | 2345.5 / 0.9986 | 2451.3 / 0.9985 | 2344.6 / 0.9985 | 2385.6 / 0.9986 | 2720.0 / 0.9985 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 4205.2 / 0.9992 | 4261.0 / 0.9993 | 4601.9 / 0.9992 |  |  |  |
| ours_scan | ef 100 | 387.6 / 0.9932 | 414.1 / 0.9932 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 460.5 / 0.9990 | 484.8 / 0.9989 | 978.2 / 0.9989 |
| ours_scan | ef 200 |  |  | 396.2 / 0.9952 | 421.7 / 0.9952 | 468.9 / 0.9952 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 415.8 / 0.9981 | 438.4 / 0.9981 | 572.9 / 0.9981 |  |  |  |
| ours_walk | ef 100 | 121.9 / 0.9769 | 142.8 / 0.9769 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 401.5 / 0.9966 | 426.7 / 0.9965 | 945.1 / 0.9964 |
| ours_walk | ef 200 | 154.3 / 0.9823 | 177.6 / 0.9823 | 163.9 / 0.9846 | 187.2 / 0.9846 | 237.1 / 0.9846 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 524.6 / 0.9992 | 550.1 / 0.9991 | 1074.8 / 0.9991 |
| ours_walk | ef 400 |  |  | 217.8 / 0.9896 | 239.4 / 0.9896 | 292.0 / 0.9896 | 232.7 / 0.9927 | 257.3 / 0.9927 | 415.0 / 0.9927 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 316.3 / 0.9948 | 344.2 / 0.9948 | 503.7 / 0.9948 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 181.0 / 0.1222 | 227.7 / 0.1222 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 1066.7 / 0.3873 | 1128.7 / 0.3873 | 2055.1 / 0.3873 |
| scann | leaves_to_search 2, reorder 100 | 205.9 / 0.1680 | 247.5 / 0.1680 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 266.6 / 0.1680 | 320.1 / 0.1680 | 410.2 / 0.1680 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 306.6 / 0.2342 | 362.6 / 0.2342 | 444.6 / 0.2342 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 432.0 / 0.2342 | 488.7 / 0.2342 | 761.6 / 0.2342 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 912.9 / 0.3020 | 967.4 / 0.3020 | 1844.6 / 0.3020 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 520.8 / 0.3020 | 573.6 / 0.3020 | 895.9 / 0.3020 |  |  |  |
| usearch_b1_rescore | ef 100 | 228.6 / 0.9338 | 261.6 / 0.9338 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1495.5 / 0.9957 | 1626.1 / 0.9956 | 2603.3 / 0.9956 |
| usearch_b1_rescore | ef 200 | 327.9 / 0.9664 | 391.3 / 0.9664 | 347.1 / 0.9677 | 402.3 / 0.9677 | 518.5 / 0.9677 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2671.1 / 0.9981 | 2787.1 / 0.9979 | 3783.2 / 0.9979 |
| usearch_b1_rescore | ef 400 |  |  | 592.6 / 0.9821 | 649.9 / 0.9821 | 782.6 / 0.9821 | 632.1 / 0.9842 | 689.9 / 0.9842 | 1036.5 / 0.9842 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1115.3 / 0.9944 | 1176.2 / 0.9944 | 1555.2 / 0.9944 |  |  |  |

### dall / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.6332)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 705.9 | 5 | 0.9900 | yes / yes | 1.41 [1.38, 1.43] | 471 | 2706 |
| faiss_exact | 0.98 | 25609.8 | 5 | 1.0000 | yes / yes | 51.13 [48.16, 56.16] | 440 | 1447 |
| faiss_exact | 0.99 | 25609.8 | 5 | 1.0000 | yes / yes | 46.54 [43.75, 51.12] | 440 | 1447 |
| faiss_exact | 0.995 | 25609.8 | 5 | 1.0000 | yes / yes | 39.94 [36.53, 43.87] | 440 | 1447 |
| faiss_hnsw_flat | 0.98 | 1802.6 | 5 | 0.9909 | yes / yes | 3.60 [3.50, 3.92] | 477 | 1544 |
| faiss_hnsw_flat | 0.99 | 2009.1 | 5 | 0.9907 | yes / no | 3.65 [3.47, 3.92] | 511 | 1679 |
| faiss_hnsw_sq8 | 0.98 | 1570.4 | 5 | 0.9926 | yes / yes | 3.13 [2.78, 4.00] | 610 | 3182 |
| faiss_hnsw_sq8 | 0.99 | 1762.1 | 5 | 0.9907 | yes / no | 3.20 [2.89, 3.92] | 644 | 3296 |
| faiss_hnsw_sq8 | 0.995 | 3397.6 | 5 | 0.9988 | yes / yes | 5.30 [4.45, 5.99] | 644 | 3293 |
| faiss_ivfpq_fs | 0.98 | 817.4 | 5 | 0.9980 | yes / yes | 1.63 [1.56, 1.72] | 472 | 2732 |
| faiss_ivfpq_fs | 0.99 | 817.4 | 5 | 0.9980 | yes / yes | 1.49 [1.42, 1.56] | 472 | 2732 |
| faiss_ivfpq_fs | 0.995 | 982.7 | 5 | 0.9992 | yes / yes | 1.53 [1.43, 1.58] | 472 | 2738 |
| faiss_rabitq_flat | 0.98 | 2319.2 | 5 | 0.9981 | yes / yes | 4.63 [4.48, 4.72] | 471 | 2716 |
| faiss_rabitq_flat | 0.99 | 2319.2 | 5 | 0.9981 | yes / yes | 4.21 [4.04, 4.29] | 471 | 2716 |
| faiss_rabitq_flat | 0.995 | 2319.2 | 5 | 0.9981 | yes / yes | 3.62 [3.37, 3.68] | 471 | 2716 |
| faiss_rabitq_hnsw | 0.98 | 1396.0 | 5 | 0.9923 | yes / yes | 2.79 [2.71, 3.19] | 541 | 2981 |
| faiss_rabitq_ivf | 0.98 | 1876.0 | 5 | 0.9887 | yes / yes | 3.74 [3.67, 3.83] | 472 | 2749 |
| faiss_rabitq_ivf | 0.99 | 2827.0 | 5 | 1.0000 | yes / yes | 5.14 [4.96, 5.28] | 472 | 2744 |
| faiss_rabitq_ivf | 0.995 | 2827.0 | 5 | 1.0000 | yes / yes | 4.41 [4.11, 4.52] | 472 | 2744 |
| hnswlib_f32 | 0.98 | 1897.5 | 5 | 0.9857 | yes / no | 3.79 [3.62, 4.02] | 491 | 1396 |
| hnswlib_f32 | 0.99 | 3460.0 | 5 | 0.9968 | yes / yes | 6.29 [5.95, 6.77] | 491 | 1405 |
| hnswlib_f32 | 0.995 | 3729.7 | 5 | 0.9966 | yes / no | 5.82 [5.35, 6.21] | 525 | 1507 |
| ours_cascade | 0.98 | 500.9 | 5 | 0.9817 | yes / no |  | 559 | 539 |
| ours_cascade | 0.99 | 550.3 | 5 | 0.9948 | yes / no |  | 559 | 948 |
| ours_cascade | 0.995 | 641.2 | 5 | 0.9950 | no / no |  | 558 | 1493 |
| scann | 0.98 | 6341.2 | 5 | 1.0000 | yes / yes | 12.66 [12.06, 12.87] | 514 | 1997 |
| scann | 0.99 | 6341.2 | 5 | 1.0000 | yes / yes | 11.52 [10.98, 11.72] | 514 | 1997 |
| scann | 0.995 | 6341.2 | 5 | 1.0000 | yes / yes | 9.89 [9.20, 10.08] | 514 | 1997 |
| usearch_f16 | 0.98 | 3598.3 | 5 | 0.9939 | yes / yes | 7.18 [6.71, 8.81] | 267 | 994 |
| usearch_f16 | 0.99 | 4484.2 | 5 | 0.9968 | yes / yes | 8.15 [7.67, 10.17] | 319 | 1221 |
| usearch_i8 | 0.98 | 2861.2 | 5 | 0.9879 | yes / yes | 5.71 [5.27, 6.99] | 182 | 581 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 889.5 / 0.7097 | 928.3 / 0.7098 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 4923.5 / 0.9742 | 5019.6 / 0.9742 | 5931.3 / 0.9741 |
| diskann_vamana | L 200 | 1405.3 / 0.8311 | 1437.8 / 0.8312 | 1428.8 / 0.8310 | 1463.5 / 0.8313 | 1586.6 / 0.8312 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 8259.9 / 0.9940 | 8295.2 / 0.9940 | 9266.1 / 0.9940 |
| diskann_vamana | L 400 |  |  | 2304.4 / 0.9115 | 2354.0 / 0.9118 | 2475.7 / 0.9117 | 2343.0 / 0.9115 | 2402.9 / 0.9118 | 2716.3 / 0.9117 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 3930.8 / 0.9608 | 4013.1 / 0.9606 | 4383.4 / 0.9605 |  |  |  |
| faiss_bin_flat | exhaustive | 457.7 / 0.9586 | 513.7 / 0.9586 | 525.4 / 0.9716 | 581.8 / 0.9717 | 676.0 / 0.9717 | 650.3 / 0.9855 | 707.4 / 0.9855 | 973.1 / 0.9855 | 1011.7 / 0.9946 | 1057.8 / 0.9948 | 1991.0 / 0.9948 |
| faiss_bin_hnsw | ef 100 | 209.5 / 0.8086 | 255.7 / 0.8087 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1513.7 / 0.9835 | 1552.2 / 0.9838 | 2492.2 / 0.9837 |
| faiss_bin_hnsw | ef 200 | 296.8 / 0.8824 | 353.9 / 0.8824 | 325.1 / 0.8919 | 418.2 / 0.8919 | 488.2 / 0.8919 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2692.8 / 0.9886 | 2730.2 / 0.9889 | 3675.4 / 0.9888 |
| faiss_bin_hnsw | ef 400 |  |  | 520.6 / 0.9362 | 565.5 / 0.9363 | 689.4 / 0.9363 | 594.0 / 0.9464 | 658.4 / 0.9462 | 965.8 / 0.9463 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 996.7 / 0.9701 | 1037.9 / 0.9700 | 1392.4 / 0.9701 |  |  |  |
| faiss_hnsw_flat | ef 100 | 527.5 / 0.9282 | 559.5 / 0.9284 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3862.1 / 0.9987 | 3896.4 / 0.9988 | 4867.3 / 0.9987 |
| faiss_hnsw_flat | ef 200 | 887.0 / 0.9634 | 933.4 / 0.9634 | 920.4 / 0.9633 | 972.6 / 0.9635 | 1061.4 / 0.9634 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 6837.4 / 0.9987 | 6885.9 / 0.9988 | 7874.6 / 0.9987 |
| faiss_hnsw_flat | ef 400 |  |  | 1609.5 / 0.9866 | 1642.2 / 0.9867 | 1745.2 / 0.9867 | 1683.4 / 0.9864 | 1735.6 / 0.9867 | 2059.0 / 0.9867 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2956.0 / 0.9965 | 3000.0 / 0.9967 | 3324.4 / 0.9966 |  |  |  |
| faiss_rabitq_flat | exhaustive | 2487.7 / 0.9996 | 2562.8 / 0.9996 | 2543.3 / 1.0001 | 2601.2 / 1.0001 | 2678.2 / 1.0000 | 2583.9 / 1.0001 | 2712.9 / 1.0000 | 3005.1 / 1.0000 | 2870.8 / 1.0000 | 2907.4 / 1.0001 | 3859.1 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 98.8 / 0.1445 | 149.1 / 0.1445 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 559.4 / 0.4763 | 605.4 / 0.4766 | 1534.3 / 0.4765 |
| faiss_rabitq_ivf | nprobe 2 | 110.3 / 0.1944 | 162.5 / 0.1944 | 133.4 / 0.1944 | 184.6 / 0.1944 | 291.1 / 0.1944 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 157.9 / 0.2562 | 205.6 / 0.2562 | 310.9 / 0.2562 | 213.8 / 0.2562 | 265.5 / 0.2562 | 562.8 / 0.2562 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 265.8 / 0.3462 | 319.3 / 0.3464 | 615.3 / 0.3464 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 432.0 / 0.3616 | 494.4 / 0.3617 | 1410.0 / 0.3617 |
| hnswlib_f32 | ef 100 | 529.2 / 0.9036 | 572.4 / 0.9038 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 3759.5 / 0.9968 | 3816.7 / 0.9969 | 4751.6 / 0.9968 |
| hnswlib_f32 | ef 200 | 900.8 / 0.9490 | 951.8 / 0.9491 | 923.1 / 0.9490 | 964.0 / 0.9491 | 1113.9 / 0.9491 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 6441.2 / 0.9981 | 6459.9 / 0.9981 | 7539.2 / 0.9980 |
| hnswlib_f32 | ef 400 |  |  | 1639.0 / 0.9790 | 1670.3 / 0.9793 | 1797.5 / 0.9793 | 1707.7 / 0.9790 | 1781.0 / 0.9793 | 2066.9 / 0.9793 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2978.0 / 0.9946 | 3044.7 / 0.9948 | 3349.0 / 0.9947 |  |  |  |
| ours_scan | ef 100 | 382.6 / 0.9537 | 405.7 / 0.9537 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 458.9 / 0.9946 | 488.2 / 0.9949 | 969.6 / 0.9948 |
| ours_scan | ef 200 |  |  | 392.0 / 0.9680 | 416.6 / 0.9681 | 464.8 / 0.9681 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 411.2 / 0.9817 | 436.1 / 0.9817 | 568.1 / 0.9817 |  |  |  |
| ours_walk | ef 100 | 112.8 / 0.8783 | 131.5 / 0.8783 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 338.7 / 0.9806 | 363.0 / 0.9808 | 903.0 / 0.9807 |
| ours_walk | ef 200 | 134.5 / 0.9126 | 157.4 / 0.9126 | 141.7 / 0.9251 | 165.5 / 0.9252 | 215.2 / 0.9252 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 431.6 / 0.9889 | 461.9 / 0.9893 | 999.3 / 0.9892 |
| ours_walk | ef 400 |  |  | 186.7 / 0.9412 | 210.1 / 0.9413 | 260.6 / 0.9413 | 200.0 / 0.9517 | 225.6 / 0.9517 | 378.8 / 0.9518 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 266.0 / 0.9690 | 293.2 / 0.9690 | 446.1 / 0.9690 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 181.0 / 0.0704 | 226.4 / 0.0704 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 1033.1 / 0.2078 | 1103.6 / 0.2077 | 2021.9 / 0.2077 |
| scann | leaves_to_search 2, reorder 100 | 201.0 / 0.0930 | 244.9 / 0.0930 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 259.3 / 0.0930 | 307.5 / 0.0930 | 403.0 / 0.0930 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 297.9 / 0.1126 | 351.6 / 0.1126 | 439.2 / 0.1126 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 408.5 / 0.1126 | 467.1 / 0.1126 | 753.6 / 0.1126 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 860.2 / 0.1481 | 919.3 / 0.1481 | 1812.4 / 0.1481 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 494.8 / 0.1481 | 558.2 / 0.1481 | 892.2 / 0.1481 |  |  |  |
| usearch_b1_rescore | ef 100 | 194.5 / 0.8132 | 248.6 / 0.8132 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1306.3 / 0.9787 | 1352.9 / 0.9790 | 2352.2 / 0.9790 |
| usearch_b1_rescore | ef 200 | 299.2 / 0.8768 | 350.2 / 0.8768 | 316.9 / 0.8899 | 375.8 / 0.8900 | 483.9 / 0.8900 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2354.2 / 0.9901 | 2422.2 / 0.9904 | 3410.9 / 0.9904 |
| usearch_b1_rescore | ef 400 |  |  | 516.1 / 0.9306 | 587.3 / 0.9307 | 704.8 / 0.9307 | 558.1 / 0.9427 | 631.4 / 0.9426 | 962.2 / 0.9427 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 974.7 / 0.9628 | 1045.4 / 0.9628 | 1368.8 / 0.9628 |  |  |  |

### dall / jina-v2-base-code (n_ho = 2400, exact quality 0.7576)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 585.2 | 5 | 0.9892 | yes / yes | 1.39 [1.37, 1.50] | 483 | 2235 |
| diskann_vamana | 0.99 | 880.5 | 5 | 0.9955 | yes / yes | 2.09 [2.07, 2.31] | 498 | 2303 |
| diskann_vamana | 0.995 | 999.4 | 5 | 0.9979 | yes / yes | 2.25 [2.02, 2.46] | 483 | 2204 |
| faiss_bin_flat | 0.98 | 324.8 | 5 | 0.9893 | yes / yes | 0.77 [0.76, 0.78] | 471 | 3015 |
| faiss_bin_flat | 0.99 | 340.1 | 5 | 0.9968 | yes / yes | 0.81 [0.80, 0.81] | 471 | 3002 |
| faiss_bin_flat | 0.995 | 340.1 | 5 | 0.9968 | yes / no | 0.76 [0.69, 0.77] | 471 | 3002 |
| faiss_bin_hnsw | 0.98 | 139.2 | 5 | 0.9850 | yes / no | 0.33 [0.33, 0.36] | 541 | 3251 |
| faiss_bin_hnsw | 0.99 | 219.6 | 5 | 0.9929 | yes / no | 0.52 [0.52, 0.56] | 472 | 3078 |
| faiss_bin_hnsw | 0.995 | 272.9 | 5 | 0.9954 | yes / no | 0.61 [0.55, 0.68] | 506 | 3213 |
| faiss_exact | 0.98 | 23291.9 | 5 | 1.0000 | yes / yes | 55.23 [54.67, 65.62] | 439 | 1432 |
| faiss_exact | 0.99 | 23291.9 | 5 | 1.0000 | yes / yes | 55.23 [54.67, 65.62] | 439 | 1432 |
| faiss_exact | 0.995 | 23291.9 | 5 | 1.0000 | yes / yes | 52.33 [47.11, 62.17] | 439 | 1432 |
| faiss_hnsw_flat | 0.98 | 226.3 | 5 | 0.9877 | yes / yes | 0.54 [0.53, 0.59] | 459 | 1477 |
| faiss_hnsw_flat | 0.99 | 298.0 | 5 | 0.9879 | no / no | 0.71 [0.70, 0.77] | 477 | 1555 |
| faiss_hnsw_flat | 0.995 | 620.1 | 5 | 0.9979 | yes / yes | 1.39 [1.25, 1.51] | 511 | 1649 |
| faiss_hnsw_sq8 | 0.98 | 209.4 | 5 | 0.9884 | yes / yes | 0.50 [0.48, 0.64] | 575 | 3403 |
| faiss_hnsw_sq8 | 0.99 | 276.5 | 5 | 0.9872 | no / no | 0.66 [0.63, 0.80] | 610 | 3489 |
| faiss_hnsw_sq8 | 0.995 | 460.8 | 5 | 0.9975 | yes / no | 1.04 [0.93, 1.33] | 610 | 3509 |
| faiss_ivfpq_fs | 0.98 | 483.1 | 5 | 0.9907 | yes / yes | 1.15 [1.10, 1.17] | 472 | 3052 |
| faiss_ivfpq_fs | 0.99 | 483.1 | 5 | 0.9907 | yes / no | 1.15 [1.10, 1.17] | 472 | 3052 |
| faiss_ivfpq_fs | 0.995 | 816.4 | 5 | 1.0000 | yes / yes | 1.83 [1.65, 1.92] | 472 | 3038 |
| faiss_rabitq_flat | 0.98 | 2460.6 | 5 | 0.9997 | yes / yes | 5.83 [5.23, 5.89] | 471 | 3034 |
| faiss_rabitq_flat | 0.99 | 2460.6 | 5 | 0.9997 | yes / yes | 5.83 [5.23, 5.89] | 471 | 3034 |
| faiss_rabitq_flat | 0.995 | 2460.6 | 5 | 0.9997 | yes / yes | 5.53 [4.96, 5.57] | 471 | 3034 |
| faiss_rabitq_hnsw | 0.98 | 124.7 | 5 | 0.9922 | yes / yes | 0.30 [0.29, 0.33] | 541 | 3310 |
| faiss_rabitq_hnsw | 0.99 | 209.2 | 5 | 0.9968 | yes / yes | 0.50 [0.49, 0.55] | 541 | 3327 |
| faiss_rabitq_hnsw | 0.995 | 366.7 | 5 | 0.9985 | yes / yes | 0.82 [0.74, 0.93] | 541 | 3273 |
| faiss_rabitq_ivf | 0.98 | 1309.4 | 5 | 0.9921 | yes / yes | 3.11 [3.07, 3.16] | 472 | 3036 |
| faiss_rabitq_ivf | 0.99 | 1411.2 | 5 | 0.9905 | yes / no | 3.35 [3.25, 3.40] | 472 | 3022 |
| faiss_rabitq_ivf | 0.995 | 1837.8 | 5 | 0.9957 | yes / no | 4.13 [3.72, 4.16] | 472 | 3025 |
| hnswlib_f32 | 0.98 | 327.6 | 5 | 0.9909 | yes / yes | 0.78 [0.77, 0.90] | 491 | 1384 |
| hnswlib_f32 | 0.99 | 425.0 | 5 | 0.9950 | yes / yes | 1.01 [1.00, 1.15] | 473 | 1362 |
| hnswlib_f32 | 0.995 | 593.1 | 5 | 0.9964 | yes / no | 1.33 [1.20, 1.49] | 491 | 1364 |
| ours_cascade | 0.98 | 421.7 | 5 | 0.9979 | yes / yes |  | 549 | 278 |
| ours_cascade | 0.99 | 421.7 | 5 | 0.9979 | yes / yes |  | 549 | 278 |
| ours_cascade | 0.995 | 445.1 | 5 | 0.9975 | yes / no |  | 550 | 295 |
| scann | 0.98 | 3049.3 | 5 | 0.9908 | yes / yes | 7.23 [7.16, 7.26] | 532 | 2307 |
| scann | 0.99 | 3195.9 | 5 | 0.9987 | yes / yes | 7.58 [7.48, 7.61] | 540 | 2325 |
| scann | 0.995 | 5001.7 | 5 | 0.9997 | yes / yes | 11.24 [10.12, 11.28] | 532 | 2291 |
| svs_vamana_leanvec | 0.98 | 233.9 | 5 | 0.9833 | yes / no | 0.55 [0.55, 0.61] | 200 | 864 |
| svs_vamana_leanvec | 0.99 | 476.5 | 5 | 0.9911 | yes / no | 1.13 [1.12, 1.25] | 200 | 866 |
| svs_vamana_leanvec | 0.995 | 1002.5 | 5 | 0.9996 | yes / yes | 2.25 [2.03, 2.55] | 200 | 869 |
| svs_vamana_lvq | 0.98 | 661.7 | 5 | 0.9948 | yes / yes | 1.57 [1.55, 1.75] | 232 | 1009 |
| svs_vamana_lvq | 0.99 | 661.7 | 5 | 0.9948 | yes / no | 1.57 [1.55, 1.75] | 232 | 1009 |
| svs_vamana_lvq | 0.995 | 3189.0 | 5 | 0.9994 | yes / yes | 7.17 [6.45, 8.02] | 232 | 1016 |
| usearch_b1_rescore | 0.98 | 134.6 | 5 | 0.9885 | yes / yes | 0.32 [0.32, 0.36] | 523 | 3207 |
| usearch_b1_rescore | 0.99 | 170.4 | 5 | 0.9890 | no / no | 0.40 [0.40, 0.47] | 557 | 3400 |
| usearch_b1_rescore | 0.995 | 297.3 | 5 | 0.9949 | no / no | 0.67 [0.60, 0.77] | 557 | 3387 |
| usearch_f16 | 0.98 | 391.0 | 5 | 0.9894 | yes / yes | 0.93 [0.92, 1.21] | 284 | 1230 |
| usearch_f16 | 0.99 | 747.8 | 5 | 0.9967 | yes / yes | 1.77 [1.76, 2.23] | 319 | 1425 |
| usearch_f16 | 0.995 | 1425.7 | 5 | 0.9949 | no / no | 3.20 [2.88, 4.02] | 267 | 1183 |
| usearch_i8 | 0.98 | 255.5 | 5 | 0.9878 | yes / yes | 0.61 [0.60, 0.76] | 182 | 650 |
| usearch_i8 | 0.99 | 449.9 | 5 | 0.9947 | yes / yes | 1.07 [1.06, 1.33] | 181 | 664 |
| usearch_i8 | 0.995 | 813.8 | 5 | 0.9970 | yes / no | 1.83 [1.65, 2.36] | 181 | 650 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 822.3 / 0.9919 | 865.6 / 0.9919 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 4927.7 / 0.9999 | 4989.3 / 1.0000 | 6026.1 / 1.0000 |
| diskann_vamana | L 200 | 1341.4 / 0.9978 | 1379.2 / 0.9978 | 1366.6 / 0.9978 | 1403.7 / 0.9978 | 1522.1 / 0.9978 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 8417.1 / 0.9999 | 8472.5 / 1.0000 | 9511.4 / 1.0000 |
| diskann_vamana | L 400 |  |  | 2287.4 / 0.9996 | 2340.2 / 0.9997 | 2462.2 / 0.9997 | 2343.2 / 0.9996 | 2399.4 / 0.9997 | 2752.5 / 0.9997 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 3994.6 / 0.9999 | 4053.0 / 1.0000 | 4408.0 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 465.9 / 0.9979 | 529.6 / 0.9979 | 532.4 / 0.9982 | 589.3 / 0.9982 | 693.1 / 0.9982 | 651.2 / 1.0001 | 709.7 / 1.0001 | 982.5 / 1.0001 | 992.9 / 1.0000 | 1043.9 / 1.0000 | 2026.9 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 193.6 / 0.9850 | 239.9 / 0.9850 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1334.2 / 1.0000 | 1401.5 / 1.0000 | 2377.2 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 265.5 / 0.9946 | 330.8 / 0.9946 | 303.4 / 0.9949 | 370.7 / 0.9949 | 459.4 / 0.9949 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2417.6 / 1.0000 | 2457.7 / 1.0000 | 3503.3 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 471.1 / 0.9971 | 522.5 / 0.9971 | 647.8 / 0.9971 | 548.8 / 0.9990 | 600.4 / 0.9990 | 916.1 / 0.9990 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 907.4 / 1.0001 | 956.2 / 1.0001 | 1298.9 / 1.0001 |  |  |  |
| faiss_hnsw_flat | ef 100 | 545.4 / 0.9943 | 579.2 / 0.9943 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3958.7 / 0.9999 | 3998.0 / 1.0000 | 5051.0 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 896.6 / 0.9996 | 968.4 / 0.9996 | 943.5 / 0.9995 | 1015.9 / 0.9996 | 1086.6 / 0.9996 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 7013.2 / 0.9999 | 7078.7 / 1.0000 | 8106.1 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1650.8 / 0.9999 | 1712.1 / 1.0000 | 1805.3 / 1.0000 | 1740.1 / 0.9999 | 1803.1 / 1.0000 | 2133.8 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3037.5 / 0.9999 | 3094.8 / 1.0000 | 3450.1 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 2453.8 / 1.0000 | 2622.1 / 1.0000 | 2545.3 / 1.0000 | 2620.0 / 1.0000 | 2635.3 / 1.0000 | 2562.3 / 0.9999 | 2687.8 / 1.0000 | 2985.1 / 1.0000 | 2777.3 / 0.9999 | 2811.6 / 1.0000 | 3830.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 98.5 / 0.4295 | 148.9 / 0.4295 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 525.7 / 0.8460 | 571.7 / 0.8460 | 1503.2 / 0.8460 |
| faiss_rabitq_ivf | nprobe 2 | 109.7 / 0.5657 | 159.6 / 0.5657 | 133.7 / 0.5657 | 184.8 / 0.5657 | 282.5 / 0.5657 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 156.9 / 0.6840 | 208.8 / 0.6840 | 310.9 / 0.6840 | 205.9 / 0.6840 | 258.0 / 0.6840 | 552.0 / 0.6840 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 251.4 / 0.7644 | 306.0 / 0.7644 | 600.3 / 0.7644 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 416.7 / 0.7785 | 465.7 / 0.7785 | 1391.8 / 0.7785 |
| hnswlib_f32 | ef 100 | 558.4 / 0.9948 | 605.0 / 0.9948 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 3936.1 / 0.9999 | 3997.5 / 1.0000 | 5031.7 / 1.0000 |
| hnswlib_f32 | ef 200 | 948.6 / 0.9987 | 1019.5 / 0.9987 | 971.1 / 0.9987 | 1041.8 / 0.9987 | 1123.1 / 0.9987 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 6742.9 / 0.9999 | 6800.7 / 1.0000 | 7823.0 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1728.7 / 1.0000 | 1787.9 / 1.0000 | 1893.8 / 1.0000 | 1797.5 / 1.0000 | 1849.6 / 1.0000 | 2182.9 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 3120.6 / 0.9999 | 3178.5 / 1.0000 | 3525.3 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 390.5 / 0.9975 | 413.8 / 0.9975 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 473.4 / 1.0000 | 501.0 / 1.0000 | 982.7 / 1.0000 |
| ours_scan | ef 200 |  |  | 401.2 / 0.9982 | 424.6 / 0.9982 | 473.2 / 0.9982 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 419.8 / 1.0001 | 446.2 / 1.0001 | 581.1 / 1.0001 |  |  |  |
| ours_walk | ef 100 | 93.2 / 0.9949 | 114.9 / 0.9949 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 304.2 / 1.0000 | 331.4 / 1.0000 | 858.8 / 1.0000 |
| ours_walk | ef 200 | 114.2 / 0.9962 | 137.0 / 0.9962 | 122.9 / 0.9969 | 146.7 / 0.9969 | 198.2 / 0.9969 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 400.0 / 1.0000 | 427.9 / 1.0000 | 951.2 / 1.0000 |
| ours_walk | ef 400 |  |  | 160.1 / 0.9971 | 183.6 / 0.9971 | 236.7 / 0.9971 | 177.1 / 0.9990 | 202.9 / 0.9990 | 363.2 / 0.9990 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 230.1 / 1.0001 | 256.0 / 1.0001 | 415.9 / 1.0001 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 191.2 / 0.2233 | 230.4 / 0.2233 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 1091.4 / 0.6013 | 1159.0 / 0.6013 | 2072.9 / 0.6013 |
| scann | leaves_to_search 2, reorder 100 | 211.5 / 0.3165 | 248.8 / 0.3165 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 277.4 / 0.3165 | 335.8 / 0.3165 | 413.2 / 0.3165 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 316.6 / 0.3992 | 377.2 / 0.3992 | 450.6 / 0.3992 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 442.7 / 0.3992 | 502.4 / 0.3992 | 773.6 / 0.3992 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 935.9 / 0.4833 | 998.2 / 0.4833 | 1902.5 / 0.4833 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 527.6 / 0.4833 | 588.8 / 0.4833 | 936.5 / 0.4833 |  |  |  |
| usearch_b1_rescore | ef 100 | 187.0 / 0.9884 | 232.4 / 0.9884 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1142.8 / 0.9995 | 1202.5 / 0.9995 | 2244.1 / 0.9995 |
| usearch_b1_rescore | ef 200 | 275.1 / 0.9930 | 327.9 / 0.9930 | 289.1 / 0.9929 | 344.5 / 0.9929 | 451.3 / 0.9929 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2115.1 / 0.9995 | 2166.5 / 0.9995 | 3218.7 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 467.0 / 0.9972 | 524.4 / 0.9972 | 639.2 / 0.9972 | 497.3 / 0.9991 | 556.1 / 0.9991 | 890.8 / 0.9991 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 869.9 / 0.9990 | 925.9 / 0.9990 | 1271.8 / 0.9990 |  |  |  |

### fiqa / CodeRankEmbed (n_ho = 259, exact quality 0.2924)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 851.9 | 5 | 0.9657 | no / no | 2.82 [2.79, 2.95] | 215 | 901 |
| diskann_vamana | 0.99 | 851.9 | 5 | 0.9657 | no / no |  | 215 | 901 |
| diskann_vamana | 0.995 | 1629.1 | 5 | 0.9951 | yes / no |  | 209 | 879 |
| faiss_exact | 0.98 | 7528.1 | 5 | 1.0000 | yes / yes | 24.89 [24.65, 26.11] | 181 | 559 |
| faiss_exact | 0.99 | 7528.1 | 5 | 1.0000 | yes / yes |  | 181 | 559 |
| faiss_exact | 0.995 | 7528.1 | 5 | 1.0000 | yes / yes |  | 181 | 559 |
| faiss_hnsw_flat | 0.98 | 506.9 | 5 | 0.9507 | no / no | 1.68 [1.66, 1.76] | 196 | 593 |
| faiss_hnsw_flat | 0.99 | 506.9 | 5 | 0.9507 | no / no |  | 196 | 593 |
| faiss_hnsw_flat | 0.995 | 591.2 | 5 | 0.9552 | no / no |  | 210 | 641 |
| faiss_hnsw_sq8 | 0.98 | 614.9 | 5 | 0.9552 | no / no | 2.03 [1.99, 2.13] | 253 | 1367 |
| faiss_hnsw_sq8 | 0.99 | 614.9 | 5 | 0.9552 | no / no |  | 253 | 1367 |
| faiss_hnsw_sq8 | 0.995 | 614.9 | 5 | 0.9552 | no / no |  | 253 | 1367 |
| faiss_ivfpq_fs | 0.98 | 142.2 | 5 | 0.9440 | no / no | 0.47 [0.47, 0.49] | 190 | 1171 |
| faiss_ivfpq_fs | 0.99 | 142.2 | 5 | 0.9440 | no / no |  | 190 | 1171 |
| faiss_ivfpq_fs | 0.995 | 250.7 | 5 | 0.9775 | no / no |  | 190 | 1174 |
| faiss_rabitq_flat | 0.98 | 918.1 | 5 | 0.9984 | yes / yes | 3.03 [3.01, 3.18] | 186 | 1151 |
| faiss_rabitq_flat | 0.99 | 918.1 | 5 | 0.9984 | yes / yes |  | 186 | 1151 |
| faiss_rabitq_flat | 0.995 | 918.1 | 5 | 0.9984 | yes / no |  | 186 | 1151 |
| faiss_rabitq_hnsw | 0.98 | 188.2 | 5 | 0.9741 | no / no | 0.62 [0.62, 0.65] | 216 | 1258 |
| faiss_rabitq_hnsw | 0.99 | 330.4 | 5 | 0.9676 | no / no |  | 202 | 1212 |
| faiss_rabitq_hnsw | 0.995 | 330.4 | 5 | 0.9676 | no / no |  | 202 | 1212 |
| faiss_rabitq_ivf | 0.98 | 358.9 | 5 | 0.9401 | no / no | 1.19 [1.18, 1.24] | 188 | 1175 |
| faiss_rabitq_ivf | 0.99 | 654.2 | 5 | 0.9737 | no / no |  | 188 | 1175 |
| faiss_rabitq_ivf | 0.995 | 1222.8 | 5 | 1.0000 | yes / yes |  | 188 | 1170 |
| hnswlib_f32 | 0.98 | 2239.2 | 5 | 0.9988 | yes / yes | 7.40 [7.32, 7.77] | 196 | 519 |
| hnswlib_f32 | 0.99 | 2239.2 | 5 | 0.9988 | yes / yes |  | 196 | 519 |
| hnswlib_f32 | 0.995 | 2239.2 | 5 | 0.9988 | yes / yes |  | 196 | 519 |
| ours_cascade | 0.98 | 302.5 | 5 | 0.9888 | yes / no |  | 225 | 777 |
| scann | 0.98 | 1144.6 | 5 | 1.0000 | yes / yes | 3.78 [3.49, 3.97] | 245 | 774 |
| scann | 0.99 | 1144.6 | 5 | 1.0000 | yes / yes |  | 245 | 774 |
| scann | 0.995 | 1144.6 | 5 | 1.0000 | yes / yes |  | 245 | 774 |
| svs_vamana_leanvec | 0.98 | 1068.0 | 5 | 0.9950 | yes / no | 3.53 [3.50, 3.70] | 92 | 368 |
| svs_vamana_leanvec | 0.99 | 1068.0 | 5 | 0.9950 | yes / no |  | 92 | 368 |
| svs_vamana_leanvec | 0.995 | 1068.0 | 5 | 0.9950 | yes / no |  | 92 | 368 |
| svs_vamana_lvq | 0.98 | 490.4 | 5 | 0.9879 | yes / no | 1.62 [1.61, 1.70] | 97 | 382 |
| svs_vamana_lvq | 0.99 | 490.4 | 5 | 0.9879 | no / no |  | 97 | 382 |
| svs_vamana_lvq | 0.995 | 490.4 | 5 | 0.9879 | no / no |  | 97 | 382 |
| usearch_f16 | 0.98 | 1120.1 | 5 | 0.9848 | yes / no | 3.70 [3.67, 3.88] | 117 | 476 |
| usearch_f16 | 0.99 | 1120.1 | 5 | 0.9848 | no / no |  | 117 | 476 |
| usearch_f16 | 0.995 | 1120.1 | 5 | 0.9848 | no / no |  | 117 | 476 |
| usearch_i8 | 0.98 | 978.9 | 5 | 1.0021 | yes / yes | 3.24 [3.21, 3.39] | 90 | 338 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 823.7 / 0.9621 | 886.0 / 0.9658 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 4353.2 / 0.9963 | 4428.6 / 0.9962 | 5561.4 / 1.0000 |
| diskann_vamana | L 200 | 1289.7 / 0.9741 | 1353.4 / 0.9778 | 1316.4 / 0.9741 | 1385.9 / 0.9778 | 1497.9 / 0.9778 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 6945.1 / 0.9963 | 6998.4 / 0.9962 | 8104.6 / 1.0000 |
| diskann_vamana | L 400 |  |  | 2122.8 / 0.9968 | 2195.5 / 1.0006 | 2331.5 / 1.0006 | 2175.3 / 0.9968 | 2251.2 / 0.9968 | 2635.5 / 1.0006 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 3580.6 / 0.9963 | 3653.9 / 0.9962 | 4035.6 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 248.6 / 0.9321 | 300.8 / 0.9321 | 303.8 / 0.9663 | 357.6 / 0.9701 | 451.8 / 0.9701 | 417.9 / 0.9794 | 470.6 / 0.9819 | 753.8 / 0.9819 | 723.9 / 0.9888 | 777.1 / 0.9878 | 1658.1 / 0.9916 |
| faiss_bin_hnsw | ef 100 | 214.6 / 0.9337 | 267.8 / 0.9337 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1478.7 / 0.9780 | 1556.4 / 0.9769 | 2427.9 / 0.9807 |
| faiss_bin_hnsw | ef 200 | 302.3 / 0.9694 | 356.5 / 0.9694 | 350.2 / 0.9614 | 410.7 / 0.9651 | 509.4 / 0.9651 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2477.3 / 0.9888 | 2551.3 / 0.9878 | 3470.0 / 0.9916 |
| faiss_bin_hnsw | ef 400 |  |  | 543.5 / 0.9753 | 594.8 / 0.9791 | 707.9 / 0.9791 | 635.8 / 0.9751 | 692.2 / 0.9777 | 994.4 / 0.9777 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1028.9 / 0.9719 | 1075.8 / 0.9745 | 1387.4 / 0.9745 |  |  |  |
| faiss_hnsw_flat | ef 100 | 530.6 / 0.9470 | 567.0 / 0.9507 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3441.5 / 0.9963 | 3505.2 / 0.9962 | 4631.8 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 865.2 / 0.9585 | 928.7 / 0.9623 | 914.1 / 0.9585 | 969.8 / 0.9623 | 1055.2 / 0.9623 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 5730.1 / 0.9963 | 5802.5 / 0.9962 | 6921.0 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1511.6 / 0.9907 | 1573.7 / 0.9945 | 1686.8 / 0.9945 | 1597.9 / 0.9907 | 1666.5 / 0.9906 | 2053.3 / 0.9945 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2657.3 / 0.9963 | 2718.3 / 0.9962 | 3115.9 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1027.8 / 0.9962 | 1110.5 / 1.0000 | 1139.7 / 0.9963 | 1168.1 / 1.0000 | 1263.5 / 1.0000 | 1154.9 / 0.9963 | 1211.6 / 1.0000 | 1497.4 / 1.0000 | 1270.3 / 0.9963 | 1333.0 / 0.9962 | 2213.4 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 251.9 / 0.7869 | 304.9 / 0.7869 | 585.7 / 0.7869 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 440.7 / 0.8328 | 479.7 / 0.8368 | 1362.4 / 0.8368 |
| faiss_rabitq_ivf | nprobe 2 | 110.2 / 0.5123 | 161.3 / 0.5099 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 528.2 / 0.8652 | 576.7 / 0.8691 | 1451.4 / 0.8691 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 143.6 / 0.5948 | 193.6 / 0.5940 | 281.8 / 0.5940 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 117.2 / 0.6368 | 168.9 / 0.6368 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 203.8 / 0.6907 | 255.8 / 0.6907 | 545.3 / 0.6907 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 157.7 / 0.7007 | 209.5 / 0.7007 | 301.1 / 0.7007 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 524.0 / 0.9367 | 559.5 / 0.9391 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 3325.5 / 0.9963 | 3389.5 / 0.9962 | 4521.4 / 1.0000 |
| hnswlib_f32 | ef 200 | 870.1 / 0.9739 | 936.7 / 0.9776 | 899.4 / 0.9739 | 954.7 / 0.9776 | 1034.1 / 0.9776 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 5351.5 / 0.9963 | 5419.8 / 0.9962 | 6573.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1513.6 / 0.9964 | 1570.1 / 1.0002 | 1692.6 / 1.0002 | 1566.5 / 0.9964 | 1639.7 / 0.9964 | 2027.9 / 1.0002 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2623.6 / 0.9963 | 2680.7 / 0.9962 | 3109.5 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 207.9 / 0.9500 | 230.1 / 0.9500 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 283.3 / 0.9888 | 303.1 / 0.9878 | 741.8 / 0.9916 |
| ours_scan | ef 200 |  |  | 218.5 / 0.9698 | 240.6 / 0.9736 | 283.8 / 0.9736 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 235.9 / 0.9890 | 259.0 / 0.9915 | 386.2 / 0.9915 |  |  |  |
| ours_walk | ef 100 | 106.5 / 0.9421 | 128.3 / 0.9407 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 315.4 / 0.9890 | 338.3 / 0.9879 | 781.5 / 0.9917 |
| ours_walk | ef 200 | 129.3 / 0.9620 | 151.0 / 0.9606 | 137.2 / 0.9746 | 160.5 / 0.9784 | 208.3 / 0.9784 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 395.0 / 0.9890 | 416.9 / 0.9879 | 867.3 / 0.9917 |
| ours_walk | ef 400 |  |  | 178.4 / 0.9685 | 201.9 / 0.9723 | 250.5 / 0.9723 | 195.9 / 0.9850 | 218.0 / 0.9875 | 362.2 / 0.9875 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 249.2 / 0.9819 | 273.1 / 0.9857 | 412.4 / 0.9857 |  |  |  |
| scann | reorder 100 | 1242.1 / 0.9963 | 1252.0 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1711.3 / 0.9963 | 1769.9 / 0.9962 | 2517.9 / 1.0000 |
| scann | reorder 200 |  |  | 1294.2 / 0.9963 | 1347.0 / 1.0000 | 1381.6 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 1387.5 / 0.9963 | 1439.0 / 0.9962 | 1616.9 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 187.6 / 0.9259 | 241.0 / 0.9259 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1138.2 / 0.9877 | 1206.1 / 0.9875 | 2089.9 / 0.9914 |
| usearch_b1_rescore | ef 200 | 294.4 / 0.9581 | 351.9 / 0.9581 | 312.1 / 0.9541 | 368.2 / 0.9567 | 472.6 / 0.9567 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2005.2 / 0.9890 | 2054.3 / 0.9879 | 2959.8 / 0.9917 |
| usearch_b1_rescore | ef 400 |  |  | 504.4 / 0.9766 | 566.8 / 0.9804 | 681.9 / 0.9804 | 539.1 / 0.9876 | 601.3 / 0.9901 | 911.4 / 0.9901 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 887.5 / 0.9890 | 949.9 / 0.9916 | 1268.7 / 0.9916 |  |  |  |

### fiqa / bge-base-en-v1.5 (n_ho = 259, exact quality 0.4175)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 711.5 | 5 | 0.9912 | yes / no | 2.93 [2.85, 2.96] | 209 | 891 |
| diskann_vamana | 0.99 | 1005.8 | 5 | 1.0000 | yes / yes | 3.76 [3.74, 3.91] | 216 | 918 |
| diskann_vamana | 0.995 | 1005.8 | 5 | 1.0000 | yes / yes |  | 216 | 918 |
| faiss_exact | 0.98 | 7513.8 | 5 | 1.0000 | yes / yes | 30.94 [30.13, 31.18] | 181 | 562 |
| faiss_exact | 0.99 | 7513.8 | 5 | 1.0000 | yes / yes | 28.10 [27.91, 29.17] | 181 | 562 |
| faiss_exact | 0.995 | 7513.8 | 5 | 1.0000 | yes / yes |  | 181 | 562 |
| faiss_hnsw_flat | 0.98 | 429.2 | 5 | 1.0001 | yes / yes | 1.77 [1.72, 1.78] | 196 | 591 |
| faiss_hnsw_flat | 0.99 | 429.2 | 5 | 1.0001 | yes / yes | 1.60 [1.59, 1.67] | 196 | 591 |
| faiss_hnsw_flat | 0.995 | 429.2 | 5 | 1.0001 | yes / yes |  | 196 | 591 |
| faiss_hnsw_sq8 | 0.98 | 343.5 | 5 | 0.9961 | yes / yes | 1.41 [1.38, 1.43] | 232 | 1283 |
| faiss_hnsw_sq8 | 0.99 | 680.9 | 5 | 0.9726 | no / no | 2.55 [2.51, 2.64] | 253 | 1367 |
| faiss_hnsw_sq8 | 0.995 | 1034.8 | 5 | 1.0000 | yes / yes |  | 232 | 1286 |
| faiss_ivfpq_fs | 0.98 | 224.2 | 5 | 0.9935 | yes / yes | 0.92 [0.90, 0.93] | 195 | 1166 |
| faiss_ivfpq_fs | 0.99 | 255.3 | 5 | 0.9991 | yes / yes | 0.95 [0.91, 0.99] | 190 | 1149 |
| faiss_ivfpq_fs | 0.995 | 296.9 | 5 | 1.0000 | yes / yes |  | 190 | 1147 |
| faiss_rabitq_flat | 0.98 | 917.0 | 5 | 0.9974 | yes / yes | 3.78 [3.68, 3.81] | 187 | 1134 |
| faiss_rabitq_flat | 0.99 | 917.0 | 5 | 0.9974 | yes / yes | 3.43 [3.41, 3.56] | 187 | 1134 |
| faiss_rabitq_flat | 0.995 | 917.0 | 5 | 0.9974 | yes / no |  | 187 | 1134 |
| faiss_rabitq_hnsw | 0.98 | 380.4 | 5 | 1.0007 | yes / yes | 1.57 [1.53, 1.59] | 196 | 1175 |
| faiss_rabitq_hnsw | 0.99 | 485.3 | 5 | 1.0039 | yes / yes | 1.81 [1.81, 1.88] | 202 | 1201 |
| faiss_rabitq_hnsw | 0.995 | 651.6 | 5 | 1.0001 | yes / yes |  | 216 | 1244 |
| faiss_rabitq_ivf | 0.98 | 331.3 | 5 | 0.9946 | yes / yes | 1.36 [1.33, 1.38] | 191 | 1159 |
| faiss_rabitq_ivf | 0.99 | 331.3 | 5 | 0.9946 | yes / no | 1.24 [1.23, 1.29] | 191 | 1159 |
| faiss_rabitq_ivf | 0.995 | 543.5 | 5 | 1.0003 | yes / yes |  | 191 | 1160 |
| hnswlib_f32 | 0.98 | 170.0 | 5 | 0.9879 | yes / no | 0.70 [0.68, 0.71] | 196 | 511 |
| hnswlib_f32 | 0.99 | 301.1 | 5 | 0.9902 | yes / no | 1.13 [1.11, 1.17] | 196 | 512 |
| hnswlib_f32 | 0.995 | 955.4 | 5 | 1.0000 | yes / yes |  | 196 | 504 |
| ours_cascade | 0.98 | 242.8 | 5 | 0.9935 | yes / no |  | 226 | 329 |
| ours_cascade | 0.99 | 267.4 | 5 | 0.9959 | yes / no |  | 226 | 516 |
| scann | 0.98 | 1051.9 | 5 | 1.0000 | yes / yes | 4.33 [4.10, 4.58] | 245 | 796 |
| scann | 0.99 | 1051.9 | 5 | 1.0000 | yes / yes | 3.93 [3.76, 4.16] | 245 | 796 |
| scann | 0.995 | 1051.9 | 5 | 1.0000 | yes / yes |  | 245 | 796 |
| svs_vamana_leanvec | 0.98 | 234.1 | 5 | 0.9994 | yes / yes | 0.96 [0.94, 0.97] | 92 | 366 |
| svs_vamana_leanvec | 0.99 | 234.1 | 5 | 0.9994 | yes / yes | 0.88 [0.87, 0.91] | 92 | 366 |
| svs_vamana_leanvec | 0.995 | 234.1 | 5 | 0.9994 | yes / no |  | 92 | 366 |
| svs_vamana_lvq | 0.98 | 532.0 | 5 | 1.0018 | yes / yes | 2.19 [2.13, 2.21] | 97 | 378 |
| svs_vamana_lvq | 0.99 | 532.0 | 5 | 1.0018 | yes / yes | 1.99 [1.95, 2.07] | 97 | 378 |
| svs_vamana_lvq | 0.995 | 888.1 | 5 | 1.0018 | yes / yes |  | 104 | 410 |
| usearch_f16 | 0.98 | 548.4 | 5 | 0.9896 | yes / no | 2.26 [2.20, 2.28] | 118 | 475 |
| usearch_f16 | 0.99 | 548.4 | 5 | 0.9896 | no / no | 2.05 [2.04, 2.13] | 118 | 475 |
| usearch_f16 | 0.995 | 936.8 | 5 | 0.9895 | no / no |  | 117 | 476 |
| usearch_i8 | 0.98 | 404.1 | 5 | 0.9973 | yes / no | 1.66 [1.62, 1.69] | 75 | 278 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 644.4 / 0.9978 | 707.5 / 0.9978 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2963.7 / 1.0000 | 3039.3 / 1.0000 | 4176.7 / 1.0000 |
| diskann_vamana | L 200 | 963.6 / 1.0000 | 1029.4 / 1.0000 | 987.8 / 1.0000 | 1054.0 / 1.0000 | 1149.2 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 4705.7 / 1.0000 | 4788.7 / 1.0000 | 5906.1 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1492.9 / 1.0000 | 1563.6 / 1.0000 | 1678.7 / 1.0000 | 1550.4 / 1.0000 | 1615.3 / 1.0000 | 1994.4 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2412.8 / 1.0000 | 2480.1 / 1.0000 | 2864.7 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 248.1 / 0.9852 | 300.6 / 0.9852 | 303.5 / 0.9877 | 355.9 / 0.9877 | 448.2 / 0.9877 | 412.1 / 0.9969 | 468.5 / 0.9969 | 744.9 / 0.9969 | 722.1 / 0.9986 | 776.8 / 0.9986 | 1652.0 / 0.9986 |
| faiss_bin_hnsw | ef 100 | 202.0 / 0.9646 | 255.2 / 0.9646 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1286.4 / 0.9986 | 1343.5 / 0.9959 | 2221.1 / 0.9959 |
| faiss_bin_hnsw | ef 200 | 279.9 / 0.9643 | 333.7 / 0.9643 | 322.2 / 0.9719 | 380.9 / 0.9719 | 480.0 / 0.9719 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2190.5 / 0.9986 | 2261.9 / 0.9959 | 3152.9 / 0.9959 |
| faiss_bin_hnsw | ef 400 |  |  | 484.8 / 0.9790 | 537.0 / 0.9790 | 648.5 / 0.9790 | 569.1 / 0.9876 | 626.0 / 0.9876 | 926.1 / 0.9876 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 897.6 / 0.9969 | 952.1 / 0.9969 | 1262.6 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 461.3 / 1.0001 | 505.8 / 1.0001 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2719.2 / 1.0000 | 2788.3 / 1.0000 | 3932.1 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 731.6 / 1.0000 | 792.9 / 1.0000 | 771.9 / 1.0000 | 833.3 / 1.0000 | 933.8 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 4521.4 / 1.0000 | 4584.6 / 1.0000 | 5741.0 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1226.8 / 1.0000 | 1291.9 / 1.0000 | 1393.4 / 1.0000 | 1304.2 / 1.0000 | 1376.2 / 1.0000 | 1755.5 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2099.7 / 1.0000 | 2157.6 / 1.0000 | 2549.9 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1058.4 / 1.0001 | 1124.6 / 1.0001 | 1111.8 / 1.0000 | 1188.9 / 1.0000 | 1252.4 / 1.0000 | 1175.6 / 1.0000 | 1218.1 / 1.0000 | 1499.9 / 1.0000 | 1282.9 / 1.0000 | 1347.0 / 1.0000 | 2210.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 256.2 / 0.9588 | 308.5 / 0.9588 | 588.4 / 0.9588 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 447.9 / 0.9597 | 487.4 / 0.9597 | 1371.3 / 0.9597 |
| faiss_rabitq_ivf | nprobe 2 | 112.0 / 0.7265 | 161.1 / 0.7265 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 532.1 / 0.9816 | 586.3 / 0.9816 | 1459.4 / 0.9816 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 145.0 / 0.8174 | 194.5 / 0.8174 | 283.4 / 0.8174 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 117.4 / 0.8622 | 169.7 / 0.8622 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 207.2 / 0.8618 | 260.2 / 0.8618 | 548.2 / 0.8618 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 160.5 / 0.8850 | 211.5 / 0.8850 | 304.5 / 0.8850 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 448.1 / 0.9885 | 495.0 / 0.9885 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2566.5 / 1.0000 | 2623.1 / 1.0000 | 3740.3 / 1.0000 |
| hnswlib_f32 | ef 200 | 724.0 / 1.0000 | 781.0 / 1.0000 | 748.8 / 1.0000 | 809.7 / 1.0000 | 903.5 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 4078.9 / 1.0000 | 4102.8 / 1.0000 | 5254.6 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1197.6 / 1.0000 | 1273.7 / 1.0000 | 1381.6 / 1.0000 | 1260.7 / 1.0000 | 1331.8 / 1.0000 | 1700.0 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2025.2 / 1.0000 | 2095.7 / 1.0000 | 2467.6 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 207.6 / 0.9873 | 229.0 / 0.9873 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 282.8 / 0.9959 | 306.5 / 0.9959 | 740.5 / 0.9959 |
| ours_scan | ef 200 |  |  | 217.6 / 0.9874 | 239.6 / 0.9874 | 284.2 / 0.9874 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 236.4 / 0.9967 | 258.0 / 0.9967 | 383.8 / 0.9967 |  |  |  |
| ours_walk | ef 100 | 92.1 / 0.9774 | 113.7 / 0.9774 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 260.2 / 0.9959 | 282.2 / 0.9959 | 726.6 / 0.9959 |
| ours_walk | ef 200 | 107.4 / 0.9773 | 128.8 / 0.9773 | 117.6 / 0.9814 | 139.1 / 0.9814 | 185.2 / 0.9814 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 326.5 / 0.9986 | 350.3 / 0.9959 | 793.3 / 0.9959 |
| ours_walk | ef 400 |  |  | 141.3 / 0.9913 | 162.1 / 0.9913 | 212.1 / 0.9913 | 157.1 / 0.9994 | 180.2 / 0.9994 | 325.5 / 0.9994 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 196.9 / 0.9995 | 221.1 / 0.9995 | 362.1 / 0.9995 |  |  |  |
| scann | reorder 100 | 1243.7 / 1.0000 | 1247.9 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1727.8 / 1.0000 | 1805.2 / 1.0000 | 2526.3 / 1.0000 |
| scann | reorder 200 |  |  | 1298.2 / 1.0000 | 1327.9 / 1.0000 | 1424.8 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 1399.2 / 1.0000 | 1437.4 / 1.0000 | 1722.4 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 178.5 / 0.9720 | 230.2 / 0.9720 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 991.9 / 0.9986 | 1054.5 / 0.9986 | 1935.6 / 0.9986 |
| usearch_b1_rescore | ef 200 | 261.2 / 0.9782 | 317.1 / 0.9782 | 278.8 / 0.9823 | 330.9 / 0.9823 | 433.2 / 0.9823 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1711.1 / 0.9986 | 1757.4 / 0.9986 | 2664.0 / 0.9986 |
| usearch_b1_rescore | ef 400 |  |  | 433.4 / 0.9890 | 493.3 / 0.9890 | 602.3 / 0.9890 | 467.3 / 0.9967 | 527.7 / 0.9967 | 828.9 / 0.9967 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 774.7 / 0.9950 | 828.4 / 0.9950 | 1138.7 / 0.9950 |  |  |  |

### fiqa / jina-v2-base-code (n_ho = 259, exact quality 0.1254)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 316.3 | 5 | 0.9018 | no / no | 1.06 [1.03, 1.08] | 209 | 847 |
| diskann_vamana | 0.99 | 439.7 | 5 | 0.9390 | no / no | 1.47 [1.43, 1.49] | 216 | 906 |
| diskann_vamana | 0.995 | 439.7 | 5 | 0.9390 | no / no | 1.47 [1.43, 1.49] | 216 | 906 |
| faiss_exact | 0.98 | 7564.2 | 5 | 1.0000 | yes / yes | 25.34 [24.28, 26.56] | 181 | 548 |
| faiss_exact | 0.99 | 7564.2 | 5 | 1.0000 | yes / yes | 25.34 [24.28, 26.56] | 181 | 548 |
| faiss_exact | 0.995 | 7564.2 | 5 | 1.0000 | yes / yes | 25.34 [24.28, 26.56] | 181 | 548 |
| faiss_hnsw_flat | 0.98 | 256.6 | 5 | 0.9553 | no / no | 0.86 [0.83, 0.88] | 196 | 594 |
| faiss_hnsw_flat | 0.99 | 334.5 | 5 | 0.9822 | no / no | 1.12 [1.08, 1.14] | 189 | 563 |
| faiss_hnsw_flat | 0.995 | 334.5 | 5 | 0.9822 | no / no | 1.12 [1.08, 1.14] | 189 | 563 |
| faiss_hnsw_sq8 | 0.98 | 351.7 | 5 | 0.9877 | yes / no | 1.18 [1.10, 1.19] | 232 | 1297 |
| faiss_hnsw_sq8 | 0.99 | 351.7 | 5 | 0.9877 | no / no | 1.18 [1.10, 1.19] | 232 | 1297 |
| faiss_hnsw_sq8 | 0.995 | 351.7 | 5 | 0.9877 | no / no | 1.18 [1.10, 1.19] | 232 | 1297 |
| faiss_rabitq_flat | 0.98 | 916.8 | 5 | 1.0000 | yes / yes | 3.07 [2.97, 3.08] | 187 | 1157 |
| faiss_rabitq_flat | 0.99 | 916.8 | 5 | 1.0000 | yes / yes | 3.07 [2.97, 3.08] | 187 | 1157 |
| faiss_rabitq_flat | 0.995 | 916.8 | 5 | 1.0000 | yes / yes | 3.07 [2.97, 3.08] | 187 | 1157 |
| faiss_rabitq_hnsw | 0.98 | 163.3 | 5 | 0.8741 | no / no | 0.55 [0.53, 0.55] | 217 | 1266 |
| faiss_rabitq_hnsw | 0.99 | 417.2 | 5 | 0.9559 | no / no | 1.40 [1.35, 1.43] | 217 | 1272 |
| faiss_rabitq_hnsw | 0.995 | 417.2 | 5 | 0.9559 | no / no | 1.40 [1.35, 1.43] | 217 | 1272 |
| faiss_rabitq_ivf | 0.98 | 397.0 | 5 | 0.9305 | no / no | 1.33 [1.29, 1.36] | 190 | 1182 |
| faiss_rabitq_ivf | 0.99 | 655.8 | 5 | 0.9633 | no / no | 2.20 [2.10, 2.21] | 188 | 1164 |
| faiss_rabitq_ivf | 0.995 | 655.8 | 5 | 0.9633 | no / no | 2.20 [2.10, 2.21] | 188 | 1164 |
| hnswlib_f32 | 0.98 | 163.3 | 5 | 0.9298 | no / no | 0.55 [0.53, 0.55] | 196 | 508 |
| hnswlib_f32 | 0.99 | 177.4 | 5 | 0.9275 | no / no | 0.59 [0.58, 0.60] | 196 | 507 |
| hnswlib_f32 | 0.995 | 177.4 | 5 | 0.9275 | no / no | 0.59 [0.58, 0.60] | 196 | 507 |
| ours_cascade | 0.98 | 298.5 | 5 | 1.0008 | yes / yes |  | 226 | 749 |
| ours_cascade | 0.99 | 298.5 | 5 | 1.0008 | yes / yes |  | 226 | 749 |
| ours_cascade | 0.995 | 298.5 | 5 | 1.0008 | yes / yes |  | 226 | 749 |
| scann | 0.98 | 1033.6 | 5 | 1.0000 | yes / yes | 3.46 [3.30, 3.73] | 245 | 780 |
| scann | 0.99 | 1033.6 | 5 | 1.0000 | yes / yes | 3.46 [3.30, 3.73] | 245 | 780 |
| scann | 0.995 | 1033.6 | 5 | 1.0000 | yes / yes | 3.46 [3.30, 3.73] | 245 | 780 |
| svs_vamana_leanvec | 0.98 | 198.6 | 5 | 0.9717 | no / no | 0.67 [0.65, 0.67] | 92 | 365 |
| svs_vamana_lvq | 0.98 | 100.2 | 5 | 0.9698 | no / no | 0.34 [0.33, 0.34] | 104 | 411 |
| svs_vamana_lvq | 0.99 | 100.2 | 5 | 0.9698 | no / no | 0.34 [0.33, 0.34] | 104 | 411 |
| svs_vamana_lvq | 0.995 | 100.2 | 5 | 0.9698 | no / no | 0.34 [0.33, 0.34] | 104 | 411 |
| usearch_f16 | 0.98 | 294.3 | 5 | 0.9021 | no / no | 0.99 [0.96, 0.99] | 132 | 534 |
| usearch_f16 | 0.99 | 294.3 | 5 | 0.9021 | no / no | 0.99 [0.96, 0.99] | 132 | 534 |
| usearch_f16 | 0.995 | 294.3 | 5 | 0.9021 | no / no | 0.99 [0.96, 0.99] | 132 | 534 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 685.7 / 0.9701 | 744.0 / 0.9698 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 3163.8 / 1.0008 | 3231.1 / 1.0000 | 4345.6 / 1.0000 |
| diskann_vamana | L 200 | 1035.3 / 1.0004 | 1106.2 / 1.0000 | 1066.5 / 1.0008 | 1128.0 / 1.0000 | 1238.2 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 4775.9 / 1.0008 | 4862.3 / 1.0000 | 5985.4 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1648.1 / 1.0008 | 1719.1 / 1.0000 | 1841.7 / 1.0000 | 1699.2 / 1.0008 | 1769.5 / 1.0000 | 2145.4 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2628.5 / 1.0008 | 2686.5 / 1.0000 | 3079.2 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 247.2 / 0.9879 | 300.0 / 0.9879 | 304.3 / 1.0013 | 356.6 / 1.0013 | 456.1 / 1.0013 | 416.5 / 1.0008 | 472.3 / 1.0004 | 755.5 / 1.0004 | 725.2 / 1.0008 | 777.4 / 1.0000 | 1659.7 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 192.8 / 0.9181 | 239.5 / 0.9181 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1198.0 / 1.0008 | 1253.7 / 1.0000 | 2132.0 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 263.9 / 0.9800 | 320.4 / 0.9800 | 304.2 / 0.9933 | 366.9 / 0.9933 | 458.7 / 0.9933 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2052.8 / 1.0008 | 2124.3 / 1.0000 | 3018.3 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 454.4 / 1.0073 | 505.7 / 1.0073 | 620.2 / 1.0073 | 533.4 / 1.0008 | 585.3 / 1.0004 | 891.0 / 1.0004 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 837.2 / 1.0008 | 886.5 / 1.0004 | 1209.1 / 1.0004 |  |  |  |
| faiss_hnsw_flat | ef 100 | 477.0 / 0.9592 | 516.5 / 0.9588 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2808.7 / 0.9700 | 2865.0 / 0.9692 | 3996.4 / 0.9692 |
| faiss_hnsw_flat | ef 200 | 771.0 / 0.9592 | 826.1 / 0.9588 | 808.3 / 0.9596 | 866.7 / 0.9588 | 963.4 / 0.9588 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 4512.4 / 1.0008 | 4605.4 / 1.0000 | 5711.1 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1291.3 / 0.9706 | 1356.6 / 0.9698 | 1453.0 / 0.9698 | 1374.8 / 0.9706 | 1437.2 / 0.9698 | 1818.2 / 0.9698 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2193.2 / 0.9700 | 2253.9 / 0.9692 | 2642.1 / 0.9692 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1061.9 / 1.0004 | 1104.6 / 1.0000 | 1124.1 / 1.0008 | 1175.2 / 1.0000 | 1274.6 / 1.0000 | 1159.7 / 1.0008 | 1224.0 / 1.0000 | 1499.2 / 1.0000 | 1272.9 / 1.0008 | 1338.1 / 1.0000 | 2199.6 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 252.3 / 0.7087 | 304.1 / 0.7087 | 584.4 / 0.7087 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 439.9 / 0.7539 | 479.9 / 0.7539 | 1360.4 / 0.7539 |
| faiss_rabitq_ivf | nprobe 2 | 110.2 / 0.4532 | 159.3 / 0.4532 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 524.3 / 0.8462 | 572.3 / 0.8457 | 1447.1 / 0.8457 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 143.3 / 0.5887 | 193.4 / 0.5887 | 281.6 / 0.5887 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 117.8 / 0.6217 | 167.8 / 0.6217 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 204.4 / 0.6363 | 256.3 / 0.6363 | 545.8 / 0.6363 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 158.6 / 0.6668 | 209.5 / 0.6668 | 302.4 / 0.6668 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 460.5 / 0.9557 | 508.9 / 0.9553 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2649.7 / 1.0008 | 2715.3 / 1.0000 | 3831.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 752.7 / 1.0009 | 816.1 / 1.0005 | 785.6 / 1.0014 | 849.0 / 1.0005 | 939.7 / 1.0005 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 4070.1 / 1.0008 | 4141.5 / 1.0000 | 5275.5 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1270.1 / 1.0014 | 1331.4 / 1.0005 | 1450.5 / 1.0005 | 1317.9 / 1.0014 | 1388.9 / 1.0005 | 1755.0 / 1.0005 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2108.3 / 1.0008 | 2203.4 / 1.0000 | 2571.6 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 208.7 / 0.9879 | 229.4 / 0.9879 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 284.4 / 1.0008 | 305.2 / 1.0000 | 744.6 / 1.0000 |
| ours_scan | ef 200 |  |  | 218.6 / 1.0073 | 240.5 / 1.0073 | 282.2 / 1.0073 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 235.7 / 1.0008 | 259.0 / 1.0004 | 385.0 / 1.0004 |  |  |  |
| ours_walk | ef 100 | 86.1 / 0.9631 | 104.7 / 0.9631 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 234.2 / 1.0008 | 255.7 / 1.0000 | 704.1 / 1.0000 |
| ours_walk | ef 200 | 99.5 / 0.9631 | 119.6 / 0.9631 | 107.3 / 0.9765 | 128.5 / 0.9765 | 173.3 / 0.9765 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 305.0 / 1.0008 | 329.3 / 1.0000 | 771.6 / 1.0000 |
| ours_walk | ef 400 |  |  | 125.2 / 0.9765 | 148.4 / 0.9765 | 194.1 / 0.9765 | 141.7 / 0.9700 | 165.7 / 0.9696 | 309.3 / 0.9696 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 171.7 / 1.0008 | 192.7 / 1.0004 | 339.6 / 1.0004 |  |  |  |
| scann | reorder 100 | 1174.8 / 1.0004 | 1223.9 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1663.4 / 1.0008 | 1655.5 / 1.0000 | 2507.5 / 1.0000 |
| scann | reorder 200 |  |  | 1316.3 / 1.0004 | 1287.6 / 1.0000 | 1333.9 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 1435.9 / 1.0008 | 1452.3 / 1.0000 | 1625.8 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 171.5 / 0.9250 | 218.0 / 0.9250 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 930.8 / 1.0008 | 991.7 / 1.0000 | 1874.6 / 1.0000 |
| usearch_b1_rescore | ef 200 | 246.1 / 0.9579 | 300.3 / 0.9579 | 261.7 / 0.9765 | 315.9 / 0.9765 | 415.0 / 0.9765 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1575.4 / 1.0008 | 1636.1 / 1.0000 | 2518.7 / 1.0000 |
| usearch_b1_rescore | ef 400 |  |  | 407.0 / 1.0127 | 461.5 / 1.0127 | 572.6 / 1.0127 | 437.8 / 1.0008 | 495.9 / 1.0004 | 794.3 / 1.0004 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 732.8 / 1.0008 | 796.3 / 1.0004 | 1107.8 / 1.0004 |  |  |  |

### gcsn / CodeRankEmbed (n_ho = 2400, exact quality 0.8412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 260.7 | 5 | 0.9990 | yes / yes | 3.75 [3.51, 3.90] | 66 | 140 |
| diskann_vamana | 0.99 | 260.7 | 5 | 0.9990 | yes / yes | 3.75 [3.51, 3.90] | 66 | 140 |
| diskann_vamana | 0.995 | 265.9 | 5 | 0.9994 | yes / yes | 2.87 [2.77, 2.97] | 66 | 146 |
| faiss_bin_flat | 0.98 | 36.9 | 5 | 0.9897 | yes / yes | 0.53 [0.50, 0.55] | 80 | 139 |
| faiss_bin_flat | 0.99 | 36.9 | 5 | 0.9897 | no / no | 0.53 [0.50, 0.55] | 80 | 139 |
| faiss_bin_flat | 0.995 | 55.8 | 5 | 0.9959 | yes / no | 0.60 [0.58, 0.63] | 80 | 143 |
| faiss_bin_hnsw | 0.98 | 134.1 | 5 | 0.9889 | yes / yes | 1.93 [1.81, 2.01] | 80 | 147 |
| faiss_bin_hnsw | 0.99 | 152.5 | 5 | 0.9923 | yes / no | 2.20 [2.05, 2.28] | 80 | 150 |
| faiss_bin_hnsw | 0.995 | 174.9 | 5 | 0.9956 | yes / no | 1.89 [1.83, 1.96] | 80 | 157 |
| faiss_exact | 0.98 | 729.8 | 5 | 1.0000 | yes / yes | 10.50 [9.82, 10.92] | 49 | 83 |
| faiss_exact | 0.99 | 729.8 | 5 | 1.0000 | yes / yes | 10.50 [9.82, 10.92] | 49 | 83 |
| faiss_exact | 0.995 | 729.8 | 5 | 1.0000 | yes / yes | 7.87 [7.62, 8.16] | 49 | 83 |
| faiss_hnsw_flat | 0.98 | 157.1 | 5 | 0.9976 | yes / yes | 2.26 [2.11, 2.35] | 50 | 85 |
| faiss_hnsw_flat | 0.99 | 157.1 | 5 | 0.9976 | yes / yes | 2.26 [2.11, 2.35] | 50 | 85 |
| faiss_hnsw_flat | 0.995 | 216.4 | 5 | 0.9969 | yes / no | 2.33 [2.26, 2.42] | 53 | 96 |
| faiss_hnsw_sq8 | 0.98 | 118.0 | 5 | 0.9914 | yes / yes | 1.70 [1.59, 1.77] | 81 | 168 |
| faiss_hnsw_sq8 | 0.99 | 154.6 | 5 | 0.9956 | yes / yes | 2.22 [2.08, 2.35] | 81 | 166 |
| faiss_hnsw_sq8 | 0.995 | 227.6 | 5 | 0.9963 | yes / no | 2.45 [2.38, 2.59] | 81 | 173 |
| faiss_ivfpq_fs | 0.98 | 111.5 | 5 | 1.0000 | yes / yes | 1.60 [1.50, 1.67] | 81 | 161 |
| faiss_ivfpq_fs | 0.99 | 111.5 | 5 | 1.0000 | yes / yes | 1.60 [1.50, 1.67] | 81 | 161 |
| faiss_ivfpq_fs | 0.995 | 111.5 | 5 | 1.0000 | yes / yes | 1.20 [1.16, 1.25] | 81 | 161 |
| faiss_rabitq_flat | 0.98 | 119.1 | 5 | 0.9999 | yes / yes | 1.71 [1.60, 1.78] | 80 | 143 |
| faiss_rabitq_flat | 0.99 | 119.1 | 5 | 0.9999 | yes / yes | 1.71 [1.60, 1.78] | 80 | 143 |
| faiss_rabitq_flat | 0.995 | 119.1 | 5 | 0.9999 | yes / yes | 1.28 [1.24, 1.33] | 80 | 143 |
| faiss_rabitq_hnsw | 0.98 | 88.9 | 5 | 0.9912 | yes / yes | 1.28 [1.20, 1.33] | 81 | 159 |
| faiss_rabitq_hnsw | 0.99 | 90.9 | 5 | 0.9964 | yes / yes | 1.31 [1.22, 1.36] | 81 | 158 |
| faiss_rabitq_hnsw | 0.995 | 122.1 | 5 | 0.9986 | yes / yes | 1.32 [1.28, 1.37] | 81 | 160 |
| faiss_rabitq_ivf | 0.98 | 200.7 | 5 | 0.9961 | yes / yes | 2.89 [2.70, 3.00] | 80 | 155 |
| faiss_rabitq_ivf | 0.99 | 220.4 | 5 | 1.0000 | yes / yes | 3.17 [2.97, 3.30] | 80 | 150 |
| faiss_rabitq_ivf | 0.995 | 220.4 | 5 | 1.0000 | yes / yes | 2.38 [2.30, 2.47] | 80 | 150 |
| hnswlib_f32 | 0.98 | 153.5 | 5 | 0.9976 | yes / yes | 2.21 [2.07, 2.30] | 52 | 66 |
| hnswlib_f32 | 0.99 | 153.5 | 5 | 0.9976 | yes / yes | 2.21 [2.07, 2.30] | 52 | 66 |
| hnswlib_f32 | 0.995 | 253.3 | 5 | 1.0001 | yes / yes | 2.73 [2.64, 2.83] | 55 | 72 |
| ours_cascade | 0.98 | 69.5 | 5 | 0.9908 | yes / yes |  | 138 | 113 |
| ours_cascade | 0.99 | 69.5 | 5 | 0.9908 | yes / no |  | 138 | 113 |
| ours_cascade | 0.995 | 92.8 | 5 | 0.9959 | yes / no |  | 137 | 178 |
| scann | 0.98 | 760.9 | 5 | 1.0000 | yes / yes | 10.95 [10.24, 11.39] | 82 | 215 |
| scann | 0.99 | 760.9 | 5 | 1.0000 | yes / yes | 10.95 [10.24, 11.39] | 82 | 215 |
| scann | 0.995 | 760.9 | 5 | 1.0000 | yes / yes | 8.20 [7.95, 8.51] | 82 | 215 |
| svs_vamana_leanvec | 0.98 | 73.3 | 5 | 0.9954 | yes / yes | 1.05 [0.99, 1.10] | 51 | 96 |
| svs_vamana_leanvec | 0.99 | 73.3 | 5 | 0.9954 | yes / yes | 1.05 [0.99, 1.10] | 51 | 96 |
| svs_vamana_leanvec | 0.995 | 110.5 | 5 | 0.9987 | yes / yes | 1.19 [1.14, 1.24] | 51 | 102 |
| svs_vamana_lvq | 0.98 | 116.2 | 5 | 0.9990 | yes / yes | 1.67 [1.56, 1.74] | 51 | 90 |
| svs_vamana_lvq | 0.99 | 116.2 | 5 | 0.9990 | yes / yes | 1.67 [1.56, 1.74] | 51 | 90 |
| svs_vamana_lvq | 0.995 | 116.2 | 5 | 0.9990 | yes / yes | 1.25 [1.18, 1.30] | 51 | 90 |
| usearch_b1_rescore | 0.98 | 137.4 | 5 | 0.9876 | yes / no | 1.98 [1.85, 2.06] | 81 | 142 |
| usearch_b1_rescore | 0.99 | 162.4 | 5 | 0.9943 | yes / no | 2.34 [2.19, 2.43] | 82 | 144 |
| usearch_f16 | 0.98 | 156.0 | 5 | 0.9916 | yes / yes | 2.25 [2.10, 2.33] | 40 | 59 |
| usearch_f16 | 0.99 | 206.1 | 5 | 0.9951 | yes / yes | 2.97 [2.77, 3.09] | 41 | 62 |
| usearch_i8 | 0.98 | 110.3 | 5 | 0.9869 | yes / yes | 1.59 [1.48, 1.65] | 35 | 35 |
| usearch_i8 | 0.99 | 150.0 | 5 | 0.9918 | yes / no | 2.16 [2.02, 2.25] | 38 | 48 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 545.3 / 1.0000 | 593.6 / 1.0000 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 1420.1 / 1.0001 | 1468.6 / 1.0000 | 2283.3 / 1.0000 |
| diskann_vamana | L 200 | 755.4 / 1.0000 | 801.0 / 1.0000 | 771.3 / 1.0000 | 818.2 / 1.0000 | 905.5 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 1757.1 / 1.0001 | 1805.2 / 1.0000 | 2625.3 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1008.4 / 1.0000 | 1052.7 / 1.0000 | 1146.1 / 1.0000 | 1032.4 / 1.0000 | 1073.9 / 1.0000 | 1353.8 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1279.1 / 1.0000 | 1324.4 / 1.0000 | 1608.1 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 100.2 / 0.9959 | 145.1 / 0.9959 | 137.8 / 0.9981 | 183.2 / 0.9982 | 274.7 / 0.9982 | 209.8 / 0.9996 | 254.6 / 0.9996 | 533.0 / 0.9996 | 399.9 / 1.0001 | 442.9 / 1.0001 | 1278.6 / 1.0001 |
| faiss_bin_hnsw | ef 100 | 151.5 / 0.9952 | 197.4 / 0.9952 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 864.5 / 1.0001 | 908.9 / 1.0001 | 1731.3 / 1.0001 |
| faiss_bin_hnsw | ef 200 | 216.6 / 0.9959 | 260.7 / 0.9959 | 252.8 / 0.9981 | 293.6 / 0.9982 | 385.6 / 0.9982 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1457.4 / 1.0001 | 1483.8 / 1.0001 | 2331.3 / 1.0001 |
| faiss_bin_hnsw | ef 400 |  |  | 346.3 / 0.9981 | 391.3 / 0.9982 | 480.4 / 0.9982 | 408.8 / 0.9996 | 454.5 / 0.9996 | 732.7 / 0.9996 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 584.8 / 0.9996 | 630.9 / 0.9996 | 909.7 / 0.9996 |  |  |  |
| faiss_hnsw_flat | ef 100 | 401.3 / 0.9994 | 453.5 / 0.9993 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1523.8 / 1.0001 | 1588.2 / 1.0000 | 2402.3 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 604.1 / 0.9999 | 653.8 / 0.9999 | 637.7 / 0.9999 | 684.7 / 0.9999 | 775.0 / 0.9999 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 2173.2 / 1.0001 | 2221.1 / 1.0000 | 3058.1 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 892.4 / 1.0000 | 939.9 / 1.0000 | 1036.8 / 1.0000 | 946.6 / 1.0000 | 999.2 / 1.0000 | 1284.9 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1249.6 / 1.0000 | 1308.9 / 1.0000 | 1581.1 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 179.1 / 1.0001 | 225.7 / 1.0000 | 205.6 / 1.0000 | 252.0 / 1.0000 | 341.5 / 1.0000 | 258.1 / 1.0000 | 302.0 / 1.0000 | 581.6 / 1.0000 | 392.5 / 1.0000 | 433.6 / 1.0000 | 1270.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 181.2 / 0.9175 | 225.0 / 0.9175 | 504.5 / 0.9175 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 133.6 / 0.9224 | 180.7 / 0.9224 | 274.5 / 0.9224 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 217.3 / 0.9669 | 263.8 / 0.9669 | 544.6 / 0.9669 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 387.9 / 0.9750 | 431.7 / 0.9749 | 1266.8 / 0.9749 |
| faiss_rabitq_ivf | nprobe 4 | 82.0 / 0.7555 | 128.1 / 0.7555 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 486.4 / 0.9989 | 521.9 / 0.9989 | 1359.4 / 0.9989 |
| faiss_rabitq_ivf | nprobe 8 | 92.1 / 0.8545 | 138.4 / 0.8545 | 113.6 / 0.8545 | 160.1 / 0.8545 | 254.2 / 0.8545 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 393.2 / 0.9998 | 442.7 / 0.9998 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1364.3 / 1.0001 | 1425.0 / 1.0000 | 2256.1 / 1.0000 |
| hnswlib_f32 | ef 200 | 600.0 / 1.0000 | 650.0 / 1.0000 | 610.9 / 1.0000 | 666.0 / 1.0000 | 754.4 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 1750.3 / 1.0001 | 1816.6 / 1.0000 | 2657.6 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 862.2 / 1.0000 | 920.3 / 1.0000 | 1016.9 / 1.0000 | 896.8 / 1.0000 | 949.0 / 1.0000 | 1227.7 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1184.6 / 1.0000 | 1237.4 / 1.0000 | 1514.1 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 53.4 / 0.9959 | 68.5 / 0.9959 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 112.9 / 1.0001 | 131.6 / 1.0001 | 567.5 / 1.0001 |
| ours_scan | ef 200 |  |  | 60.5 / 0.9982 | 77.0 / 0.9982 | 113.9 / 0.9982 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 74.2 / 0.9997 | 91.3 / 0.9996 | 219.7 / 0.9996 |  |  |  |
| ours_walk | ef 100 | 68.5 / 0.9959 | 84.3 / 0.9959 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 168.8 / 1.0001 | 189.3 / 1.0001 | 629.3 / 1.0001 |
| ours_walk | ef 200 | 77.7 / 0.9959 | 94.0 / 0.9959 | 83.4 / 0.9982 | 100.7 / 0.9982 | 139.2 / 0.9982 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 216.0 / 1.0001 | 235.9 / 1.0001 | 681.9 / 1.0001 |
| ours_walk | ef 400 |  |  | 93.3 / 0.9982 | 111.6 / 0.9982 | 151.6 / 0.9982 | 106.6 / 0.9997 | 124.0 / 0.9997 | 258.4 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 122.5 / 0.9997 | 140.1 / 0.9997 | 275.1 / 0.9997 |  |  |  |
| scann | reorder 100 | 888.4 / 1.0000 | 938.6 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1186.5 / 1.0001 | 1230.4 / 1.0000 | 2056.2 / 1.0000 |
| scann | reorder 200 |  |  | 937.5 / 1.0000 | 980.7 / 1.0000 | 1041.2 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 1000.1 / 1.0000 | 1045.6 / 1.0000 | 1314.9 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 121.8 / 0.9911 | 167.4 / 0.9911 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 589.2 / 0.9967 | 636.7 / 0.9967 | 1493.7 / 0.9967 |
| usearch_b1_rescore | ef 200 | 180.4 / 0.9922 | 224.5 / 0.9922 | 189.5 / 0.9943 | 235.5 / 0.9944 | 327.5 / 0.9944 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 919.9 / 0.9967 | 968.2 / 0.9967 | 1830.0 / 0.9967 |
| usearch_b1_rescore | ef 400 |  |  | 283.1 / 0.9948 | 324.0 / 0.9949 | 418.7 / 0.9949 | 300.4 / 0.9963 | 348.2 / 0.9963 | 634.2 / 0.9963 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 445.9 / 0.9963 | 494.9 / 0.9963 | 785.8 / 0.9963 |  |  |  |

### gcsn / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.7359)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 479.1 | 5 | 0.9964 | yes / yes | 4.60 [4.16, 4.79] | 68 | 146 |
| diskann_vamana | 0.99 | 479.1 | 5 | 0.9964 | yes / yes | 3.52 [3.18, 3.57] | 68 | 146 |
| diskann_vamana | 0.995 | 611.5 | 5 | 0.9980 | yes / no | 3.44 [3.09, 3.54] | 68 | 150 |
| faiss_bin_flat | 0.98 | 80.5 | 5 | 0.9929 | yes / yes | 0.77 [0.70, 0.81] | 80 | 138 |
| faiss_bin_flat | 0.99 | 80.5 | 5 | 0.9929 | yes / no | 0.59 [0.53, 0.61] | 80 | 138 |
| faiss_bin_flat | 0.995 | 286.1 | 5 | 1.0001 | yes / yes | 1.61 [1.45, 1.66] | 80 | 141 |
| faiss_bin_hnsw | 0.98 | 367.2 | 5 | 0.9861 | yes / no | 3.52 [3.23, 3.76] | 80 | 149 |
| faiss_bin_hnsw | 0.99 | 409.7 | 5 | 0.9933 | yes / no | 3.01 [2.72, 3.21] | 80 | 150 |
| faiss_bin_hnsw | 0.995 | 482.2 | 5 | 0.9982 | yes / yes | 2.71 [2.44, 2.90] | 80 | 148 |
| faiss_exact | 0.98 | 746.6 | 5 | 1.0000 | yes / yes | 7.16 [6.57, 7.46] | 51 | 82 |
| faiss_exact | 0.99 | 746.6 | 5 | 1.0000 | yes / yes | 5.48 [4.96, 5.59] | 51 | 82 |
| faiss_exact | 0.995 | 746.6 | 5 | 1.0000 | yes / yes | 4.20 [3.77, 4.26] | 51 | 82 |
| faiss_hnsw_flat | 0.98 | 357.5 | 5 | 0.9963 | yes / yes | 3.43 [3.14, 3.61] | 52 | 89 |
| faiss_hnsw_flat | 0.99 | 357.5 | 5 | 0.9963 | yes / yes | 2.62 [2.38, 2.70] | 52 | 89 |
| faiss_hnsw_flat | 0.995 | 396.4 | 5 | 0.9981 | yes / yes | 2.23 [2.00, 2.31] | 53 | 88 |
| faiss_hnsw_sq8 | 0.98 | 223.7 | 5 | 0.9900 | yes / yes | 2.15 [1.97, 2.32] | 81 | 166 |
| faiss_hnsw_sq8 | 0.99 | 255.7 | 5 | 0.9944 | yes / yes | 1.88 [1.70, 2.06] | 81 | 172 |
| faiss_hnsw_sq8 | 0.995 | 364.1 | 5 | 0.9979 | yes / yes | 2.05 [1.84, 2.20] | 81 | 167 |
| faiss_ivfpq_fs | 0.98 | 225.9 | 5 | 1.0000 | yes / yes | 2.17 [1.99, 2.30] | 81 | 163 |
| faiss_ivfpq_fs | 0.99 | 225.9 | 5 | 1.0000 | yes / yes | 1.66 [1.50, 1.72] | 81 | 163 |
| faiss_ivfpq_fs | 0.995 | 225.9 | 5 | 1.0000 | yes / yes | 1.27 [1.14, 1.32] | 81 | 163 |
| faiss_rabitq_flat | 0.98 | 152.4 | 5 | 1.0000 | yes / yes | 1.46 [1.34, 1.55] | 80 | 146 |
| faiss_rabitq_flat | 0.99 | 152.4 | 5 | 1.0000 | yes / yes | 1.12 [1.01, 1.16] | 80 | 146 |
| faiss_rabitq_flat | 0.995 | 152.4 | 5 | 1.0000 | yes / yes | 0.86 [0.77, 0.89] | 80 | 146 |
| faiss_rabitq_hnsw | 0.98 | 247.8 | 5 | 0.9954 | yes / yes | 2.38 [2.18, 2.48] | 81 | 161 |
| faiss_rabitq_hnsw | 0.99 | 247.8 | 5 | 0.9954 | yes / no | 1.82 [1.65, 1.85] | 81 | 161 |
| faiss_rabitq_hnsw | 0.995 | 308.9 | 5 | 0.9977 | yes / no | 1.74 [1.56, 1.80] | 81 | 160 |
| faiss_rabitq_ivf | 0.98 | 362.9 | 5 | 0.9893 | yes / yes | 3.48 [3.19, 3.71] | 80 | 156 |
| faiss_rabitq_ivf | 0.99 | 384.9 | 5 | 1.0000 | yes / yes | 2.82 [2.56, 2.99] | 80 | 152 |
| faiss_rabitq_ivf | 0.995 | 384.9 | 5 | 1.0000 | yes / yes | 2.16 [1.95, 2.29] | 80 | 152 |
| hnswlib_f32 | 0.98 | 346.0 | 5 | 0.9982 | yes / yes | 3.32 [3.03, 3.49] | 54 | 66 |
| hnswlib_f32 | 0.99 | 346.0 | 5 | 0.9982 | yes / yes | 2.54 [2.30, 2.62] | 54 | 66 |
| hnswlib_f32 | 0.995 | 387.8 | 5 | 0.9994 | yes / yes | 2.18 [1.96, 2.23] | 54 | 64 |
| ours_cascade | 0.98 | 104.2 | 5 | 0.9895 | yes / yes |  | 155 | 176 |
| ours_cascade | 0.99 | 136.3 | 5 | 0.9930 | yes / no |  | 155 | 239 |
| ours_cascade | 0.995 | 177.9 | 5 | 0.9989 | yes / yes |  | 154 | 384 |
| scann | 0.98 | 771.6 | 5 | 1.0000 | yes / yes | 7.40 [6.79, 7.71] | 84 | 216 |
| scann | 0.99 | 771.6 | 5 | 1.0000 | yes / yes | 5.66 [5.13, 5.78] | 84 | 216 |
| scann | 0.995 | 771.6 | 5 | 1.0000 | yes / yes | 4.34 [3.90, 4.41] | 84 | 216 |
| svs_vamana_leanvec | 0.98 | 331.2 | 5 | 0.9994 | yes / yes | 3.18 [2.91, 3.32] | 52 | 97 |
| svs_vamana_leanvec | 0.99 | 331.2 | 5 | 0.9994 | yes / yes | 2.43 [2.20, 2.49] | 52 | 97 |
| svs_vamana_leanvec | 0.995 | 331.2 | 5 | 0.9994 | yes / yes | 1.86 [1.67, 1.90] | 52 | 97 |
| svs_vamana_lvq | 0.98 | 517.9 | 5 | 0.9991 | yes / yes | 4.97 [4.54, 5.19] | 53 | 88 |
| svs_vamana_lvq | 0.99 | 517.9 | 5 | 0.9991 | yes / yes | 3.80 [3.44, 3.87] | 53 | 88 |
| svs_vamana_lvq | 0.995 | 517.9 | 5 | 0.9991 | yes / yes | 2.91 [2.62, 2.97] | 53 | 88 |
| usearch_b1_rescore | 0.98 | 416.9 | 5 | 0.9950 | yes / yes | 4.00 [3.67, 4.16] | 81 | 139 |
| usearch_b1_rescore | 0.99 | 423.5 | 5 | 0.9956 | yes / yes | 3.11 [2.81, 3.20] | 81 | 143 |
| usearch_b1_rescore | 0.995 | 439.4 | 5 | 1.0004 | yes / yes | 2.47 [2.22, 2.51] | 84 | 153 |
| usearch_f16 | 0.98 | 355.9 | 5 | 0.9913 | yes / yes | 3.41 [3.13, 3.57] | 42 | 61 |
| usearch_f16 | 0.99 | 399.9 | 5 | 0.9931 | yes / no | 2.93 [2.66, 2.98] | 45 | 71 |
| usearch_f16 | 0.995 | 469.5 | 5 | 0.9964 | yes / no | 2.64 [2.37, 2.73] | 43 | 65 |
| usearch_i8 | 0.98 | 275.3 | 5 | 0.9897 | yes / yes | 2.64 [2.42, 2.78] | 38 | 40 |
| usearch_i8 | 0.99 | 465.2 | 5 | 0.9943 | yes / no | 3.41 [3.09, 3.50] | 40 | 46 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 435.7 / 0.9845 | 482.2 / 0.9845 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 1269.9 / 1.0000 | 1318.6 / 1.0000 | 2135.2 / 1.0000 |
| diskann_vamana | L 200 | 595.0 / 0.9954 | 642.0 / 0.9953 | 609.5 / 0.9953 | 660.2 / 0.9953 | 741.8 / 0.9953 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 1651.6 / 1.0000 | 1695.0 / 1.0000 | 2537.1 / 1.0000 |
| diskann_vamana | L 400 |  |  | 818.9 / 0.9989 | 871.8 / 0.9989 | 960.1 / 0.9989 | 839.3 / 0.9989 | 886.7 / 0.9989 | 1159.9 / 0.9989 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1101.0 / 1.0000 | 1150.4 / 1.0000 | 1429.3 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 98.3 / 0.9903 | 143.4 / 0.9903 | 133.7 / 0.9954 | 178.5 / 0.9954 | 270.8 / 0.9954 | 199.3 / 0.9992 | 244.3 / 0.9991 | 521.4 / 0.9991 | 378.0 / 1.0000 | 422.7 / 1.0000 | 1256.0 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 141.6 / 0.9824 | 187.6 / 0.9824 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 819.7 / 1.0000 | 860.5 / 1.0000 | 1699.8 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 198.5 / 0.9865 | 242.3 / 0.9865 | 228.8 / 0.9919 | 273.2 / 0.9919 | 365.4 / 0.9919 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1391.1 / 1.0000 | 1431.0 / 1.0000 | 2277.7 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 316.2 / 0.9955 | 365.2 / 0.9955 | 452.0 / 0.9955 | 378.3 / 0.9993 | 426.4 / 0.9992 | 699.3 / 0.9992 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 548.4 / 0.9992 | 596.3 / 0.9991 | 868.0 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 100 | 299.8 / 0.9978 | 346.5 / 0.9977 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1361.5 / 1.0000 | 1417.4 / 1.0000 | 2253.2 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 457.1 / 0.9997 | 499.3 / 0.9996 | 482.4 / 0.9996 | 528.0 / 0.9996 | 617.2 / 0.9996 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 2060.7 / 1.0000 | 2110.3 / 1.0000 | 2935.1 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 707.0 / 1.0000 | 754.8 / 1.0000 | 841.0 / 1.0000 | 754.5 / 1.0000 | 802.7 / 1.0000 | 1074.9 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1077.5 / 1.0000 | 1118.2 / 1.0000 | 1397.3 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 176.9 / 1.0000 | 223.4 / 1.0000 | 201.4 / 1.0000 | 247.5 / 1.0000 | 336.4 / 1.0000 | 247.0 / 1.0000 | 291.8 / 1.0000 | 569.4 / 1.0000 | 373.2 / 1.0000 | 413.3 / 1.0000 | 1258.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 178.6 / 0.8273 | 223.3 / 0.8273 | 502.6 / 0.8273 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 133.3 / 0.8360 | 179.4 / 0.8360 | 273.2 / 0.8360 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 213.3 / 0.9344 | 260.6 / 0.9344 | 540.0 / 0.9344 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 379.2 / 0.9516 | 420.6 / 0.9516 | 1261.4 / 0.9516 |
| faiss_rabitq_ivf | nprobe 4 | 82.2 / 0.6079 | 127.8 / 0.6079 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 461.2 / 0.9990 | 503.2 / 0.9990 | 1341.4 / 0.9990 |
| faiss_rabitq_ivf | nprobe 8 | 92.2 / 0.7314 | 138.0 / 0.7314 | 113.4 / 0.7314 | 159.3 / 0.7314 | 252.6 / 0.7314 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 277.0 / 0.9972 | 314.4 / 0.9971 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1173.4 / 1.0000 | 1211.6 / 1.0000 | 2047.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 423.2 / 1.0000 | 459.2 / 0.9999 | 433.5 / 0.9999 | 494.0 / 0.9999 | 568.7 / 0.9999 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 1593.0 / 1.0000 | 1626.5 / 1.0000 | 2453.8 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 649.3 / 1.0000 | 697.9 / 1.0000 | 786.0 / 1.0000 | 676.0 / 1.0000 | 727.5 / 1.0000 | 998.1 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 974.8 / 1.0000 | 1020.6 / 1.0000 | 1284.9 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 54.2 / 0.9895 | 68.2 / 0.9895 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 113.1 / 1.0001 | 131.0 / 1.0001 | 572.0 / 1.0001 |
| ours_scan | ef 200 |  |  | 60.4 / 0.9962 | 76.1 / 0.9962 | 112.7 / 0.9962 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 73.7 / 0.9990 | 90.5 / 0.9989 | 217.6 / 0.9989 |  |  |  |
| ours_walk | ef 100 | 67.2 / 0.9860 | 81.9 / 0.9860 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 168.4 / 0.9995 | 187.1 / 0.9995 | 628.1 / 0.9995 |
| ours_walk | ef 200 | 75.3 / 0.9889 | 91.6 / 0.9889 | 81.4 / 0.9942 | 97.7 / 0.9942 | 135.3 / 0.9942 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 217.4 / 1.0000 | 236.3 / 1.0000 | 669.0 / 1.0000 |
| ours_walk | ef 400 |  |  | 90.4 / 0.9941 | 108.9 / 0.9941 | 146.6 / 0.9941 | 103.6 / 0.9984 | 121.7 / 0.9983 | 254.4 / 0.9983 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 119.4 / 0.9990 | 139.1 / 0.9990 | 270.1 / 0.9990 |  |  |  |
| scann | reorder 100 | 884.7 / 1.0001 | 932.3 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1183.1 / 1.0000 | 1220.2 / 1.0000 | 2039.0 / 1.0000 |
| scann | reorder 200 |  |  | 919.3 / 1.0000 | 967.5 / 1.0000 | 1034.2 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 981.0 / 1.0000 | 1026.8 / 1.0000 | 1299.2 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 114.6 / 0.9773 | 160.4 / 0.9773 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 553.4 / 0.9965 | 604.2 / 0.9964 | 1461.2 / 0.9964 |
| usearch_b1_rescore | ef 200 | 164.8 / 0.9838 | 210.4 / 0.9838 | 173.5 / 0.9895 | 220.2 / 0.9895 | 312.7 / 0.9895 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 865.1 / 0.9965 | 914.5 / 0.9964 | 1775.0 / 0.9964 |
| usearch_b1_rescore | ef 400 |  |  | 258.7 / 0.9922 | 306.6 / 0.9922 | 396.8 / 0.9922 | 277.9 / 0.9943 | 323.3 / 0.9942 | 607.9 / 0.9942 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 421.8 / 0.9947 | 463.2 / 0.9946 | 757.2 / 0.9946 |  |  |  |

### gcsn / jina-v2-base-code (n_ho = 2400, exact quality 0.8177)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 236.4 | 5 | 0.9999 | yes / yes | 3.51 [3.24, 3.65] | 66 | 145 |
| diskann_vamana | 0.99 | 236.4 | 5 | 0.9999 | yes / yes | 3.51 [3.24, 3.65] | 66 | 145 |
| diskann_vamana | 0.995 | 236.4 | 5 | 0.9999 | yes / yes | 3.51 [3.24, 3.65] | 66 | 145 |
| faiss_bin_flat | 0.98 | 33.5 | 5 | 0.9994 | yes / yes | 0.50 [0.46, 0.52] | 80 | 140 |
| faiss_bin_flat | 0.99 | 33.5 | 5 | 0.9994 | yes / yes | 0.50 [0.46, 0.52] | 80 | 140 |
| faiss_bin_flat | 0.995 | 33.5 | 5 | 0.9994 | yes / yes | 0.50 [0.46, 0.52] | 80 | 140 |
| faiss_bin_hnsw | 0.98 | 85.5 | 5 | 0.9854 | yes / no | 1.27 [1.17, 1.32] | 80 | 152 |
| faiss_bin_hnsw | 0.99 | 92.6 | 5 | 0.9916 | yes / no | 1.37 [1.27, 1.42] | 80 | 146 |
| faiss_bin_hnsw | 0.995 | 102.9 | 5 | 0.9962 | yes / no | 1.53 [1.41, 1.58] | 80 | 150 |
| faiss_exact | 0.98 | 729.7 | 5 | 0.9999 | yes / yes | 10.82 [9.99, 11.20] | 49 | 84 |
| faiss_exact | 0.99 | 729.7 | 5 | 0.9999 | yes / yes | 10.82 [9.99, 11.20] | 49 | 84 |
| faiss_exact | 0.995 | 729.7 | 5 | 0.9999 | yes / yes | 10.82 [9.99, 11.20] | 49 | 84 |
| faiss_hnsw_flat | 0.98 | 136.8 | 5 | 0.9997 | yes / yes | 2.03 [1.87, 2.11] | 50 | 86 |
| faiss_hnsw_flat | 0.99 | 136.8 | 5 | 0.9997 | yes / yes | 2.03 [1.87, 2.11] | 50 | 86 |
| faiss_hnsw_flat | 0.995 | 136.8 | 5 | 0.9997 | yes / yes | 2.03 [1.87, 2.11] | 50 | 86 |
| faiss_hnsw_sq8 | 0.98 | 68.7 | 5 | 0.9916 | yes / yes | 1.02 [0.94, 1.06] | 81 | 169 |
| faiss_hnsw_sq8 | 0.99 | 89.0 | 5 | 0.9953 | yes / yes | 1.32 [1.22, 1.39] | 81 | 170 |
| faiss_hnsw_sq8 | 0.995 | 96.3 | 5 | 0.9993 | yes / yes | 1.43 [1.32, 1.49] | 81 | 165 |
| faiss_ivfpq_fs | 0.98 | 73.8 | 5 | 0.9881 | yes / yes | 1.09 [1.01, 1.13] | 81 | 159 |
| faiss_ivfpq_fs | 0.99 | 104.6 | 5 | 0.9999 | yes / yes | 1.55 [1.43, 1.61] | 81 | 163 |
| faiss_ivfpq_fs | 0.995 | 104.6 | 5 | 0.9999 | yes / yes | 1.55 [1.43, 1.61] | 81 | 163 |
| faiss_rabitq_flat | 0.98 | 117.5 | 5 | 0.9999 | yes / yes | 1.74 [1.61, 1.80] | 80 | 143 |
| faiss_rabitq_flat | 0.99 | 117.5 | 5 | 0.9999 | yes / yes | 1.74 [1.61, 1.80] | 80 | 143 |
| faiss_rabitq_flat | 0.995 | 117.5 | 5 | 0.9999 | yes / yes | 1.74 [1.61, 1.80] | 80 | 143 |
| faiss_rabitq_hnsw | 0.98 | 49.3 | 5 | 0.9920 | yes / yes | 0.73 [0.68, 0.76] | 81 | 152 |
| faiss_rabitq_hnsw | 0.99 | 59.7 | 5 | 0.9949 | yes / no | 0.89 [0.82, 0.92] | 81 | 159 |
| faiss_rabitq_hnsw | 0.995 | 78.4 | 5 | 0.9982 | yes / yes | 1.16 [1.07, 1.20] | 81 | 162 |
| faiss_rabitq_ivf | 0.98 | 121.3 | 5 | 0.9881 | yes / yes | 1.80 [1.66, 1.87] | 80 | 149 |
| faiss_rabitq_ivf | 0.99 | 187.9 | 5 | 0.9979 | yes / yes | 2.79 [2.57, 2.90] | 80 | 154 |
| faiss_rabitq_ivf | 0.995 | 207.4 | 5 | 0.9999 | yes / yes | 3.08 [2.84, 3.18] | 80 | 151 |
| hnswlib_f32 | 0.98 | 134.1 | 5 | 0.9986 | yes / yes | 1.99 [1.84, 2.06] | 52 | 67 |
| hnswlib_f32 | 0.99 | 134.1 | 5 | 0.9986 | yes / yes | 1.99 [1.84, 2.06] | 52 | 67 |
| hnswlib_f32 | 0.995 | 134.1 | 5 | 0.9986 | yes / yes | 1.99 [1.84, 2.06] | 52 | 67 |
| ours_cascade | 0.98 | 67.4 | 5 | 0.9995 | yes / yes |  | 158 | 113 |
| ours_cascade | 0.99 | 67.4 | 5 | 0.9995 | yes / yes |  | 158 | 113 |
| ours_cascade | 0.995 | 67.4 | 5 | 0.9995 | yes / yes |  | 158 | 113 |
| scann | 0.98 | 760.8 | 5 | 0.9999 | yes / yes | 11.28 [10.42, 11.68] | 82 | 224 |
| scann | 0.99 | 760.8 | 5 | 0.9999 | yes / yes | 11.28 [10.42, 11.68] | 82 | 224 |
| scann | 0.995 | 760.8 | 5 | 0.9999 | yes / yes | 11.28 [10.42, 11.68] | 82 | 224 |
| svs_vamana_leanvec | 0.98 | 80.5 | 5 | 0.9999 | yes / yes | 1.19 [1.10, 1.24] | 50 | 99 |
| svs_vamana_leanvec | 0.99 | 80.5 | 5 | 0.9999 | yes / yes | 1.19 [1.10, 1.24] | 50 | 99 |
| svs_vamana_leanvec | 0.995 | 80.5 | 5 | 0.9999 | yes / yes | 1.19 [1.10, 1.24] | 50 | 99 |
| svs_vamana_lvq | 0.98 | 119.2 | 5 | 0.9995 | yes / yes | 1.77 [1.63, 1.83] | 51 | 87 |
| svs_vamana_lvq | 0.99 | 119.2 | 5 | 0.9995 | yes / yes | 1.77 [1.63, 1.83] | 51 | 87 |
| svs_vamana_lvq | 0.995 | 119.2 | 5 | 0.9995 | yes / yes | 1.77 [1.63, 1.83] | 51 | 87 |
| usearch_b1_rescore | 0.98 | 113.9 | 5 | 0.9962 | yes / yes | 1.69 [1.56, 1.75] | 81 | 139 |
| usearch_b1_rescore | 0.99 | 113.9 | 5 | 0.9962 | yes / yes | 1.69 [1.56, 1.75] | 81 | 139 |
| usearch_b1_rescore | 0.995 | 130.2 | 5 | 0.9975 | yes / yes | 1.93 [1.78, 2.00] | 82 | 143 |
| usearch_f16 | 0.98 | 141.2 | 5 | 0.9932 | yes / yes | 2.09 [1.93, 2.19] | 40 | 58 |
| usearch_f16 | 0.99 | 146.1 | 5 | 0.9941 | yes / yes | 2.17 [2.00, 2.27] | 40 | 59 |
| usearch_f16 | 0.995 | 182.8 | 5 | 0.9979 | yes / yes | 2.71 [2.50, 2.86] | 43 | 73 |
| usearch_i8 | 0.98 | 98.8 | 5 | 0.9918 | yes / yes | 1.47 [1.35, 1.52] | 35 | 36 |
| usearch_i8 | 0.99 | 144.0 | 5 | 0.9928 | yes / no | 2.14 [1.97, 2.24] | 36 | 40 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 476.0 / 0.9999 | 524.3 / 0.9999 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 1328.9 / 0.9999 | 1379.6 / 0.9999 | 2202.8 / 1.0000 |
| diskann_vamana | L 200 | 658.6 / 0.9999 | 704.1 / 0.9999 | 669.4 / 0.9999 | 715.9 / 0.9999 | 805.7 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 1681.9 / 0.9999 | 1727.3 / 0.9999 | 2560.2 / 1.0000 |
| diskann_vamana | L 400 |  |  | 902.9 / 0.9999 | 948.6 / 0.9999 | 1040.6 / 1.0000 | 922.4 / 0.9999 | 968.7 / 0.9999 | 1243.4 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1187.5 / 0.9999 | 1231.3 / 0.9999 | 1515.5 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 100.2 / 0.9995 | 145.1 / 0.9996 | 139.3 / 0.9997 | 183.3 / 0.9997 | 274.0 / 0.9998 | 210.1 / 0.9997 | 253.3 / 0.9997 | 530.0 / 0.9997 | 397.4 / 0.9999 | 440.3 / 0.9999 | 1268.7 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 139.6 / 0.9995 | 184.9 / 0.9996 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 813.1 / 0.9999 | 860.2 / 0.9999 | 1690.9 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 194.2 / 0.9995 | 239.3 / 0.9996 | 224.4 / 0.9997 | 268.3 / 0.9997 | 361.0 / 0.9998 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1391.7 / 0.9999 | 1446.2 / 0.9999 | 2274.2 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 312.6 / 0.9997 | 359.5 / 0.9997 | 449.3 / 0.9998 | 376.1 / 0.9997 | 420.5 / 0.9997 | 693.7 / 0.9997 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 546.1 / 0.9997 | 594.2 / 0.9997 | 862.9 / 0.9997 |  |  |  |
| faiss_hnsw_flat | ef 100 | 355.4 / 0.9999 | 396.2 / 0.9999 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1448.6 / 0.9999 | 1495.8 / 0.9999 | 2324.8 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 531.8 / 0.9999 | 577.8 / 0.9999 | 559.5 / 0.9999 | 606.0 / 0.9999 | 692.6 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 2131.8 / 0.9999 | 2161.6 / 0.9999 | 3008.8 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 804.7 / 0.9999 | 849.7 / 0.9999 | 941.2 / 1.0000 | 851.9 / 0.9999 | 896.5 / 0.9999 | 1166.4 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1167.7 / 0.9999 | 1221.5 / 0.9999 | 1504.4 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 178.6 / 0.9999 | 224.5 / 0.9999 | 204.1 / 0.9999 | 249.9 / 0.9999 | 339.6 / 0.9999 | 254.3 / 0.9999 | 295.1 / 0.9999 | 575.1 / 1.0000 | 382.8 / 0.9999 | 424.0 / 0.9999 | 1262.0 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 174.3 / 0.9609 | 220.9 / 0.9609 | 499.7 / 0.9610 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 130.7 / 0.9630 | 177.3 / 0.9630 | 270.3 / 0.9631 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 208.6 / 0.9854 | 256.3 / 0.9854 | 536.2 / 0.9855 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 374.1 / 0.9896 | 417.8 / 0.9896 | 1251.6 / 0.9897 |
| faiss_rabitq_ivf | nprobe 4 | 81.1 / 0.8315 | 126.4 / 0.8315 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 458.9 / 0.9994 | 502.1 / 0.9994 | 1336.8 / 0.9995 |
| faiss_rabitq_ivf | nprobe 8 | 90.7 / 0.9163 | 136.0 / 0.9165 | 111.6 / 0.9163 | 158.0 / 0.9163 | 251.4 / 0.9164 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 350.3 / 0.9999 | 390.7 / 0.9999 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1302.4 / 0.9999 | 1359.9 / 0.9999 | 2169.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 531.1 / 0.9999 | 577.8 / 0.9999 | 544.8 / 0.9999 | 595.8 / 0.9999 | 684.7 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 1712.4 / 0.9999 | 1747.8 / 0.9999 | 2570.2 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 790.1 / 0.9999 | 836.8 / 0.9999 | 926.0 / 1.0000 | 812.5 / 0.9999 | 864.2 / 0.9999 | 1131.5 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1110.2 / 0.9999 | 1172.5 / 0.9999 | 1436.1 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 53.4 / 0.9995 | 67.6 / 0.9996 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 112.9 / 0.9999 | 130.9 / 0.9999 | 561.9 / 1.0000 |
| ours_scan | ef 200 |  |  | 59.9 / 0.9997 | 76.5 / 0.9997 | 113.4 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 73.7 / 0.9997 | 90.6 / 0.9997 | 217.2 / 0.9997 |  |  |  |
| ours_walk | ef 100 | 64.4 / 0.9995 | 80.0 / 0.9996 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 168.4 / 0.9999 | 187.1 / 0.9999 | 620.1 / 1.0000 |
| ours_walk | ef 200 | 71.6 / 0.9995 | 87.0 / 0.9996 | 78.0 / 0.9997 | 94.9 / 0.9997 | 132.7 / 0.9998 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 218.9 / 0.9999 | 236.4 / 0.9999 | 669.6 / 1.0000 |
| ours_walk | ef 400 |  |  | 87.8 / 0.9997 | 105.0 / 0.9997 | 143.7 / 0.9998 | 99.6 / 0.9997 | 118.2 / 0.9997 | 247.8 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 119.8 / 0.9997 | 137.5 / 0.9997 | 268.8 / 0.9997 |  |  |  |
| scann | reorder 100 | 886.3 / 0.9999 | 935.0 / 0.9999 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1173.9 / 0.9999 | 1222.2 / 0.9999 | 2048.3 / 1.0000 |
| scann | reorder 200 |  |  | 927.2 / 0.9999 | 971.2 / 0.9999 | 1035.5 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 992.4 / 0.9999 | 1037.4 / 0.9999 | 1299.1 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 114.8 / 0.9960 | 160.2 / 0.9960 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 549.3 / 0.9962 | 600.7 / 0.9962 | 1451.3 / 0.9963 |
| usearch_b1_rescore | ef 200 | 163.3 / 0.9960 | 208.5 / 0.9960 | 173.3 / 0.9962 | 217.9 / 0.9962 | 310.2 / 0.9963 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 867.4 / 0.9962 | 916.7 / 0.9962 | 1769.9 / 0.9963 |
| usearch_b1_rescore | ef 400 |  |  | 258.4 / 0.9962 | 300.8 / 0.9962 | 394.1 / 0.9963 | 276.3 / 0.9962 | 320.8 / 0.9962 | 608.7 / 0.9963 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 416.9 / 0.9962 | 463.0 / 0.9962 | 751.5 / 0.9963 |  |  |  |

### quora / CodeRankEmbed (n_ho = 4000, exact quality 0.8569)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 483.5 | 5 | 0.9840 | yes / no | 4.71 [3.99, 5.28] | 1802 | 7689 |
| diskann_vamana | 0.99 | 729.3 | 5 | 0.9918 | yes / no | 7.10 [6.11, 7.97] | 1802 | 7816 |
| diskann_vamana | 0.995 | 1199.5 | 5 | 0.9970 | yes / yes | 7.99 [7.13, 9.36] | 1802 | 7747 |
| faiss_bin_flat | 0.98 | 1243.0 | 5 | 0.9881 | yes / yes | 12.10 [11.24, 13.58] | 1604 | 10567 |
| faiss_bin_flat | 0.99 | 1250.8 | 5 | 0.9958 | yes / yes | 12.18 [11.30, 13.41] | 1604 | 10422 |
| faiss_bin_flat | 0.995 | 1276.9 | 5 | 0.9985 | yes / yes | 8.51 [7.96, 9.92] | 1604 | 10615 |
| faiss_bin_hnsw | 0.98 | 172.4 | 5 | 0.9846 | yes / yes | 1.68 [1.25, 2.07] | 1766 | 11003 |
| faiss_bin_hnsw | 0.99 | 257.9 | 5 | 0.9919 | yes / no | 2.51 [1.79, 3.17] | 1893 | 11486 |
| faiss_bin_hnsw | 0.995 | 354.5 | 5 | 0.9963 | yes / no | 2.36 [2.15, 3.61] | 1893 | 11405 |
| faiss_exact | 0.98 | 104554.1 | 5 | 1.0000 | yes / yes | 1018.22 [951.70, 1120.65] | 1572 | 4827 |
| faiss_exact | 0.99 | 104554.1 | 5 | 1.0000 | yes / yes | 1018.22 [951.70, 1120.65] | 1572 | 4827 |
| faiss_exact | 0.995 | 104554.1 | 5 | 1.0000 | yes / yes | 696.53 [652.14, 786.80] | 1572 | 4827 |
| faiss_hnsw_flat | 0.98 | 352.5 | 5 | 0.9833 | yes / no | 3.43 [3.10, 3.80] | 1645 | 5366 |
| faiss_hnsw_flat | 0.99 | 632.6 | 5 | 0.9938 | yes / yes | 6.16 [5.58, 6.88] | 1645 | 5430 |
| faiss_hnsw_flat | 0.995 | 1164.2 | 5 | 0.9980 | yes / yes | 7.76 [7.24, 8.97] | 1709 | 5677 |
| faiss_hnsw_sq8 | 0.98 | 558.9 | 5 | 0.9826 | yes / no | 5.44 [4.41, 5.99] | 2053 | 11936 |
| faiss_hnsw_sq8 | 0.99 | 909.2 | 5 | 0.9922 | yes / no | 8.85 [7.13, 9.80] | 2245 | 12599 |
| faiss_hnsw_sq8 | 0.995 | 1639.9 | 5 | 0.9973 | yes / yes | 10.92 [8.81, 12.44] | 2245 | 12478 |
| faiss_ivfpq_fs | 0.98 | 646.8 | 5 | 0.9892 | yes / yes | 6.30 [5.33, 7.45] | 1638 | 10758 |
| faiss_ivfpq_fs | 0.99 | 1111.5 | 5 | 0.9963 | yes / yes | 10.82 [9.42, 13.05] | 1638 | 10840 |
| faiss_ivfpq_fs | 0.995 | 1463.1 | 5 | 0.9978 | yes / yes | 9.75 [8.78, 12.12] | 1638 | 10940 |
| faiss_rabitq_flat | 0.98 | 10019.8 | 5 | 1.0000 | yes / yes | 97.58 [82.36, 135.05] | 1655 | 10762 |
| faiss_rabitq_flat | 0.99 | 10019.8 | 5 | 1.0000 | yes / yes | 97.58 [82.36, 135.05] | 1655 | 10762 |
| faiss_rabitq_flat | 0.995 | 10019.8 | 5 | 1.0000 | yes / yes | 66.75 [58.10, 94.82] | 1655 | 10762 |
| faiss_rabitq_hnsw | 0.98 | 196.9 | 5 | 0.9837 | yes / no | 1.92 [1.20, 2.36] | 1914 | 11845 |
| faiss_rabitq_hnsw | 0.99 | 341.6 | 5 | 0.9940 | yes / yes | 3.33 [1.91, 3.97] | 1913 | 11703 |
| faiss_rabitq_hnsw | 0.995 | 553.2 | 5 | 0.9979 | yes / yes | 3.69 [2.26, 5.08] | 1914 | 11618 |
| faiss_rabitq_ivf | 0.98 | 1724.1 | 5 | 0.9880 | yes / yes | 16.79 [13.53, 20.09] | 1637 | 10937 |
| faiss_rabitq_ivf | 0.99 | 2801.1 | 5 | 0.9950 | yes / yes | 27.28 [22.61, 34.41] | 1637 | 10909 |
| faiss_rabitq_ivf | 0.995 | 5389.7 | 5 | 0.9985 | yes / yes | 35.91 [29.68, 49.12] | 1637 | 10822 |
| hnswlib_f32 | 0.98 | 343.2 | 5 | 0.9811 | yes / no | 3.34 [2.99, 3.74] | 1885 | 5151 |
| hnswlib_f32 | 0.99 | 646.4 | 5 | 0.9941 | yes / yes | 6.30 [5.70, 7.01] | 1758 | 5031 |
| hnswlib_f32 | 0.995 | 1079.2 | 5 | 0.9965 | yes / no | 7.19 [6.58, 8.26] | 1885 | 5546 |
| ours_cascade | 0.98 | 102.7 | 5 | 0.9926 | yes / yes |  | 2007 | 1458 |
| ours_cascade | 0.99 | 102.7 | 5 | 0.9926 | yes / no |  | 2007 | 1458 |
| ours_cascade | 0.995 | 150.1 | 5 | 0.9982 | yes / yes |  | 2067 | 1558 |
| scann | 0.98 | 1407.6 | 5 | 0.9872 | yes / yes | 13.71 [12.87, 15.09] | 1824 | 8071 |
| scann | 0.99 | 4118.3 | 5 | 0.9965 | yes / yes | 40.11 [37.63, 44.15] | 1824 | 8576 |
| scann | 0.995 | 4118.3 | 5 | 0.9965 | yes / no | 27.44 [25.69, 31.37] | 1824 | 8576 |
| svs_vamana_leanvec | 0.98 | 104.1 | 5 | 0.9820 | yes / no | 1.01 [0.81, 1.27] | 641 | 2721 |
| svs_vamana_leanvec | 0.99 | 413.7 | 5 | 0.9966 | yes / yes | 4.03 [3.03, 4.75] | 640 | 2807 |
| svs_vamana_leanvec | 0.995 | 815.4 | 5 | 0.9978 | yes / yes | 5.43 [4.48, 6.71] | 640 | 2712 |
| svs_vamana_lvq | 0.98 | 173.2 | 5 | 0.9905 | yes / yes | 1.69 [1.55, 1.98] | 762 | 3240 |
| svs_vamana_lvq | 0.99 | 321.8 | 5 | 0.9967 | yes / yes | 3.13 [2.67, 3.71] | 762 | 3212 |
| svs_vamana_lvq | 0.995 | 625.1 | 5 | 0.9988 | yes / yes | 4.16 [3.67, 5.05] | 762 | 3243 |
| usearch_b1_rescore | 0.98 | 134.6 | 5 | 0.9821 | yes / no | 1.31 [0.97, 1.66] | 1797 | 11098 |
| usearch_b1_rescore | 0.99 | 194.8 | 5 | 0.9904 | yes / no | 1.90 [1.46, 2.46] | 1924 | 11312 |
| usearch_b1_rescore | 0.995 | 580.4 | 5 | 0.9974 | yes / yes | 3.87 [2.86, 4.93] | 1924 | 11502 |
| usearch_f16 | 0.98 | 590.4 | 5 | 0.9798 | no / no | 5.75 [4.54, 6.50] | 1125 | 4257 |
| usearch_f16 | 0.99 | 1005.7 | 5 | 0.9893 | no / no | 9.79 [7.97, 11.41] | 1125 | 4241 |
| usearch_f16 | 0.995 | 1568.5 | 5 | 0.9967 | yes / no | 10.45 [8.63, 12.66] | 1125 | 4273 |
| usearch_i8 | 0.98 | 466.7 | 5 | 0.9820 | yes / no | 4.55 [3.58, 5.17] | 549 | 2013 |
| usearch_i8 | 0.99 | 671.7 | 5 | 0.9908 | yes / no | 6.54 [5.13, 7.69] | 613 | 2186 |
| usearch_i8 | 0.995 | 1534.2 | 5 | 0.9985 | yes / yes | 10.22 [8.47, 12.76] | 613 | 2178 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1351.8 / 0.9980 | 1379.7 / 0.9980 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 9871.8 / 0.9999 | 9844.6 / 0.9999 | 10966.6 / 0.9999 |
| diskann_vamana | L 200 | 2294.6 / 0.9996 | 2362.0 / 0.9996 | 2323.3 / 0.9996 | 2416.7 / 0.9996 | 2540.1 / 0.9996 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 17581.0 / 1.0000 | 17824.8 / 1.0000 | 18921.1 / 1.0000 |
| diskann_vamana | L 400 |  |  | 4148.1 / 0.9998 | 4250.4 / 0.9998 | 4376.7 / 0.9998 | 4289.4 / 0.9998 | 4344.4 / 0.9998 | 4749.1 / 0.9998 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 7810.1 / 0.9998 | 7868.7 / 0.9998 | 8357.3 / 0.9998 |  |  |  |
| faiss_bin_flat | exhaustive | 1390.4 / 0.9995 | 1465.2 / 0.9995 | 1486.7 / 0.9998 | 1554.0 / 0.9998 | 1686.9 / 0.9998 | 1677.3 / 1.0000 | 1727.6 / 1.0000 | 2124.2 / 1.0000 | 2187.3 / 1.0000 | 2281.4 / 1.0000 | 3428.3 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 377.9 / 0.9944 | 418.4 / 0.9944 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2600.9 / 1.0000 | 2684.9 / 1.0000 | 3999.2 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 549.1 / 0.9978 | 594.8 / 0.9978 | 591.6 / 0.9981 | 675.7 / 0.9981 | 796.2 / 0.9981 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4656.7 / 1.0000 | 4753.4 / 1.0000 | 6382.0 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 950.9 / 0.9997 | 1028.9 / 0.9997 | 1144.6 / 0.9997 | 1153.0 / 0.9999 | 1201.7 / 0.9999 | 1507.2 / 0.9999 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1889.5 / 0.9999 | 1888.5 / 0.9999 | 2349.2 / 0.9999 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1066.8 / 0.9971 | 1089.3 / 0.9971 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 8203.8 / 0.9999 | 8255.3 / 0.9999 | 9434.3 / 0.9999 |
| faiss_hnsw_flat | ef 200 | 1868.2 / 0.9989 | 1919.3 / 0.9989 | 1926.5 / 0.9989 | 1980.0 / 0.9989 | 2124.2 / 0.9989 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 14900.1 / 1.0000 | 15123.7 / 1.0000 | 16230.0 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 3450.5 / 0.9998 | 3520.5 / 0.9998 | 3622.3 / 0.9998 | 3594.6 / 0.9998 | 3619.1 / 0.9998 | 4017.1 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 6505.8 / 0.9999 | 6526.2 / 0.9999 | 6976.2 / 0.9999 |  |  |  |
| faiss_rabitq_flat | exhaustive | 9862.2 / 1.0000 | 9787.1 / 1.0000 | 9608.7 / 1.0000 | 9525.9 / 1.0000 | 9978.0 / 1.0000 | 10266.8 / 1.0000 | 9960.6 / 1.0000 | 11054.0 / 1.0000 | 10301.8 / 1.0000 | 10258.9 / 1.0000 | 11474.7 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 193.3 / 0.6616 | 269.8 / 0.6616 | 244.9 / 0.6616 | 313.1 / 0.6616 | 453.0 / 0.6616 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 895.1 / 0.9236 | 957.9 / 0.9236 | 2031.7 / 0.9236 |
| faiss_rabitq_ivf | nprobe 2 | 227.1 / 0.7934 | 306.4 / 0.7934 | 275.0 / 0.7934 | 345.6 / 0.7934 | 489.7 / 0.7934 | 363.0 / 0.7934 | 432.3 / 0.7934 | 830.9 / 0.7934 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 429.3 / 0.8749 | 494.9 / 0.8749 | 904.0 / 0.8749 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 718.5 / 0.8907 | 795.5 / 0.8907 | 1802.6 / 0.8907 |
| hnswlib_f32 | ef 100 | 1075.5 / 0.9977 | 1126.6 / 0.9977 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 8190.9 / 0.9999 | 8209.0 / 0.9999 | 9443.1 / 0.9999 |
| hnswlib_f32 | ef 200 | 1870.0 / 0.9991 | 1954.5 / 0.9991 | 1927.4 / 0.9991 | 2001.5 / 0.9991 | 2134.8 / 0.9991 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 14649.3 / 1.0000 | 14789.5 / 1.0000 | 15862.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 3471.2 / 0.9995 | 3598.7 / 0.9995 | 3634.6 / 0.9995 | 3583.7 / 0.9995 | 3650.1 / 0.9995 | 4089.8 / 0.9995 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 6505.1 / 0.9998 | 6550.9 / 0.9998 | 6995.5 / 0.9998 |  |  |  |
| ours_scan | ef 100 | 109.0 / 0.9972 | 138.1 / 0.9972 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 474.4 / 0.9998 | 502.9 / 0.9998 | 1126.3 / 0.9998 |
| ours_scan | ef 200 |  |  | 155.7 / 0.9988 | 181.5 / 0.9988 | 245.9 / 0.9988 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 245.1 / 0.9996 | 274.6 / 0.9996 | 481.8 / 0.9996 |  |  |  |
| ours_walk | ef 100 | 111.7 / 0.9972 | 137.9 / 0.9972 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 477.9 / 0.9998 | 487.0 / 0.9998 | 1124.5 / 0.9998 |
| ours_walk | ef 200 | 138.9 / 0.9983 | 171.8 / 0.9983 | 158.3 / 0.9988 | 181.4 / 0.9988 | 249.4 / 0.9988 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 634.1 / 0.9999 | 642.2 / 0.9999 | 1316.4 / 0.9999 |
| ours_walk | ef 400 |  |  | 214.7 / 0.9994 | 237.8 / 0.9994 | 300.9 / 0.9994 | 241.6 / 0.9996 | 272.5 / 0.9996 | 462.2 / 0.9996 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 341.8 / 0.9998 | 359.9 / 0.9998 | 554.5 / 0.9998 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 307.7 / 0.5556 | 380.5 / 0.5556 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 396.5 / 0.5556 | 470.5 / 0.5556 | 612.6 / 0.5556 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 1297.7 / 0.8876 | 1408.3 / 0.8876 | 2482.7 / 0.8876 |
| scann | leaves_to_search 2, reorder 100 | 345.2 / 0.6947 | 415.4 / 0.6947 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 432.8 / 0.6947 | 510.4 / 0.6947 | 648.1 / 0.6947 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 581.8 / 0.6947 | 667.3 / 0.6947 | 1107.5 / 0.6947 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 656.5 / 0.7980 | 693.7 / 0.7980 | 1173.2 / 0.7980 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 1132.2 / 0.8252 | 1220.8 / 0.8252 | 2321.0 / 0.8252 |
| usearch_b1_rescore | ef 100 | 296.0 / 0.9928 | 332.2 / 0.9928 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2163.1 / 0.9995 | 2260.0 / 0.9995 | 3668.7 / 0.9995 |
| usearch_b1_rescore | ef 200 | 477.9 / 0.9974 | 513.9 / 0.9974 | 540.4 / 0.9979 | 557.3 / 0.9979 | 688.2 / 0.9979 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 4320.2 / 0.9995 | 4366.7 / 0.9995 | 5612.5 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 831.3 / 0.9987 | 1006.8 / 0.9987 | 999.0 / 0.9987 | 910.6 / 0.9989 | 1035.0 / 0.9989 | 1398.0 / 0.9989 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1636.9 / 0.9994 | 1798.7 / 0.9994 | 2191.8 / 0.9994 |  |  |  |

### quora / bge-base-en-v1.5 (n_ho = 4000, exact quality 0.8914)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 217.0 | 5 | 0.9845 | yes / yes | 2.21 [0.12, 2.54] | 1694 | 6944 |
| diskann_vamana | 0.99 | 291.3 | 5 | 0.9938 | yes / yes | 2.97 [0.16, 3.53] | 1694 | 6933 |
| diskann_vamana | 0.995 | 387.6 | 5 | 0.9965 | yes / no | 3.95 [0.22, 4.64] | 1819 | 7496 |
| faiss_bin_flat | 0.98 | 1246.9 | 5 | 0.9915 | yes / yes | 12.71 [0.71, 14.24] | 1604 | 10128 |
| faiss_bin_flat | 0.99 | 1263.6 | 5 | 0.9976 | yes / yes | 12.88 [0.72, 14.45] | 1604 | 10132 |
| faiss_bin_flat | 0.995 | 1263.6 | 5 | 0.9976 | yes / yes | 12.88 [0.72, 14.45] | 1604 | 10132 |
| faiss_bin_hnsw | 0.98 | 80.2 | 5 | 0.9834 | yes / no | 0.82 [0.05, 1.06] | 1766 | 10647 |
| faiss_bin_hnsw | 0.99 | 97.2 | 5 | 0.9944 | yes / yes | 0.99 [0.05, 1.33] | 1766 | 10648 |
| faiss_bin_hnsw | 0.995 | 123.6 | 5 | 0.9975 | yes / yes | 1.26 [0.07, 1.83] | 1766 | 10634 |
| faiss_exact | 0.98 | 102083.3 | 5 | 1.0000 | yes / yes | 1040.90 [57.78, 1158.42] | 1572 | 5309 |
| faiss_exact | 0.99 | 102083.3 | 5 | 1.0000 | yes / yes | 1040.90 [57.78, 1158.42] | 1572 | 5309 |
| faiss_exact | 0.995 | 102083.3 | 5 | 1.0000 | yes / yes | 1040.90 [57.78, 1158.42] | 1572 | 5309 |
| faiss_hnsw_flat | 0.98 | 116.9 | 5 | 0.9874 | yes / yes | 1.19 [0.07, 1.39] | 1645 | 5461 |
| faiss_hnsw_flat | 0.99 | 172.1 | 5 | 0.9948 | yes / yes | 1.75 [0.10, 2.01] | 1645 | 5480 |
| faiss_hnsw_flat | 0.995 | 220.2 | 5 | 0.9969 | yes / yes | 2.25 [0.12, 2.56] | 1709 | 5683 |
| faiss_hnsw_sq8 | 0.98 | 171.4 | 5 | 0.9825 | yes / no | 1.75 [0.10, 1.95] | 2053 | 11646 |
| faiss_hnsw_sq8 | 0.99 | 252.0 | 5 | 0.9932 | yes / yes | 2.57 [0.14, 3.20] | 2053 | 11618 |
| faiss_hnsw_sq8 | 0.995 | 321.9 | 5 | 0.9967 | yes / no | 3.28 [0.18, 4.13] | 2117 | 11840 |
| faiss_ivfpq_fs | 0.98 | 178.5 | 5 | 0.9938 | yes / yes | 1.82 [0.10, 2.30] | 1638 | 10264 |
| faiss_ivfpq_fs | 0.99 | 227.6 | 5 | 0.9973 | yes / yes | 2.32 [0.13, 3.09] | 1638 | 10256 |
| faiss_ivfpq_fs | 0.995 | 331.8 | 5 | 0.9992 | yes / yes | 3.38 [0.19, 4.32] | 1638 | 10267 |
| faiss_rabitq_flat | 0.98 | 8911.8 | 5 | 0.9995 | yes / yes | 90.87 [5.04, 119.13] | 1655 | 10254 |
| faiss_rabitq_flat | 0.99 | 8911.8 | 5 | 0.9995 | yes / yes | 90.87 [5.04, 119.13] | 1655 | 10254 |
| faiss_rabitq_flat | 0.995 | 8911.8 | 5 | 0.9995 | yes / yes | 90.87 [5.04, 119.13] | 1655 | 10254 |
| faiss_rabitq_hnsw | 0.98 | 76.9 | 5 | 0.9891 | yes / yes | 0.78 [0.04, 1.23] | 1914 | 11231 |
| faiss_rabitq_hnsw | 0.99 | 83.4 | 5 | 0.9919 | yes / no | 0.85 [0.05, 1.33] | 1786 | 10743 |
| faiss_rabitq_hnsw | 0.995 | 107.7 | 5 | 0.9963 | yes / no | 1.10 [0.06, 1.95] | 1914 | 11209 |
| faiss_rabitq_ivf | 0.98 | 352.4 | 5 | 0.9938 | yes / yes | 3.59 [0.20, 5.17] | 1631 | 10304 |
| faiss_rabitq_ivf | 0.99 | 577.5 | 5 | 0.9972 | yes / yes | 5.89 [0.33, 9.51] | 1630 | 10235 |
| faiss_rabitq_ivf | 0.995 | 862.5 | 5 | 0.9983 | yes / yes | 8.79 [0.49, 12.16] | 1637 | 10303 |
| hnswlib_f32 | 0.98 | 112.0 | 5 | 0.9852 | yes / yes | 1.14 [0.06, 1.30] | 1694 | 5023 |
| hnswlib_f32 | 0.99 | 181.9 | 5 | 0.9942 | yes / yes | 1.85 [0.10, 2.12] | 1694 | 5005 |
| hnswlib_f32 | 0.995 | 261.7 | 5 | 0.9972 | yes / yes | 2.67 [0.15, 3.16] | 1885 | 5562 |
| ours_cascade | 0.98 | 98.1 | 5 | 0.9983 | yes / yes |  | 1998 | 1407 |
| ours_cascade | 0.99 | 98.1 | 5 | 0.9983 | yes / yes |  | 1998 | 1407 |
| ours_cascade | 0.995 | 98.1 | 5 | 0.9983 | yes / yes |  | 1998 | 1407 |
| scann | 0.98 | 524.1 | 5 | 0.9909 | yes / yes | 5.34 [0.30, 5.92] | 1804 | 8463 |
| scann | 0.99 | 602.6 | 5 | 0.9965 | yes / yes | 6.14 [0.34, 6.90] | 1820 | 8513 |
| scann | 0.995 | 1292.6 | 5 | 0.9986 | yes / yes | 13.18 [0.73, 14.65] | 1804 | 8462 |
| svs_vamana_leanvec | 0.98 | 42.8 | 5 | 0.9872 | yes / yes | 0.44 [0.02, 0.55] | 577 | 2333 |
| svs_vamana_leanvec | 0.99 | 57.6 | 5 | 0.9938 | yes / yes | 0.59 [0.03, 0.68] | 641 | 2593 |
| svs_vamana_leanvec | 0.995 | 87.9 | 5 | 0.9978 | yes / yes | 0.90 [0.05, 1.18] | 640 | 2598 |
| svs_vamana_lvq | 0.98 | 58.3 | 5 | 0.9906 | yes / yes | 0.59 [0.03, 0.72] | 698 | 2844 |
| svs_vamana_lvq | 0.99 | 86.3 | 5 | 0.9964 | yes / yes | 0.88 [0.05, 1.07] | 762 | 3118 |
| svs_vamana_lvq | 0.995 | 150.5 | 5 | 0.9991 | yes / yes | 1.53 [0.09, 1.91] | 762 | 3128 |
| usearch_b1_rescore | 0.98 | 83.3 | 5 | 0.9941 | yes / yes | 0.85 [0.05, 1.14] | 1733 | 10477 |
| usearch_b1_rescore | 0.99 | 106.9 | 5 | 0.9950 | yes / yes | 1.09 [0.06, 1.28] | 1733 | 10457 |
| usearch_b1_rescore | 0.995 | 105.7 | 5 | 0.9973 | yes / yes | 1.08 [0.06, 1.55] | 1797 | 10665 |
| usearch_f16 | 0.98 | 156.2 | 5 | 0.9839 | yes / no | 1.59 [0.09, 2.08] | 932 | 3582 |
| usearch_f16 | 0.99 | 236.5 | 5 | 0.9937 | yes / yes | 2.41 [0.13, 3.21] | 1125 | 4197 |
| usearch_f16 | 0.995 | 387.5 | 5 | 0.9965 | yes / no | 3.95 [0.22, 5.21] | 1125 | 4203 |
| usearch_i8 | 0.98 | 131.9 | 5 | 0.9853 | yes / yes | 1.35 [0.07, 1.69] | 549 | 1937 |
| usearch_i8 | 0.99 | 176.4 | 5 | 0.9911 | yes / no | 1.80 [0.10, 2.62] | 742 | 2555 |
| usearch_i8 | 0.995 | 320.3 | 5 | 0.9961 | yes / no | 3.27 [0.18, 4.57] | 549 | 1931 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1012.8 / 0.9998 | 1088.2 / 0.9998 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 6797.0 / 1.0000 | 6791.4 / 1.0000 | 8083.0 / 1.0000 |
| diskann_vamana | L 200 | 1696.6 / 0.9998 | 1773.2 / 0.9998 | 1728.3 / 0.9998 | 1806.9 / 0.9998 | 1928.0 / 0.9998 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 12206.4 / 1.0000 | 11961.5 / 1.0000 | 13148.1 / 1.0000 |
| diskann_vamana | L 400 |  |  | 3012.9 / 1.0000 | 3064.7 / 1.0000 | 3193.0 / 1.0000 | 3056.7 / 1.0000 | 3139.0 / 1.0000 | 3582.4 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 5453.8 / 1.0000 | 5490.4 / 1.0000 | 6005.6 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 1388.0 / 0.9996 | 1461.6 / 0.9996 | 1479.8 / 0.9998 | 1546.2 / 0.9998 | 1686.4 / 0.9998 | 1640.6 / 0.9999 | 1718.8 / 0.9999 | 2122.3 / 0.9999 | 2161.0 / 0.9999 | 2227.6 / 0.9999 | 3430.3 / 0.9999 |
| faiss_bin_hnsw | ef 100 | 277.5 / 0.9991 | 351.8 / 0.9991 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2020.5 / 0.9999 | 2048.0 / 0.9999 | 3302.1 / 0.9999 |
| faiss_bin_hnsw | ef 200 | 409.0 / 0.9996 | 491.0 / 0.9996 | 469.8 / 0.9998 | 531.1 / 0.9998 | 678.7 / 0.9998 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 3612.2 / 0.9999 | 3603.2 / 0.9999 | 4852.6 / 0.9999 |
| faiss_bin_hnsw | ef 400 |  |  | 710.7 / 0.9998 | 793.5 / 0.9998 | 948.7 / 0.9998 | 838.0 / 0.9999 | 923.3 / 0.9999 | 1287.7 / 0.9999 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1393.9 / 0.9999 | 1505.6 / 0.9999 | 1822.7 / 0.9999 |  |  |  |
| faiss_hnsw_flat | ef 100 | 859.7 / 1.0001 | 865.0 / 1.0001 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 6191.4 / 1.0000 | 6129.7 / 1.0000 | 7310.7 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1451.1 / 1.0000 | 1481.6 / 1.0000 | 1489.7 / 1.0000 | 1525.2 / 1.0000 | 1659.4 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 10929.2 / 1.0000 | 10871.7 / 1.0000 | 12041.3 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2605.0 / 1.0000 | 2656.3 / 1.0000 | 2780.6 / 1.0000 | 2732.6 / 1.0000 | 2792.6 / 1.0000 | 3166.7 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4775.5 / 1.0000 | 4970.1 / 1.0000 | 5202.1 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 9075.9 / 1.0000 | 9279.3 / 1.0000 | 9083.0 / 1.0000 | 9187.0 / 1.0000 | 9488.1 / 1.0000 | 9384.8 / 1.0000 | 9415.5 / 1.0000 | 9714.2 / 1.0000 | 9506.0 / 1.0000 | 9581.1 / 1.0000 | 10642.7 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 191.7 / 0.7587 | 262.3 / 0.7587 | 234.3 / 0.7587 | 303.5 / 0.7587 | 443.7 / 0.7587 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 780.2 / 0.9873 | 862.8 / 0.9873 | 2071.7 / 0.9873 |
| faiss_rabitq_ivf | nprobe 2 | 219.6 / 0.9018 | 287.1 / 0.9018 | 263.4 / 0.9018 | 333.4 / 0.9018 | 474.7 / 0.9018 | 352.8 / 0.9018 | 421.4 / 0.9018 | 800.5 / 0.9018 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 402.4 / 0.9616 | 468.3 / 0.9616 | 862.8 / 0.9616 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 667.4 / 0.9709 | 758.1 / 0.9709 | 1693.6 / 0.9709 |
| hnswlib_f32 | ef 100 | 850.0 / 0.9998 | 889.0 / 0.9998 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 6271.0 / 1.0000 | 6134.6 / 1.0000 | 7324.5 / 1.0000 |
| hnswlib_f32 | ef 200 | 1492.2 / 0.9997 | 1539.6 / 0.9997 | 1518.8 / 0.9997 | 1571.2 / 0.9997 | 1692.3 / 0.9997 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 10735.6 / 1.0000 | 10601.0 / 1.0000 | 11872.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 2689.8 / 1.0000 | 2723.6 / 1.0000 | 2875.5 / 1.0000 | 2809.5 / 1.0000 | 2923.5 / 1.0000 | 3225.2 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 4937.3 / 1.0000 | 4997.5 / 1.0000 | 5329.1 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 100.8 / 0.9993 | 128.1 / 0.9993 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 348.9 / 0.9999 | 415.1 / 0.9999 | 989.7 / 0.9999 |
| ours_scan | ef 200 |  |  | 140.7 / 0.9998 | 169.9 / 0.9998 | 228.7 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 186.0 / 0.9999 | 228.6 / 0.9999 | 429.6 / 0.9999 |  |  |  |
| ours_walk | ef 100 | 99.0 / 0.9993 | 127.3 / 0.9993 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 344.5 / 0.9999 | 383.5 / 0.9999 | 985.9 / 0.9999 |
| ours_walk | ef 200 | 121.9 / 0.9996 | 158.1 / 0.9996 | 140.7 / 0.9998 | 165.3 / 0.9998 | 236.4 / 0.9998 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 451.4 / 0.9999 | 557.7 / 0.9999 | 1115.5 / 0.9999 |
| ours_walk | ef 400 |  |  | 175.7 / 0.9999 | 208.1 / 0.9999 | 269.5 / 0.9999 | 201.9 / 0.9999 | 225.8 / 0.9999 | 408.4 / 0.9999 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 248.0 / 0.9999 | 289.2 / 0.9999 | 489.2 / 0.9999 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 309.2 / 0.7010 | 380.9 / 0.7010 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 396.2 / 0.7010 | 472.3 / 0.7010 | 614.4 / 0.7010 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 1288.1 / 0.9755 | 1370.9 / 0.9755 | 2475.6 / 0.9755 |
| scann | leaves_to_search 2, reorder 100 | 343.3 / 0.8422 | 413.1 / 0.8422 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 428.6 / 0.8422 | 510.5 / 0.8422 | 650.7 / 0.8422 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 579.7 / 0.8422 | 668.7 / 0.8422 | 1109.6 / 0.8422 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 658.2 / 0.9306 | 688.1 / 0.9306 | 1171.4 / 0.9306 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 1102.4 / 0.9472 | 1197.4 / 0.9472 | 2306.2 / 0.9472 |
| usearch_b1_rescore | ef 100 | 235.1 / 0.9983 | 314.1 / 0.9983 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1796.5 / 0.9991 | 1700.6 / 0.9991 | 2926.0 / 0.9991 |
| usearch_b1_rescore | ef 200 | 363.2 / 0.9986 | 430.1 / 0.9986 | 386.5 / 0.9987 | 454.0 / 0.9987 | 589.7 / 0.9987 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 3095.6 / 0.9991 | 3024.0 / 0.9991 | 4208.5 / 0.9991 |
| usearch_b1_rescore | ef 400 |  |  | 633.8 / 0.9990 | 701.1 / 0.9990 | 850.0 / 0.9990 | 703.9 / 0.9991 | 934.8 / 0.9991 | 1160.9 / 0.9991 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1192.2 / 0.9991 | 1263.6 / 0.9991 | 1687.7 / 0.9991 |  |  |  |

### quora / jina-v2-base-code (n_ho = 4000, exact quality 0.7004)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 448.3 | 5 | 0.9867 | yes / yes | 4.65 [3.18, 5.10] | 1756 | 7201 |
| diskann_vamana | 0.99 | 791.4 | 5 | 0.9944 | yes / yes | 6.86 [6.16, 7.62] | 1694 | 6922 |
| diskann_vamana | 0.995 | 1404.4 | 5 | 0.9986 | yes / yes | 6.91 [6.15, 7.83] | 1812 | 7443 |
| faiss_bin_flat | 0.98 | 1282.1 | 5 | 0.9923 | yes / yes | 13.31 [9.09, 14.37] | 1604 | 10118 |
| faiss_bin_flat | 0.99 | 1308.8 | 5 | 0.9974 | yes / yes | 11.35 [10.75, 12.57] | 1604 | 10127 |
| faiss_bin_flat | 0.995 | 1361.2 | 5 | 0.9986 | yes / yes | 6.70 [5.96, 7.52] | 1604 | 10140 |
| faiss_bin_hnsw | 0.98 | 153.2 | 5 | 0.9864 | yes / yes | 1.59 [1.09, 1.90] | 1766 | 10616 |
| faiss_bin_hnsw | 0.99 | 278.6 | 5 | 0.9940 | yes / yes | 2.42 [1.98, 3.16] | 1893 | 11085 |
| faiss_bin_hnsw | 0.995 | 661.8 | 5 | 0.9978 | yes / yes | 3.26 [2.41, 3.90] | 1893 | 11111 |
| faiss_exact | 0.98 | 103519.6 | 5 | 1.0000 | yes / yes | 1074.95 [733.91, 1165.02] | 1572 | 5302 |
| faiss_exact | 0.99 | 103519.6 | 5 | 1.0000 | yes / yes | 897.80 [836.46, 994.17] | 1572 | 5302 |
| faiss_exact | 0.995 | 103519.6 | 5 | 1.0000 | yes / yes | 509.21 [453.44, 574.07] | 1572 | 5302 |
| faiss_hnsw_flat | 0.98 | 300.8 | 5 | 0.9863 | yes / yes | 3.12 [2.13, 3.40] | 1836 | 6154 |
| faiss_hnsw_flat | 0.99 | 525.2 | 5 | 0.9947 | yes / yes | 4.55 [4.24, 5.09] | 1836 | 6156 |
| faiss_hnsw_flat | 0.995 | 945.2 | 5 | 0.9979 | yes / yes | 4.65 [4.14, 5.25] | 1836 | 6146 |
| faiss_hnsw_sq8 | 0.98 | 477.5 | 5 | 0.9866 | yes / yes | 4.96 [3.39, 5.44] | 2245 | 12323 |
| faiss_hnsw_sq8 | 0.99 | 839.3 | 5 | 0.9948 | yes / yes | 7.28 [5.42, 8.10] | 2245 | 12307 |
| faiss_hnsw_sq8 | 0.995 | 1427.8 | 5 | 0.9979 | yes / yes | 7.02 [5.43, 8.27] | 2245 | 12322 |
| faiss_ivfpq_fs | 0.98 | 480.7 | 5 | 0.9891 | yes / yes | 4.99 [3.41, 5.90] | 1639 | 10237 |
| faiss_ivfpq_fs | 0.99 | 724.9 | 5 | 0.9935 | yes / yes | 6.29 [5.89, 7.64] | 1638 | 10279 |
| faiss_rabitq_flat | 0.98 | 9013.0 | 5 | 0.9997 | yes / yes | 93.59 [63.90, 141.62] | 1656 | 10262 |
| faiss_rabitq_flat | 0.99 | 9013.0 | 5 | 0.9997 | yes / yes | 78.17 [74.02, 118.28] | 1656 | 10262 |
| faiss_rabitq_flat | 0.995 | 9013.0 | 5 | 0.9997 | yes / yes | 44.33 [39.48, 67.09] | 1656 | 10262 |
| faiss_rabitq_hnsw | 0.98 | 238.3 | 5 | 0.9830 | yes / no | 2.47 [1.60, 3.10] | 1914 | 11178 |
| faiss_rabitq_hnsw | 0.99 | 405.9 | 5 | 0.9905 | yes / no | 3.52 [2.21, 4.47] | 1914 | 11203 |
| faiss_rabitq_hnsw | 0.995 | 844.8 | 5 | 0.9947 | no / no | 4.16 [2.54, 4.96] | 1914 | 11203 |
| faiss_rabitq_ivf | 0.98 | 1036.4 | 5 | 0.9889 | yes / yes | 10.76 [7.35, 13.23] | 1638 | 10239 |
| faiss_rabitq_ivf | 0.99 | 1705.4 | 5 | 0.9948 | yes / yes | 14.79 [12.56, 18.28] | 1637 | 10271 |
| faiss_rabitq_ivf | 0.995 | 2638.2 | 5 | 0.9965 | yes / no | 12.98 [10.77, 17.53] | 1630 | 10254 |
| hnswlib_f32 | 0.98 | 316.8 | 5 | 0.9854 | yes / yes | 3.29 [2.25, 3.59] | 1694 | 5005 |
| hnswlib_f32 | 0.99 | 571.3 | 5 | 0.9926 | yes / no | 4.95 [4.45, 5.51] | 1694 | 4998 |
| hnswlib_f32 | 0.995 | 1028.7 | 5 | 0.9981 | yes / yes | 5.06 [4.51, 5.72] | 1885 | 5570 |
| ours_cascade | 0.98 | 96.3 | 5 | 0.9897 | yes / yes |  | 2001 | 1404 |
| ours_cascade | 0.99 | 115.3 | 5 | 0.9951 | yes / yes |  | 1998 | 1452 |
| ours_cascade | 0.995 | 203.3 | 5 | 0.9987 | yes / yes |  | 2000 | 1740 |
| scann | 0.98 | 2637.0 | 5 | 0.9816 | yes / no | 27.38 [18.69, 30.82] | 1735 | 7048 |
| scann | 0.99 | 4647.9 | 5 | 0.9964 | yes / yes | 40.31 [38.17, 44.64] | 1821 | 8558 |
| scann | 0.995 | 4647.9 | 5 | 0.9964 | yes / no | 22.86 [20.36, 25.74] | 1821 | 8558 |
| svs_vamana_leanvec | 0.98 | 183.1 | 5 | 0.9893 | yes / yes | 1.90 [1.30, 2.12] | 641 | 2598 |
| svs_vamana_leanvec | 0.99 | 348.9 | 5 | 0.9940 | yes / yes | 3.03 [2.24, 3.40] | 640 | 2600 |
| svs_vamana_leanvec | 0.995 | 1386.4 | 5 | 0.9972 | yes / yes | 6.82 [5.16, 7.81] | 641 | 2602 |
| svs_vamana_lvq | 0.98 | 166.3 | 5 | 0.9882 | yes / yes | 1.73 [1.18, 1.91] | 762 | 3115 |
| svs_vamana_lvq | 0.99 | 311.4 | 5 | 0.9963 | yes / yes | 2.70 [2.35, 3.04] | 762 | 3119 |
| svs_vamana_lvq | 0.995 | 617.5 | 5 | 0.9989 | yes / yes | 3.04 [2.63, 3.42] | 762 | 3109 |
| usearch_b1_rescore | 0.98 | 117.5 | 5 | 0.9824 | yes / no | 1.22 [0.83, 1.52] | 1797 | 10645 |
| usearch_b1_rescore | 0.99 | 379.7 | 5 | 0.9929 | yes / no | 3.29 [2.42, 3.88] | 1733 | 10453 |
| usearch_b1_rescore | 0.995 | 495.8 | 5 | 0.9972 | yes / yes | 2.44 [1.86, 3.27] | 1924 | 11060 |
| usearch_f16 | 0.98 | 510.8 | 5 | 0.9864 | yes / yes | 5.30 [3.62, 6.22] | 932 | 3587 |
| usearch_f16 | 0.99 | 940.6 | 5 | 0.9929 | yes / no | 8.16 [6.38, 9.39] | 1125 | 4202 |
| usearch_f16 | 0.995 | 1686.5 | 5 | 0.9961 | yes / no | 8.30 [6.49, 9.52] | 1125 | 4201 |
| usearch_i8 | 0.98 | 360.8 | 5 | 0.9823 | yes / no | 3.75 [2.56, 4.34] | 613 | 2140 |
| usearch_i8 | 0.99 | 622.9 | 5 | 0.9905 | yes / no | 5.40 [3.95, 6.17] | 613 | 2133 |
| usearch_i8 | 0.995 | 1099.0 | 5 | 0.9943 | no / no | 5.41 [3.96, 6.22] | 613 | 2142 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 981.3 / 0.9968 | 1034.8 / 0.9968 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 6572.8 / 1.0001 | 6646.5 / 1.0001 | 7720.0 / 1.0001 |
| diskann_vamana | L 200 | 1652.6 / 0.9987 | 1698.9 / 0.9987 | 1692.7 / 0.9987 | 1755.6 / 0.9987 | 1867.4 / 0.9987 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 11558.2 / 1.0001 | 11431.9 / 1.0001 | 12886.1 / 1.0001 |
| diskann_vamana | L 400 |  |  | 2992.7 / 0.9996 | 3003.1 / 0.9996 | 3109.7 / 0.9996 | 3008.9 / 0.9996 | 3097.7 / 0.9996 | 3412.2 / 0.9996 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 5305.7 / 1.0001 | 5301.4 / 1.0001 | 5694.6 / 1.0001 |  |  |  |
| faiss_bin_flat | exhaustive | 1406.5 / 0.9987 | 1494.0 / 0.9987 | 1498.7 / 0.9988 | 1575.7 / 0.9988 | 1713.8 / 0.9988 | 1664.0 / 0.9997 | 1748.8 / 0.9997 | 2148.7 / 0.9997 | 2144.8 / 1.0000 | 2228.4 / 1.0000 | 3459.4 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 312.6 / 0.9928 | 376.5 / 0.9928 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2154.8 / 0.9995 | 2196.0 / 0.9995 | 3411.6 / 0.9995 |
| faiss_bin_hnsw | ef 200 | 466.9 / 0.9963 | 507.8 / 0.9963 | 531.1 / 0.9965 | 567.7 / 0.9965 | 693.9 / 0.9965 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 3770.5 / 1.0000 | 3907.8 / 1.0000 | 5101.8 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 785.2 / 0.9974 | 878.4 / 0.9974 | 970.7 / 0.9974 | 950.7 / 0.9982 | 999.0 / 0.9982 | 1320.2 / 0.9982 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1476.5 / 0.9992 | 1602.4 / 0.9992 | 1917.6 / 0.9992 |  |  |  |
| faiss_hnsw_flat | ef 100 | 764.8 / 0.9964 | 787.3 / 0.9964 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 5501.6 / 1.0001 | 5465.1 / 1.0001 | 6683.3 / 1.0001 |
| faiss_hnsw_flat | ef 200 | 1326.4 / 0.9982 | 1325.0 / 0.9982 | 1351.1 / 0.9982 | 1375.1 / 0.9982 | 1489.7 / 0.9982 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 9764.6 / 1.0001 | 9840.7 / 1.0001 | 10843.0 / 1.0001 |
| faiss_hnsw_flat | ef 400 |  |  | 2333.6 / 0.9987 | 2424.5 / 0.9987 | 2525.2 / 0.9987 | 2456.8 / 0.9987 | 2503.1 / 0.9987 | 2836.4 / 0.9987 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4308.6 / 0.9999 | 4382.0 / 0.9999 | 4761.4 / 0.9999 |  |  |  |
| faiss_rabitq_flat | exhaustive | 8999.6 / 1.0001 | 9345.2 / 1.0001 | 9373.3 / 1.0001 | 9526.2 / 1.0001 | 9949.9 / 1.0001 | 9863.8 / 1.0001 | 9702.8 / 1.0001 | 10105.6 / 1.0001 | 10047.5 / 1.0001 | 9772.7 / 1.0001 | 11004.4 / 1.0001 |
| faiss_rabitq_ivf | nprobe 1 | 194.7 / 0.6810 | 266.8 / 0.6810 | 238.3 / 0.6810 | 308.1 / 0.6810 | 451.0 / 0.6810 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 856.4 / 0.9405 | 934.6 / 0.9405 | 1855.9 / 0.9405 |
| faiss_rabitq_ivf | nprobe 2 | 223.5 / 0.8058 | 289.1 / 0.8058 | 266.6 / 0.8058 | 335.1 / 0.8058 | 474.2 / 0.8058 | 354.1 / 0.8058 | 423.4 / 0.8058 | 821.4 / 0.8058 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 429.6 / 0.8847 | 475.4 / 0.8847 | 872.7 / 0.8847 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 692.1 / 0.9003 | 754.4 / 0.9003 | 1677.2 / 0.9003 |
| hnswlib_f32 | ef 100 | 761.0 / 0.9956 | 815.1 / 0.9956 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 5468.1 / 0.9999 | 5512.3 / 0.9999 | 6570.5 / 0.9999 |
| hnswlib_f32 | ef 200 | 1323.5 / 0.9981 | 1382.7 / 0.9981 | 1362.4 / 0.9981 | 1434.9 / 0.9981 | 1521.5 / 0.9981 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 9396.2 / 1.0001 | 9430.9 / 1.0001 | 10466.0 / 1.0001 |
| hnswlib_f32 | ef 400 |  |  | 2408.0 / 0.9991 | 2525.7 / 0.9991 | 2592.5 / 0.9991 | 2490.2 / 0.9991 | 2562.9 / 0.9991 | 2917.2 / 0.9991 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 4380.1 / 0.9999 | 4448.9 / 0.9999 | 4801.9 / 0.9999 |  |  |  |
| ours_scan | ef 100 | 96.3 / 0.9951 | 120.9 / 0.9951 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 363.4 / 0.9997 | 388.4 / 0.9997 | 974.8 / 0.9997 |
| ours_scan | ef 200 |  |  | 129.2 / 0.9966 | 154.5 / 0.9966 | 217.4 / 0.9966 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 190.1 / 0.9987 | 216.9 / 0.9987 | 400.6 / 0.9987 |  |  |  |
| ours_walk | ef 100 | 93.7 / 0.9951 | 119.8 / 0.9951 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 356.8 / 0.9997 | 389.6 / 0.9997 | 975.2 / 0.9997 |
| ours_walk | ef 200 | 114.1 / 0.9966 | 139.2 / 0.9966 | 126.3 / 0.9966 | 158.5 / 0.9966 | 216.9 / 0.9966 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 461.7 / 1.0000 | 489.5 / 1.0000 | 1101.3 / 1.0000 |
| ours_walk | ef 400 |  |  | 160.5 / 0.9976 | 188.5 / 0.9976 | 248.4 / 0.9976 | 187.1 / 0.9987 | 215.7 / 0.9987 | 402.0 / 0.9987 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 244.1 / 0.9994 | 269.9 / 0.9994 | 465.9 / 0.9994 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 314.5 / 0.5129 | 389.0 / 0.5129 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 402.6 / 0.5129 | 476.9 / 0.5129 | 619.9 / 0.5129 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 1352.0 / 0.8596 | 1459.4 / 0.8596 | 2523.0 / 0.8596 |
| scann | leaves_to_search 2, reorder 100 | 355.2 / 0.6487 | 425.9 / 0.6487 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 440.6 / 0.6487 | 522.5 / 0.6487 | 661.9 / 0.6487 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 593.0 / 0.6487 | 677.0 / 0.6487 | 1113.2 / 0.6487 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 675.1 / 0.7557 | 710.1 / 0.7557 | 1191.3 / 0.7557 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 1148.7 / 0.7871 | 1230.1 / 0.7871 | 2342.2 / 0.7871 |
| usearch_b1_rescore | ef 100 | 231.7 / 0.9924 | 316.7 / 0.9924 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1771.7 / 0.9995 | 1827.8 / 0.9995 | 3013.5 / 0.9995 |
| usearch_b1_rescore | ef 200 | 410.0 / 0.9951 | 425.6 / 0.9951 | 453.0 / 0.9949 | 454.0 / 0.9949 | 605.0 / 0.9949 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 3183.0 / 0.9995 | 3245.3 / 0.9995 | 4485.0 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 691.8 / 0.9977 | 826.9 / 0.9977 | 863.8 / 0.9977 | 735.1 / 0.9984 | 874.2 / 0.9984 | 1195.3 / 0.9984 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1275.9 / 0.9993 | 1390.6 / 0.9993 | 1771.0 / 0.9993 |  |  |  |

## amd (frozen points from the amd shortlist, R = 10)

### advtest / CodeRankEmbed (n_ho = 1200, exact quality 0.4732)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 431.8 | 10 | 1.0009 | yes / yes | 5.01 [4.85, 5.35] | 106 | 332 |
| diskann_vamana | 0.99 | 728.9 | 10 | 0.9977 | yes / yes | 7.92 [7.80, 8.08] | 106 | 331 |
| diskann_vamana | 0.995 | 1293.5 | 10 | 0.9980 | yes / no | 13.25 [12.89, 13.47] | 107 | 336 |
| faiss_bin_flat | 0.98 | 69.2 | 10 | 0.9796 | no / no | 0.80 [0.79, 0.87] | 84 | 343 |
| faiss_bin_flat | 0.99 | 164.3 | 10 | 0.9954 | yes / no | 1.79 [1.77, 1.80] | 84 | 343 |
| faiss_bin_flat | 0.995 | 164.3 | 10 | 0.9954 | yes / no | 1.68 [1.66, 1.70] | 84 | 343 |
| faiss_bin_hnsw | 0.98 | 252.2 | 10 | 0.9778 | no / no | 2.92 [2.87, 3.15] | 95 | 381 |
| faiss_bin_hnsw | 0.99 | 381.8 | 10 | 0.9953 | yes / no | 4.15 [4.11, 4.18] | 87 | 357 |
| faiss_bin_hnsw | 0.995 | 471.9 | 10 | 0.9963 | yes / no | 4.84 [4.77, 4.89] | 90 | 364 |
| faiss_exact | 0.98 | 1358.8 | 10 | 1.0000 | yes / yes | 15.75 [15.28, 16.83] | 83 | 216 |
| faiss_exact | 0.99 | 1358.8 | 10 | 1.0000 | yes / yes | 14.77 [14.37, 15.09] | 83 | 216 |
| faiss_exact | 0.995 | 1358.8 | 10 | 1.0000 | yes / yes | 13.92 [13.54, 14.28] | 83 | 216 |
| faiss_hnsw_flat | 0.98 | 276.5 | 10 | 0.9935 | yes / yes | 3.20 [3.14, 3.45] | 86 | 224 |
| faiss_hnsw_flat | 0.99 | 368.7 | 10 | 0.9971 | yes / yes | 4.01 [3.93, 4.11] | 89 | 235 |
| faiss_hnsw_flat | 0.995 | 669.9 | 10 | 0.9995 | yes / yes | 6.86 [6.76, 7.03] | 89 | 234 |
| faiss_hnsw_sq8 | 0.98 | 115.9 | 10 | 0.9864 | yes / no | 1.34 [1.32, 1.45] | 111 | 431 |
| faiss_hnsw_sq8 | 0.99 | 172.9 | 10 | 0.9971 | yes / yes | 1.88 [1.86, 1.89] | 105 | 412 |
| faiss_hnsw_sq8 | 0.995 | 308.4 | 10 | 0.9996 | yes / yes | 3.16 [3.12, 3.20] | 105 | 413 |
| faiss_ivfpq_fs | 0.98 | 105.9 | 10 | 0.9999 | yes / yes | 1.23 [1.20, 1.32] | 88 | 367 |
| faiss_ivfpq_fs | 0.99 | 105.9 | 10 | 0.9999 | yes / yes | 1.15 [1.13, 1.16] | 88 | 367 |
| faiss_ivfpq_fs | 0.995 | 105.9 | 10 | 0.9999 | yes / yes | 1.09 [1.07, 1.10] | 88 | 367 |
| faiss_rabitq_flat | 0.98 | 243.6 | 10 | 0.9937 | yes / yes | 2.82 [2.77, 3.05] | 85 | 349 |
| faiss_rabitq_flat | 0.99 | 250.1 | 10 | 0.9986 | yes / yes | 2.72 [2.69, 2.76] | 85 | 348 |
| faiss_rabitq_flat | 0.995 | 250.1 | 10 | 0.9986 | yes / yes | 2.56 [2.53, 2.60] | 85 | 348 |
| faiss_rabitq_hnsw | 0.98 | 98.3 | 10 | 0.9881 | yes / no | 1.14 [1.12, 1.23] | 97 | 388 |
| faiss_rabitq_hnsw | 0.99 | 170.9 | 10 | 0.9979 | yes / yes | 1.86 [1.84, 1.88] | 97 | 387 |
| faiss_rabitq_hnsw | 0.995 | 224.4 | 10 | 0.9989 | yes / no | 2.30 [2.27, 2.33] | 97 | 388 |
| faiss_rabitq_ivf | 0.98 | 319.1 | 10 | 1.0000 | yes / yes | 3.70 [3.64, 3.99] | 86 | 361 |
| faiss_rabitq_ivf | 0.99 | 319.1 | 10 | 1.0000 | yes / yes | 3.47 [3.43, 3.54] | 86 | 361 |
| faiss_rabitq_ivf | 0.995 | 319.1 | 10 | 1.0000 | yes / yes | 3.27 [3.23, 3.34] | 86 | 361 |
| hnswlib_f32 | 0.98 | 253.2 | 10 | 0.9854 | yes / no | 2.94 [2.88, 3.16] | 97 | 226 |
| hnswlib_f32 | 0.99 | 407.1 | 10 | 0.9953 | yes / no | 4.43 [4.32, 4.56] | 92 | 211 |
| hnswlib_f32 | 0.995 | 456.3 | 10 | 1.0000 | yes / yes | 4.67 [4.58, 4.81] | 97 | 226 |
| ours_cascade | 0.98 | 86.3 | 10 | 0.9832 | yes / no |  | 170 | 176 |
| ours_cascade | 0.99 | 92.0 | 10 | 0.9909 | yes / no |  | 174 | 239 |
| ours_cascade | 0.995 | 97.6 | 10 | 0.9946 | no / no |  | 173 | 292 |
| scann | 0.98 | 266.7 | 10 | 1.0000 | yes / yes | 3.09 [3.04, 3.34] | 127 | 393 |
| scann | 0.99 | 266.7 | 10 | 1.0000 | yes / yes | 2.90 [2.87, 2.91] | 127 | 393 |
| scann | 0.995 | 266.7 | 10 | 1.0000 | yes / yes | 2.73 [2.70, 2.76] | 127 | 393 |
| usearch_b1_rescore | 0.98 | 252.6 | 10 | 0.9914 | yes / yes | 2.93 [2.87, 3.16] | 92 | 363 |
| usearch_b1_rescore | 0.99 | 300.9 | 10 | 0.9902 | yes / no | 3.27 [3.23, 3.29] | 98 | 385 |
| usearch_b1_rescore | 0.995 | 300.9 | 10 | 0.9902 | no / no | 3.08 [3.04, 3.12] | 98 | 385 |
| usearch_f16 | 0.98 | 428.4 | 10 | 0.9859 | yes / no | 4.97 [4.85, 5.32] | 58 | 166 |
| usearch_f16 | 0.99 | 491.0 | 10 | 1.0010 | yes / yes | 5.34 [5.24, 5.44] | 64 | 187 |
| usearch_f16 | 0.995 | 874.7 | 10 | 1.0013 | yes / yes | 8.96 [8.80, 9.24] | 64 | 187 |
| usearch_i8 | 0.98 | 179.8 | 10 | 0.9948 | yes / yes | 2.08 [2.05, 2.25] | 42 | 97 |
| usearch_i8 | 0.99 | 371.2 | 10 | 0.9973 | yes / no | 4.04 [3.99, 4.06] | 48 | 118 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 682.8 / 0.9988 | 750.5 / 0.9988 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 3148.6 / 1.0000 | 3222.6 / 1.0000 | 4340.4 / 1.0000 |
| diskann_vamana | L 200 | 1099.7 / 0.9984 | 1169.5 / 0.9984 | 1118.6 / 0.9984 | 1184.3 / 0.9984 | 1296.3 / 0.9984 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 4347.2 / 1.0000 | 4420.4 / 1.0000 | 5534.7 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1781.7 / 0.9994 | 1837.3 / 0.9994 | 1968.0 / 0.9994 | 1826.5 / 0.9995 | 1885.2 / 0.9994 | 2242.3 / 0.9994 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2730.8 / 1.0000 | 2793.0 / 1.0000 | 3153.5 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 121.7 / 0.9818 | 171.5 / 0.9818 | 155.0 / 0.9908 | 207.5 / 0.9906 | 308.0 / 0.9906 | 220.1 / 0.9972 | 271.8 / 0.9972 | 582.0 / 0.9972 | 403.4 / 0.9999 | 455.7 / 0.9999 | 1384.1 / 0.9999 |
| faiss_bin_hnsw | ef 100 | 150.3 / 0.9646 | 204.4 / 0.9646 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 977.2 / 0.9999 | 1030.9 / 0.9999 | 2045.3 / 0.9999 |
| faiss_bin_hnsw | ef 200 | 217.4 / 0.9792 | 272.4 / 0.9792 | 245.5 / 0.9882 | 302.5 / 0.9879 | 411.1 / 0.9879 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1741.8 / 0.9999 | 1800.5 / 0.9999 | 2803.3 / 0.9999 |
| faiss_bin_hnsw | ef 400 |  |  | 381.5 / 0.9923 | 438.3 / 0.9921 | 547.9 / 0.9921 | 433.3 / 0.9958 | 491.6 / 0.9958 | 825.7 / 0.9958 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 689.5 / 0.9969 | 746.3 / 0.9969 | 1082.4 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 390.7 / 0.9992 | 454.4 / 0.9991 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2415.5 / 1.0000 | 2450.4 / 1.0000 | 3536.2 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 634.0 / 0.9970 | 695.1 / 0.9969 | 671.9 / 0.9970 | 718.6 / 0.9969 | 841.4 / 0.9969 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3823.5 / 1.0000 | 3848.5 / 1.0000 | 4962.6 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1107.9 / 1.0000 | 1151.5 / 1.0000 | 1275.0 / 1.0000 | 1179.8 / 1.0000 | 1234.7 / 1.0000 | 1598.5 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1894.0 / 1.0000 | 1953.4 / 1.0000 | 2322.5 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 321.6 / 0.9999 | 372.7 / 0.9999 | 349.7 / 1.0000 | 398.6 / 1.0000 | 500.4 / 1.0000 | 399.9 / 1.0000 | 450.8 / 1.0000 | 756.2 / 1.0000 | 533.5 / 1.0000 | 585.8 / 1.0000 | 1513.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 113.1 / 0.6766 | 165.1 / 0.6764 | 265.2 / 0.6764 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 171.4 / 0.7543 | 222.6 / 0.7543 | 529.8 / 0.7543 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 282.7 / 0.7675 | 335.0 / 0.7675 | 1261.9 / 0.7675 |
| faiss_rabitq_ivf | nprobe 3 | 78.9 / 0.4830 | 127.1 / 0.4830 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 360.8 / 0.8765 | 411.9 / 0.8769 | 1339.0 / 0.8769 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 98.3 / 0.5606 | 149.8 / 0.5607 | 248.9 / 0.5607 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 87.6 / 0.5815 | 135.7 / 0.5815 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 142.1 / 0.6516 | 193.1 / 0.6515 | 497.5 / 0.6515 |  |  |  |
| hnswlib_f32 | ef 100 | 413.1 / 0.9938 | 464.9 / 0.9937 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2354.6 / 1.0000 | 2420.9 / 1.0000 | 3523.5 / 1.0000 |
| hnswlib_f32 | ef 200 | 680.9 / 0.9998 | 732.1 / 0.9996 | 711.6 / 0.9998 | 757.0 / 0.9996 | 877.6 / 0.9996 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 3444.8 / 1.0000 | 3543.6 / 1.0000 | 4638.4 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1153.2 / 0.9995 | 1228.7 / 0.9995 | 1343.8 / 0.9995 | 1204.7 / 0.9995 | 1275.7 / 0.9995 | 1649.6 / 0.9995 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1926.5 / 1.0000 | 1978.6 / 1.0000 | 2367.2 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 64.9 / 0.9832 | 77.4 / 0.9832 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 103.4 / 0.9999 | 114.2 / 0.9999 | 356.1 / 0.9999 |
| ours_scan | ef 200 |  |  | 69.5 / 0.9913 | 81.8 / 0.9909 | 106.2 / 0.9909 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 78.5 / 0.9970 | 90.9 / 0.9970 | 163.0 / 0.9970 |  |  |  |
| ours_walk | ef 100 | 64.5 / 0.9821 | 77.1 / 0.9821 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 145.2 / 0.9999 | 159.7 / 0.9999 | 415.0 / 0.9999 |
| ours_walk | ef 200 | 74.0 / 0.9851 | 86.8 / 0.9851 | 77.4 / 0.9936 | 90.7 / 0.9932 | 116.5 / 0.9932 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 173.7 / 0.9999 | 188.8 / 0.9999 | 446.1 / 0.9999 |
| ours_walk | ef 400 |  |  | 92.7 / 0.9917 | 106.6 / 0.9915 | 132.7 / 0.9915 | 99.1 / 0.9968 | 113.5 / 0.9966 | 192.5 / 0.9966 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 119.6 / 0.9969 | 133.9 / 0.9969 | 215.4 / 0.9969 |  |  |  |
| scann | reorder 100 | 363.5 / 1.0000 | 410.7 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 806.7 / 1.0000 | 858.2 / 1.0000 | 1722.3 / 1.0000 |
| scann | reorder 200 |  |  | 416.2 / 1.0000 | 466.8 / 1.0000 | 557.9 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 516.7 / 1.0000 | 569.0 / 1.0000 | 851.5 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 133.2 / 0.9618 | 188.1 / 0.9618 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 661.0 / 0.9940 | 720.0 / 0.9940 | 1725.9 / 0.9940 |
| usearch_b1_rescore | ef 200 | 194.1 / 0.9748 | 248.0 / 0.9748 | 199.7 / 0.9819 | 256.9 / 0.9819 | 365.2 / 0.9819 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1092.7 / 0.9931 | 1148.2 / 0.9931 | 2165.4 / 0.9931 |
| usearch_b1_rescore | ef 400 |  |  | 310.2 / 0.9862 | 367.5 / 0.9858 | 477.8 / 0.9858 | 323.4 / 0.9904 | 381.0 / 0.9904 | 715.5 / 0.9904 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 531.7 / 0.9912 | 588.0 / 0.9912 | 924.9 / 0.9912 |  |  |  |

### advtest / bge-base-en-v1.5 (n_ho = 1200, exact quality 0.2223)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 865.9 | 10 | 0.9847 | yes / no | 7.72 [7.65, 7.97] | 106 | 333 |
| diskann_vamana | 0.99 | 1430.6 | 10 | 0.9946 | yes / no | 12.76 [12.65, 13.09] | 106 | 335 |
| diskann_vamana | 0.995 | 1458.8 | 10 | 0.9908 | no / no | 11.46 [11.30, 12.07] | 106 | 333 |
| faiss_exact | 0.98 | 1559.7 | 10 | 1.0000 | yes / yes | 13.91 [13.81, 14.19] | 83 | 216 |
| faiss_exact | 0.99 | 1559.7 | 10 | 1.0000 | yes / yes | 13.91 [13.81, 14.19] | 83 | 216 |
| faiss_exact | 0.995 | 1559.7 | 10 | 1.0000 | yes / yes | 12.25 [12.17, 12.90] | 83 | 216 |
| faiss_hnsw_flat | 0.98 | 399.8 | 10 | 0.9809 | yes / no | 3.57 [3.53, 3.64] | 89 | 234 |
| faiss_hnsw_flat | 0.99 | 751.7 | 10 | 0.9934 | yes / no | 6.71 [6.65, 7.01] | 89 | 235 |
| faiss_hnsw_flat | 0.995 | 1270.0 | 10 | 0.9963 | yes / no | 9.98 [9.83, 10.45] | 86 | 225 |
| faiss_hnsw_sq8 | 0.98 | 203.8 | 10 | 0.9810 | yes / no | 1.82 [1.79, 1.84] | 105 | 416 |
| faiss_hnsw_sq8 | 0.99 | 373.8 | 10 | 0.9971 | yes / yes | 3.33 [3.30, 3.38] | 105 | 414 |
| faiss_hnsw_sq8 | 0.995 | 747.1 | 10 | 0.9975 | yes / no | 5.87 [5.77, 6.16] | 105 | 414 |
| faiss_ivfpq_fs | 0.98 | 103.7 | 10 | 1.0013 | yes / yes | 0.93 [0.92, 0.94] | 88 | 369 |
| faiss_ivfpq_fs | 0.99 | 103.7 | 10 | 1.0013 | yes / yes | 0.93 [0.92, 0.94] | 88 | 369 |
| faiss_ivfpq_fs | 0.995 | 103.7 | 10 | 1.0013 | yes / yes | 0.81 [0.81, 0.86] | 88 | 369 |
| faiss_rabitq_flat | 0.98 | 243.4 | 10 | 0.9851 | yes / no | 2.17 [2.16, 2.20] | 85 | 349 |
| faiss_rabitq_flat | 0.99 | 243.4 | 10 | 0.9851 | no / no | 2.17 [2.16, 2.20] | 85 | 349 |
| faiss_rabitq_flat | 0.995 | 274.9 | 10 | 0.9995 | yes / yes | 2.16 [2.15, 2.28] | 85 | 348 |
| faiss_rabitq_hnsw | 0.98 | 209.6 | 10 | 0.9878 | yes / no | 1.87 [1.86, 1.90] | 97 | 388 |
| faiss_rabitq_hnsw | 0.99 | 209.6 | 10 | 0.9878 | no / no | 1.87 [1.86, 1.90] | 97 | 388 |
| faiss_rabitq_hnsw | 0.995 | 392.0 | 10 | 1.0022 | yes / yes | 3.08 [3.04, 3.23] | 97 | 389 |
| faiss_rabitq_ivf | 0.98 | 321.2 | 10 | 1.0005 | yes / yes | 2.87 [2.85, 2.90] | 86 | 360 |
| faiss_rabitq_ivf | 0.99 | 321.2 | 10 | 1.0005 | yes / yes | 2.87 [2.85, 2.90] | 86 | 360 |
| faiss_rabitq_ivf | 0.995 | 321.2 | 10 | 1.0005 | yes / yes | 2.52 [2.51, 2.66] | 86 | 360 |
| hnswlib_f32 | 0.98 | 614.3 | 10 | 0.9897 | yes / no | 5.48 [5.40, 5.72] | 89 | 202 |
| hnswlib_f32 | 0.99 | 1152.5 | 10 | 0.9884 | no / no | 10.28 [10.04, 10.56] | 89 | 204 |
| hnswlib_f32 | 0.995 | 1296.4 | 10 | 0.9921 | no / no | 10.18 [9.88, 10.56] | 92 | 210 |
| ours_cascade | 0.98 | 112.1 | 10 | 0.9960 | yes / yes |  | 176 | 457 |
| ours_cascade | 0.99 | 112.1 | 10 | 0.9960 | yes / no |  | 176 | 457 |
| ours_cascade | 0.995 | 127.3 | 10 | 0.9964 | yes / no |  | 176 | 632 |
| scann | 0.98 | 264.7 | 10 | 0.9991 | yes / yes | 2.36 [2.35, 2.39] | 127 | 392 |
| scann | 0.99 | 264.7 | 10 | 0.9991 | yes / yes | 2.36 [2.35, 2.39] | 127 | 392 |
| scann | 0.995 | 264.7 | 10 | 0.9991 | yes / yes | 2.08 [2.07, 2.20] | 127 | 392 |
| usearch_f16 | 0.98 | 639.6 | 10 | 0.9861 | yes / no | 5.71 [5.61, 5.85] | 56 | 154 |
| usearch_f16 | 0.99 | 1443.3 | 10 | 0.9934 | yes / no | 12.87 [12.60, 13.10] | 64 | 189 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 528.1 / 0.9717 | 589.8 / 0.9717 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2542.7 / 1.0000 | 2604.7 / 1.0000 | 3660.8 / 1.0000 |
| diskann_vamana | L 200 | 823.2 / 0.9863 | 882.3 / 0.9862 | 838.7 / 0.9863 | 899.5 / 0.9862 | 1020.5 / 0.9862 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3715.1 / 1.0004 | 3793.2 / 0.9999 | 4850.3 / 0.9999 |
| diskann_vamana | L 400 |  |  | 1328.5 / 0.9908 | 1393.3 / 0.9908 | 1527.4 / 0.9908 | 1377.3 / 0.9908 | 1434.8 / 0.9908 | 1780.3 / 0.9908 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2124.6 / 0.9963 | 2181.6 / 0.9963 | 2557.4 / 0.9962 |  |  |  |
| faiss_bin_flat | exhaustive | 119.2 / 0.9638 | 167.2 / 0.9638 | 153.0 / 0.9837 | 201.8 / 0.9837 | 298.6 / 0.9837 | 219.5 / 0.9978 | 269.7 / 0.9978 | 564.3 / 0.9978 | 402.1 / 0.9960 | 451.1 / 0.9959 | 1350.0 / 0.9959 |
| faiss_bin_hnsw | ef 100 | 131.2 / 0.8978 | 181.4 / 0.8978 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 871.1 / 0.9980 | 926.9 / 0.9979 | 1895.7 / 0.9979 |
| faiss_bin_hnsw | ef 200 | 186.5 / 0.9375 | 235.5 / 0.9375 | 211.4 / 0.9586 | 262.6 / 0.9586 | 363.9 / 0.9586 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1623.4 / 0.9957 | 1679.5 / 0.9956 | 2655.1 / 0.9956 |
| faiss_bin_hnsw | ef 400 |  |  | 323.6 / 0.9848 | 375.7 / 0.9848 | 476.5 / 0.9848 | 370.7 / 0.9940 | 423.8 / 0.9940 | 738.5 / 0.9940 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 604.3 / 0.9991 | 654.3 / 0.9991 | 972.3 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 100 | 258.4 / 0.9494 | 316.2 / 0.9494 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1769.3 / 0.9941 | 1853.1 / 0.9937 | 2871.4 / 0.9936 |
| faiss_hnsw_flat | ef 200 | 408.0 / 0.9693 | 471.0 / 0.9693 | 435.7 / 0.9693 | 499.7 / 0.9693 | 610.2 / 0.9693 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3091.5 / 0.9954 | 3177.9 / 0.9950 | 4187.8 / 0.9950 |
| faiss_hnsw_flat | ef 400 |  |  | 722.0 / 0.9934 | 788.9 / 0.9934 | 900.1 / 0.9934 | 790.4 / 0.9934 | 849.5 / 0.9934 | 1191.0 / 0.9934 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1333.9 / 0.9941 | 1391.0 / 0.9937 | 1736.1 / 0.9936 |  |  |  |
| faiss_rabitq_flat | exhaustive | 319.4 / 1.0003 | 367.3 / 1.0003 | 347.4 / 1.0004 | 394.7 / 0.9999 | 490.5 / 0.9999 | 399.0 / 1.0004 | 447.6 / 0.9999 | 738.6 / 0.9999 | 530.9 / 1.0004 | 580.7 / 0.9999 | 1475.6 / 0.9999 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 104.3 / 0.4793 | 151.3 / 0.4793 | 244.3 / 0.4793 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 156.6 / 0.6648 | 204.0 / 0.6648 | 490.0 / 0.6648 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 251.5 / 0.6955 | 302.2 / 0.6955 | 1167.8 / 0.6955 |
| faiss_rabitq_ivf | nprobe 3 | 72.2 / 0.2970 | 118.4 / 0.2966 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 322.3 / 0.8188 | 371.4 / 0.8188 | 1253.9 / 0.8188 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 90.4 / 0.3626 | 136.7 / 0.3626 | 230.0 / 0.3626 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 80.1 / 0.3899 | 126.7 / 0.3899 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 129.2 / 0.4555 | 176.0 / 0.4555 | 458.2 / 0.4555 |  |  |  |
| hnswlib_f32 | ef 100 | 253.9 / 0.9497 | 309.8 / 0.9497 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1550.2 / 0.9921 | 1656.7 / 0.9921 | 2713.2 / 0.9920 |
| hnswlib_f32 | ef 200 | 403.1 / 0.9783 | 458.3 / 0.9782 | 419.9 / 0.9783 | 476.0 / 0.9782 | 573.8 / 0.9782 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2500.5 / 1.0005 | 2621.7 / 1.0001 | 3677.8 / 1.0001 |
| hnswlib_f32 | ef 400 |  |  | 699.2 / 0.9906 | 748.8 / 0.9906 | 847.0 / 0.9906 | 733.3 / 0.9906 | 770.4 / 0.9906 | 1147.6 / 0.9906 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1231.3 / 0.9924 | 1262.2 / 0.9924 | 1650.9 / 0.9923 |  |  |  |
| ours_scan | ef 100 | 62.9 / 0.9592 | 72.9 / 0.9592 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 101.6 / 0.9965 | 111.8 / 0.9964 | 325.6 / 0.9964 |
| ours_scan | ef 200 |  |  | 67.5 / 0.9841 | 78.1 / 0.9841 | 97.7 / 0.9841 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 77.5 / 0.9985 | 88.0 / 0.9985 | 147.8 / 0.9985 |  |  |  |
| ours_walk | ef 100 | 55.7 / 0.9332 | 65.4 / 0.9332 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 135.5 / 0.9951 | 150.3 / 0.9951 | 379.2 / 0.9951 |
| ours_walk | ef 200 | 63.5 / 0.9504 | 73.0 / 0.9504 | 67.6 / 0.9716 | 77.6 / 0.9716 | 98.3 / 0.9716 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 166.2 / 0.9956 | 180.8 / 0.9956 | 411.2 / 0.9956 |
| ours_walk | ef 400 |  |  | 82.5 / 0.9819 | 93.0 / 0.9819 | 114.1 / 0.9819 | 89.8 / 0.9924 | 100.5 / 0.9924 | 166.8 / 0.9924 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 108.4 / 0.9964 | 119.5 / 0.9964 | 187.6 / 0.9964 |  |  |  |
| scann | reorder 100 | 348.3 / 0.9994 | 386.9 / 0.9994 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 727.7 / 1.0004 | 776.3 / 0.9999 | 1545.2 / 0.9999 |
| scann | reorder 200 |  |  | 393.2 / 1.0004 | 436.3 / 0.9999 | 513.8 / 0.9999 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 479.3 / 1.0004 | 524.1 / 0.9999 | 771.1 / 0.9999 |  |  |  |
| usearch_b1_rescore | ef 100 | 114.2 / 0.8882 | 163.4 / 0.8882 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 588.1 / 0.9958 | 643.6 / 0.9957 | 1596.3 / 0.9957 |
| usearch_b1_rescore | ef 200 | 166.3 / 0.9450 | 215.9 / 0.9450 | 171.9 / 0.9646 | 221.8 / 0.9646 | 323.4 / 0.9646 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 987.5 / 0.9963 | 1046.3 / 0.9962 | 2007.9 / 0.9962 |
| usearch_b1_rescore | ef 400 |  |  | 268.9 / 0.9936 | 321.3 / 0.9936 | 419.7 / 0.9936 | 281.4 / 0.9979 | 332.8 / 0.9979 | 642.7 / 0.9979 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 468.6 / 0.9981 | 521.7 / 0.9981 | 834.1 / 0.9981 |  |  |  |

### advtest / jina-v2-base-code (n_ho = 1200, exact quality 0.3577)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 182.2 | 10 | 0.9860 | yes / no | 2.39 [2.36, 2.45] | 108 | 340 |
| diskann_vamana | 0.99 | 263.5 | 10 | 0.9911 | yes / no | 3.46 [3.42, 3.58] | 108 | 339 |
| diskann_vamana | 0.995 | 371.3 | 10 | 0.9954 | yes / no | 4.28 [4.20, 4.40] | 103 | 321 |
| faiss_bin_flat | 0.98 | 69.8 | 10 | 1.0013 | yes / yes | 0.92 [0.91, 0.93] | 84 | 343 |
| faiss_bin_flat | 0.99 | 69.8 | 10 | 1.0013 | yes / yes | 0.92 [0.91, 0.93] | 84 | 343 |
| faiss_bin_flat | 0.995 | 69.8 | 10 | 1.0013 | yes / yes | 0.81 [0.80, 0.82] | 84 | 343 |
| faiss_bin_hnsw | 0.98 | 68.0 | 10 | 0.9950 | yes / yes | 0.89 [0.88, 0.91] | 90 | 363 |
| faiss_bin_hnsw | 0.99 | 97.3 | 10 | 0.9987 | yes / yes | 1.28 [1.26, 1.30] | 90 | 363 |
| faiss_bin_hnsw | 0.995 | 145.7 | 10 | 0.9987 | yes / no | 1.68 [1.66, 1.71] | 90 | 364 |
| faiss_exact | 0.98 | 1526.4 | 10 | 1.0000 | yes / yes | 20.04 [19.80, 20.67] | 83 | 214 |
| faiss_exact | 0.99 | 1526.4 | 10 | 1.0000 | yes / yes | 20.04 [19.80, 20.67] | 83 | 214 |
| faiss_exact | 0.995 | 1526.4 | 10 | 1.0000 | yes / yes | 17.60 [17.35, 18.11] | 83 | 214 |
| faiss_hnsw_flat | 0.98 | 97.2 | 10 | 0.9951 | yes / yes | 1.28 [1.26, 1.32] | 94 | 249 |
| faiss_hnsw_flat | 0.99 | 134.4 | 10 | 0.9880 | no / no | 1.76 [1.74, 1.81] | 94 | 249 |
| faiss_hnsw_flat | 0.995 | 166.7 | 10 | 0.9956 | yes / no | 1.92 [1.89, 1.98] | 94 | 251 |
| faiss_hnsw_sq8 | 0.98 | 49.6 | 10 | 0.9889 | yes / no | 0.65 [0.64, 0.66] | 105 | 411 |
| faiss_hnsw_sq8 | 0.99 | 73.4 | 10 | 0.9892 | no / no | 0.96 [0.95, 0.98] | 111 | 428 |
| faiss_hnsw_sq8 | 0.995 | 108.1 | 10 | 0.9977 | yes / no | 1.25 [1.23, 1.27] | 103 | 405 |
| faiss_ivfpq_fs | 0.98 | 60.0 | 10 | 0.9970 | yes / yes | 0.79 [0.78, 0.80] | 87 | 368 |
| faiss_ivfpq_fs | 0.99 | 60.0 | 10 | 0.9970 | yes / yes | 0.79 [0.78, 0.80] | 87 | 368 |
| faiss_ivfpq_fs | 0.995 | 68.2 | 10 | 0.9970 | yes / no | 0.79 [0.78, 0.80] | 88 | 368 |
| faiss_rabitq_flat | 0.98 | 242.4 | 10 | 0.9971 | yes / yes | 3.18 [3.15, 3.24] | 85 | 349 |
| faiss_rabitq_flat | 0.99 | 242.4 | 10 | 0.9971 | yes / yes | 3.18 [3.15, 3.24] | 85 | 349 |
| faiss_rabitq_flat | 0.995 | 242.4 | 10 | 0.9971 | yes / no | 2.80 [2.76, 2.84] | 85 | 349 |
| faiss_rabitq_hnsw | 0.98 | 77.9 | 10 | 0.9937 | yes / yes | 1.02 [1.01, 1.04] | 97 | 389 |
| faiss_rabitq_hnsw | 0.99 | 129.4 | 10 | 0.9986 | yes / yes | 1.70 [1.68, 1.73] | 97 | 387 |
| faiss_rabitq_hnsw | 0.995 | 203.0 | 10 | 0.9998 | yes / yes | 2.34 [2.31, 2.38] | 97 | 388 |
| faiss_rabitq_ivf | 0.98 | 156.5 | 10 | 0.9970 | yes / yes | 2.06 [2.04, 2.09] | 86 | 360 |
| faiss_rabitq_ivf | 0.99 | 156.5 | 10 | 0.9970 | yes / yes | 2.06 [2.04, 2.09] | 86 | 360 |
| faiss_rabitq_ivf | 0.995 | 279.8 | 10 | 1.0001 | yes / yes | 3.23 [3.18, 3.28] | 88 | 360 |
| hnswlib_f32 | 0.98 | 97.4 | 10 | 0.9848 | yes / no | 1.28 [1.26, 1.31] | 92 | 208 |
| hnswlib_f32 | 0.99 | 176.8 | 10 | 0.9971 | yes / yes | 2.32 [2.27, 2.38] | 97 | 224 |
| hnswlib_f32 | 0.995 | 207.1 | 10 | 0.9960 | yes / no | 2.39 [2.34, 2.45] | 89 | 201 |
| ours_cascade | 0.98 | 76.2 | 10 | 0.9987 | yes / yes |  | 174 | 127 |
| ours_cascade | 0.99 | 76.2 | 10 | 0.9987 | yes / yes |  | 174 | 127 |
| ours_cascade | 0.995 | 86.7 | 10 | 1.0008 | yes / yes |  | 167 | 183 |
| scann | 0.98 | 266.8 | 10 | 1.0000 | yes / yes | 3.50 [3.47, 3.56] | 127 | 393 |
| scann | 0.99 | 266.8 | 10 | 1.0000 | yes / yes | 3.50 [3.47, 3.56] | 127 | 393 |
| scann | 0.995 | 266.8 | 10 | 1.0000 | yes / yes | 3.08 [3.04, 3.13] | 127 | 393 |
| usearch_b1_rescore | 0.98 | 58.6 | 10 | 0.9884 | yes / no | 0.77 [0.76, 0.78] | 92 | 362 |
| usearch_b1_rescore | 0.99 | 83.9 | 10 | 0.9967 | yes / no | 1.10 [1.09, 1.12] | 92 | 362 |
| usearch_b1_rescore | 0.995 | 216.5 | 10 | 0.9955 | yes / no | 2.50 [2.46, 2.54] | 92 | 364 |
| usearch_f16 | 0.98 | 137.1 | 10 | 0.9882 | yes / no | 1.80 [1.78, 1.84] | 55 | 151 |
| usearch_f16 | 0.99 | 175.0 | 10 | 0.9914 | yes / no | 2.30 [2.27, 2.37] | 58 | 162 |
| usearch_f16 | 0.995 | 242.8 | 10 | 0.9937 | no / no | 2.80 [2.76, 2.85] | 55 | 152 |
| usearch_i8 | 0.98 | 76.6 | 10 | 0.9942 | yes / no | 1.01 [1.00, 1.03] | 42 | 95 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 527.2 / 0.9977 | 586.3 / 0.9977 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2497.6 / 1.0000 | 2555.5 / 1.0000 | 3607.0 / 1.0000 |
| diskann_vamana | L 200 | 809.6 / 1.0000 | 870.3 / 1.0000 | 829.8 / 1.0000 | 889.5 / 1.0000 | 1004.0 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3668.8 / 1.0000 | 3709.9 / 1.0000 | 4800.7 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1294.0 / 1.0000 | 1354.1 / 1.0000 | 1477.4 / 1.0000 | 1329.4 / 1.0000 | 1397.8 / 1.0000 | 1752.2 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2070.0 / 1.0000 | 2141.9 / 1.0000 | 2490.2 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 121.5 / 1.0005 | 170.7 / 1.0005 | 154.1 / 0.9999 | 205.4 / 0.9999 | 305.8 / 0.9999 | 220.8 / 0.9997 | 271.9 / 0.9997 | 577.4 / 0.9997 | 403.8 / 1.0000 | 454.5 / 1.0000 | 1379.3 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 132.7 / 0.9964 | 185.9 / 0.9964 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 829.0 / 1.0000 | 885.6 / 1.0000 | 1909.6 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 185.2 / 0.9996 | 238.6 / 0.9996 | 207.6 / 0.9993 | 263.4 / 0.9993 | 372.6 / 0.9993 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1559.6 / 1.0000 | 1627.4 / 1.0000 | 2646.6 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 311.2 / 0.9981 | 367.0 / 0.9981 | 477.3 / 0.9981 | 354.5 / 0.9974 | 413.4 / 0.9974 | 747.3 / 0.9974 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 572.0 / 0.9997 | 629.3 / 0.9997 | 967.4 / 0.9997 |  |  |  |
| faiss_hnsw_flat | ef 100 | 313.2 / 0.9999 | 371.1 / 0.9999 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1958.4 / 1.0000 | 2033.8 / 1.0000 | 3065.4 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 494.7 / 1.0001 | 555.7 / 1.0001 | 521.2 / 1.0001 | 588.4 / 1.0001 | 704.2 / 1.0001 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3309.5 / 1.0000 | 3398.6 / 1.0000 | 4415.6 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 851.2 / 1.0000 | 917.0 / 1.0000 | 1035.5 / 1.0000 | 928.2 / 1.0000 | 983.0 / 1.0000 | 1323.4 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1503.9 / 1.0000 | 1572.3 / 1.0000 | 1914.2 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 321.2 / 1.0000 | 371.0 / 1.0000 | 348.2 / 1.0000 | 398.2 / 1.0000 | 497.7 / 1.0000 | 398.5 / 1.0000 | 449.5 / 1.0000 | 753.0 / 1.0000 | 529.0 / 1.0000 | 581.0 / 1.0000 | 1511.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 114.1 / 0.8566 | 165.4 / 0.8566 | 265.7 / 0.8566 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 168.2 / 0.9088 | 220.3 / 0.9088 | 527.2 / 0.9088 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 277.7 / 0.9190 | 329.1 / 0.9190 | 1260.5 / 0.9190 |
| faiss_rabitq_ivf | nprobe 3 | 79.8 / 0.6559 | 129.5 / 0.6559 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 341.0 / 0.9747 | 394.1 / 0.9747 | 1326.7 / 0.9747 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 99.9 / 0.7737 | 150.3 / 0.7737 | 251.7 / 0.7737 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 88.2 / 0.7887 | 137.9 / 0.7887 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 142.1 / 0.8431 | 193.7 / 0.8431 | 500.4 / 0.8431 |  |  |  |
| hnswlib_f32 | ef 100 | 324.5 / 0.9983 | 382.9 / 0.9983 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1834.1 / 1.0000 | 1941.1 / 1.0000 | 3022.1 / 1.0000 |
| hnswlib_f32 | ef 200 | 515.1 / 1.0000 | 570.6 / 1.0000 | 535.8 / 1.0000 | 597.2 / 1.0000 | 699.8 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2844.0 / 1.0000 | 2978.9 / 1.0000 | 4040.4 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 871.8 / 1.0000 | 928.7 / 1.0000 | 1028.0 / 1.0000 | 924.7 / 1.0000 | 953.1 / 1.0000 | 1338.7 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1481.9 / 1.0000 | 1510.3 / 1.0000 | 1917.3 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 64.0 / 1.0008 | 75.9 / 1.0008 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 102.6 / 1.0000 | 112.9 / 1.0000 | 355.9 / 1.0000 |
| ours_scan | ef 200 |  |  | 68.6 / 1.0004 | 80.9 / 1.0004 | 105.0 / 1.0004 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 78.2 / 0.9997 | 90.3 / 0.9997 | 160.4 / 0.9997 |  |  |  |
| ours_walk | ef 100 | 52.7 / 1.0006 | 65.0 / 1.0006 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 124.6 / 1.0000 | 138.8 / 1.0000 | 391.1 / 1.0000 |
| ours_walk | ef 200 | 61.1 / 1.0013 | 73.7 / 1.0013 | 64.6 / 1.0005 | 77.0 / 1.0005 | 101.7 / 1.0005 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 159.8 / 1.0000 | 175.9 / 1.0000 | 431.6 / 1.0000 |
| ours_walk | ef 400 |  |  | 75.3 / 1.0005 | 88.1 / 1.0005 | 113.2 / 1.0005 | 81.1 / 0.9997 | 95.1 / 0.9997 | 170.1 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 98.5 / 0.9997 | 112.2 / 0.9997 | 191.0 / 0.9997 |  |  |  |
| scann | reorder 100 | 364.2 / 1.0000 | 408.9 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 801.0 / 1.0000 | 855.4 / 1.0000 | 1709.8 / 1.0000 |
| scann | reorder 200 |  |  | 415.8 / 1.0000 | 466.9 / 1.0000 | 557.3 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 515.7 / 1.0000 | 566.4 / 1.0000 | 848.6 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 114.9 / 0.9920 | 168.0 / 0.9920 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 552.0 / 0.9946 | 610.4 / 0.9946 | 1602.4 / 0.9946 |
| usearch_b1_rescore | ef 200 | 162.4 / 0.9960 | 216.1 / 0.9960 | 168.1 / 0.9962 | 224.9 / 0.9962 | 332.3 / 0.9962 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 930.9 / 0.9946 | 982.3 / 0.9946 | 1998.2 / 0.9946 |
| usearch_b1_rescore | ef 400 |  |  | 266.9 / 0.9957 | 322.7 / 0.9957 | 430.6 / 0.9957 | 278.5 / 0.9955 | 334.9 / 0.9955 | 663.1 / 0.9955 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 438.8 / 0.9943 | 496.3 / 0.9943 | 826.7 / 0.9943 |  |  |  |

### csn1m / CodeRankEmbed (n_ho = 2400, exact quality 0.5497)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 1357.3 | 10 | 0.9928 | yes / yes | 7.14 [6.93, 7.30] | 3425 | 13833 |
| diskann_vamana | 0.99 | 2392.5 | 10 | 0.9974 | yes / yes | 8.94 [8.76, 9.20] | 3425 | 13847 |
| diskann_vamana | 0.995 | 3743.4 | 10 | 0.9968 | yes / no | 11.28 [10.93, 11.62] | 3383 | 13674 |
| faiss_bin_flat | 0.98 | 1869.0 | 10 | 0.9914 | yes / yes | 9.83 [9.77, 10.10] | 3064 | 15443 |
| faiss_bin_flat | 0.99 | 1941.3 | 10 | 0.9942 | yes / no | 7.25 [7.20, 7.43] | 3064 | 15438 |
| faiss_bin_flat | 0.995 | 2106.4 | 10 | 0.9969 | yes / no | 6.35 [6.19, 6.42] | 3064 | 15444 |
| faiss_bin_hnsw | 0.98 | 1231.9 | 10 | 0.9935 | yes / yes | 6.48 [6.37, 6.68] | 3559 | 17030 |
| faiss_bin_hnsw | 0.99 | 1963.4 | 10 | 0.9946 | yes / no | 7.34 [7.27, 7.60] | 3559 | 17040 |
| faiss_bin_hnsw | 0.995 | 4950.7 | 10 | 0.9971 | yes / no | 14.92 [14.45, 15.16] | 3559 | 17052 |
| faiss_exact | 0.98 | 74675.9 | 10 | 1.0000 | yes / yes | 392.66 [368.73, 400.22] | 2971 | 9180 |
| faiss_exact | 0.99 | 74675.9 | 10 | 1.0000 | yes / yes | 279.04 [261.92, 284.86] | 2971 | 9180 |
| faiss_exact | 0.995 | 74675.9 | 10 | 1.0000 | yes / yes | 225.05 [209.72, 228.27] | 2971 | 9180 |
| faiss_hnsw_flat | 0.98 | 804.5 | 10 | 0.9912 | yes / yes | 4.23 [4.20, 4.33] | 3233 | 9926 |
| faiss_hnsw_flat | 0.99 | 1140.6 | 10 | 0.9965 | yes / yes | 4.26 [4.19, 4.44] | 3479 | 10692 |
| faiss_hnsw_flat | 0.995 | 1499.5 | 10 | 0.9969 | yes / no | 4.52 [4.40, 4.61] | 3478 | 10695 |
| faiss_hnsw_sq8 | 0.98 | 537.5 | 10 | 0.9905 | yes / yes | 2.83 [2.78, 2.88] | 3989 | 18352 |
| faiss_hnsw_sq8 | 0.99 | 927.4 | 10 | 0.9974 | yes / yes | 3.47 [3.42, 3.58] | 4234 | 19136 |
| faiss_hnsw_sq8 | 0.995 | 1729.5 | 10 | 0.9986 | yes / yes | 5.21 [5.05, 5.34] | 4234 | 19118 |
| faiss_ivfpq_fs | 0.98 | 2447.5 | 10 | 0.9909 | yes / yes | 12.87 [12.58, 13.20] | 3107 | 15620 |
| faiss_ivfpq_fs | 0.99 | 2699.6 | 10 | 0.9940 | yes / no | 10.09 [9.77, 10.41] | 3088 | 15587 |
| faiss_ivfpq_fs | 0.995 | 4393.8 | 10 | 0.9963 | yes / no | 13.24 [12.86, 13.99] | 3107 | 15635 |
| faiss_rabitq_flat | 0.98 | 10878.1 | 10 | 1.0001 | yes / yes | 57.20 [56.87, 58.82] | 3102 | 15572 |
| faiss_rabitq_flat | 0.99 | 10878.1 | 10 | 1.0001 | yes / yes | 40.65 [40.39, 41.84] | 3102 | 15572 |
| faiss_rabitq_flat | 0.995 | 10878.1 | 10 | 1.0001 | yes / yes | 32.78 [32.18, 33.52] | 3102 | 15572 |
| faiss_rabitq_hnsw | 0.98 | 706.2 | 10 | 0.9873 | yes / no | 3.71 [3.64, 3.77] | 3598 | 17169 |
| faiss_rabitq_hnsw | 0.99 | 1303.8 | 10 | 0.9942 | yes / no | 4.87 [4.75, 5.03] | 3598 | 17170 |
| faiss_rabitq_hnsw | 0.995 | 2450.7 | 10 | 0.9973 | yes / no | 7.39 [7.19, 7.47] | 3598 | 17143 |
| faiss_rabitq_ivf | 0.98 | 4344.8 | 10 | 0.9908 | yes / yes | 22.85 [22.64, 23.21] | 3091 | 15624 |
| faiss_rabitq_ivf | 0.99 | 6264.6 | 10 | 0.9938 | yes / no | 23.41 [23.22, 23.99] | 3082 | 15607 |
| faiss_rabitq_ivf | 0.995 | 8223.2 | 10 | 0.9962 | yes / no | 24.78 [24.21, 25.05] | 3091 | 15636 |
| hnswlib_f32 | 0.98 | 653.8 | 10 | 0.9920 | yes / yes | 3.44 [3.37, 3.57] | 3573 | 10237 |
| hnswlib_f32 | 0.99 | 1195.1 | 10 | 0.9990 | yes / yes | 4.47 [4.42, 4.71] | 3573 | 10217 |
| hnswlib_f32 | 0.995 | 1642.5 | 10 | 0.9987 | yes / yes | 4.95 [4.83, 5.02] | 3573 | 10218 |
| ours_cascade | 0.98 | 190.2 | 10 | 0.9899 | yes / yes |  | 3927 | 2987 |
| ours_cascade | 0.99 | 267.6 | 10 | 0.9957 | yes / yes |  | 3929 | 3120 |
| ours_cascade | 0.995 | 331.8 | 10 | 0.9976 | yes / no |  | 3930 | 3250 |
| scann | 0.98 | 2308.4 | 10 | 0.9904 | yes / yes | 12.14 [12.06, 12.32] | 3400 | 14265 |
| scann | 0.99 | 6102.3 | 10 | 0.9926 | yes / no | 22.80 [22.63, 23.24] | 3224 | 11808 |
| scann | 0.995 | 6621.1 | 10 | 0.9962 | yes / no | 19.95 [19.48, 20.11] | 3246 | 11808 |
| usearch_b1_rescore | 0.98 | 1062.8 | 10 | 0.9834 | yes / no | 5.59 [5.52, 5.71] | 3407 | 16369 |
| usearch_b1_rescore | 0.99 | 2299.6 | 10 | 0.9959 | yes / yes | 8.59 [8.49, 8.80] | 3652 | 17104 |
| usearch_f16 | 0.98 | 1770.1 | 10 | 0.9912 | yes / yes | 9.31 [9.08, 9.58] | 1867 | 7018 |
| usearch_f16 | 0.99 | 3268.9 | 10 | 0.9945 | yes / no | 12.21 [11.82, 12.71] | 1867 | 7011 |
| usearch_f16 | 0.995 | 6164.3 | 10 | 0.9995 | yes / yes | 18.58 [18.05, 19.07] | 2112 | 7743 |
| usearch_i8 | 0.98 | 1258.6 | 10 | 0.9873 | yes / no | 6.62 [6.50, 6.84] | 1376 | 4682 |
| usearch_i8 | 0.99 | 2246.3 | 10 | 0.9936 | yes / no | 8.39 [8.27, 8.77] | 1131 | 3936 |
| usearch_i8 | 0.995 | 7771.1 | 10 | 0.9958 | yes / no | 23.42 [22.63, 24.56] | 1131 | 3946 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1531.1 / 0.9930 | 1599.2 / 0.9932 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 10931.1 / 0.9998 | 11038.5 / 0.9998 | 12321.4 / 0.9998 |
| diskann_vamana | L 200 | 2672.9 / 0.9953 | 2746.7 / 0.9953 | 2723.2 / 0.9952 | 2777.3 / 0.9953 | 2921.4 / 0.9953 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 19753.5 / 0.9998 | 19767.2 / 0.9998 | 21049.6 / 0.9998 |
| diskann_vamana | L 400 |  |  | 4815.0 / 0.9990 | 4853.8 / 0.9991 | 5033.6 / 0.9991 | 4943.1 / 0.9990 | 4966.2 / 0.9991 | 5338.6 / 0.9991 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 8793.2 / 0.9998 | 8819.9 / 0.9998 | 9254.5 / 0.9998 |  |  |  |
| faiss_bin_flat | exhaustive | 1982.5 / 0.9913 | 2053.7 / 0.9913 | 2061.8 / 0.9943 | 2130.2 / 0.9943 | 2269.5 / 0.9943 | 2252.4 / 0.9977 | 2297.2 / 0.9977 | 2701.8 / 0.9977 | 2877.0 / 0.9999 | 2940.0 / 0.9998 | 4096.5 / 0.9998 |
| faiss_bin_hnsw | ef 100 | 431.9 / 0.9540 | 502.3 / 0.9540 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3352.4 / 0.9946 | 3392.7 / 0.9946 | 4624.8 / 0.9946 |
| faiss_bin_hnsw | ef 200 | 714.3 / 0.9718 | 782.5 / 0.9718 | 759.5 / 0.9743 | 830.9 / 0.9743 | 972.2 / 0.9743 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 6187.5 / 0.9995 | 6295.0 / 0.9995 | 7510.1 / 0.9995 |
| faiss_bin_hnsw | ef 400 |  |  | 1306.8 / 0.9833 | 1385.1 / 0.9833 | 1518.5 / 0.9833 | 1410.4 / 0.9872 | 1470.8 / 0.9871 | 1888.9 / 0.9871 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2493.2 / 0.9928 | 2548.3 / 0.9927 | 2971.1 / 0.9927 |  |  |  |
| faiss_hnsw_flat | ef 100 | 766.8 / 0.9892 | 846.6 / 0.9892 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 5954.6 / 1.0000 | 6031.5 / 1.0000 | 7218.7 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1343.7 / 0.9951 | 1406.7 / 0.9951 | 1394.3 / 0.9952 | 1450.0 / 0.9951 | 1601.7 / 0.9951 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 10907.6 / 1.0000 | 10989.1 / 1.0000 | 12270.4 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2469.3 / 0.9991 | 2548.1 / 0.9991 | 2669.0 / 0.9991 | 2565.3 / 0.9991 | 2638.3 / 0.9991 | 3054.1 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4615.2 / 1.0000 | 4689.6 / 1.0000 | 5120.7 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 11138.8 / 0.9999 | 11287.2 / 1.0000 | 11272.3 / 1.0000 | 11277.3 / 1.0000 | 11408.0 / 1.0000 | 11360.8 / 1.0000 | 11422.9 / 1.0000 | 11893.8 / 1.0000 | 11822.7 / 1.0000 | 11808.9 / 1.0000 | 13012.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 155.1 / 0.4390 | 221.3 / 0.4390 | 187.1 / 0.4390 | 253.7 / 0.4390 | 387.0 / 0.4390 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 174.9 / 0.5791 | 239.7 / 0.5790 | 210.4 / 0.5790 | 277.5 / 0.5790 | 409.1 / 0.5790 | 277.4 / 0.5790 | 347.0 / 0.5790 | 747.0 / 0.5790 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 491.6 / 0.6485 | 560.6 / 0.6485 | 1772.1 / 0.6485 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 322.4 / 0.7009 | 391.6 / 0.7009 | 789.0 / 0.7009 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 568.3 / 0.7542 | 636.2 / 0.7542 | 1852.3 / 0.7542 |
| hnswlib_f32 | ef 100 | 706.5 / 0.9903 | 779.7 / 0.9903 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 5571.2 / 0.9996 | 5694.1 / 0.9996 | 6753.0 / 0.9996 |
| hnswlib_f32 | ef 200 | 1269.5 / 0.9950 | 1315.4 / 0.9950 | 1264.7 / 0.9949 | 1339.2 / 0.9949 | 1453.7 / 0.9950 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 9829.8 / 1.0000 | 9875.8 / 1.0000 | 10998.9 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 2309.8 / 0.9979 | 2417.8 / 0.9980 | 2515.0 / 0.9980 | 2406.0 / 0.9980 | 2471.2 / 0.9980 | 2905.6 / 0.9980 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 4308.3 / 0.9986 | 4354.3 / 0.9986 | 4882.8 / 0.9986 |  |  |  |
| ours_scan | ef 100 | 112.2 / 0.9781 | 125.2 / 0.9781 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 441.3 / 0.9980 | 452.0 / 0.9980 | 747.1 / 0.9980 |
| ours_scan | ef 200 |  |  | 157.5 / 0.9900 | 173.6 / 0.9899 | 199.5 / 0.9899 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 227.8 / 0.9958 | 238.0 / 0.9957 | 329.8 / 0.9957 |  |  |  |
| ours_walk | ef 100 | 112.1 / 0.9781 | 124.7 / 0.9781 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 440.2 / 0.9980 | 452.8 / 0.9980 | 766.2 / 0.9980 |
| ours_walk | ef 200 | 150.0 / 0.9861 | 159.1 / 0.9861 | 192.1 / 0.9900 | 182.5 / 0.9899 | 267.1 / 0.9899 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 689.2 / 0.9997 | 698.0 / 0.9996 | 1013.0 / 0.9996 |
| ours_walk | ef 400 |  |  | 246.7 / 0.9924 | 301.6 / 0.9923 | 372.6 / 0.9923 | 227.9 / 0.9958 | 248.0 / 0.9957 | 361.3 / 0.9957 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 353.7 / 0.9958 | 384.1 / 0.9957 | 584.5 / 0.9957 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 210.7 / 0.4356 | 269.5 / 0.4356 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 293.2 / 0.4356 | 347.0 / 0.4356 | 469.0 / 0.4356 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 229.2 / 0.5741 | 284.7 / 0.5740 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 307.3 / 0.5740 | 366.3 / 0.5740 | 480.2 / 0.5740 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 459.8 / 0.5740 | 515.8 / 0.5740 | 868.4 / 0.5740 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 935.4 / 0.6568 | 994.0 / 0.6568 | 2051.0 / 0.6568 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 491.7 / 0.6948 | 549.7 / 0.6948 | 898.3 / 0.6948 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 967.3 / 0.7508 | 1047.8 / 0.7508 | 2042.7 / 0.7508 |
| usearch_b1_rescore | ef 100 | 378.7 / 0.9492 | 449.5 / 0.9492 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2984.2 / 0.9987 | 3060.6 / 0.9987 | 4245.8 / 0.9987 |
| usearch_b1_rescore | ef 200 | 639.0 / 0.9721 | 703.0 / 0.9721 | 662.1 / 0.9744 | 727.6 / 0.9744 | 857.4 / 0.9744 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 5531.4 / 1.0001 | 5645.2 / 1.0001 | 6836.2 / 1.0001 |
| usearch_b1_rescore | ef 400 |  |  | 1195.8 / 0.9856 | 1241.5 / 0.9856 | 1369.5 / 0.9856 | 1235.9 / 0.9904 | 1299.5 / 0.9903 | 1700.9 / 0.9903 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2294.0 / 0.9956 | 2345.0 / 0.9955 | 2756.5 / 0.9955 |  |  |  |

### csn1m / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.2580)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 1572.3 | 10 | 0.9883 | yes / no | 3.53 [2.97, 3.71] | 3313 | 13755 |
| diskann_vamana | 0.99 | 2666.1 | 10 | 0.9878 | no / no | 3.81 [3.48, 3.99] | 3313 | 13910 |
| diskann_vamana | 0.995 | 6375.9 | 10 | 1.0008 | yes / yes |  | 3432 | 13758 |
| faiss_bin_flat | 0.98 | 2058.5 | 10 | 0.9873 | yes / no | 4.62 [3.86, 4.85] | 3064 | 16214 |
| faiss_bin_hnsw | 0.98 | 4220.1 | 10 | 0.9821 | yes / no | 9.47 [7.97, 10.00] | 3559 | 17405 |
| faiss_exact | 0.98 | 75075.6 | 10 | 1.0000 | yes / yes | 168.41 [140.57, 176.70] | 2971 | 8979 |
| faiss_exact | 0.99 | 75075.6 | 10 | 1.0000 | yes / yes | 107.42 [97.81, 111.41] | 2971 | 8979 |
| faiss_exact | 0.995 | 75075.6 | 10 | 1.0000 | yes / yes |  | 2971 | 8979 |
| faiss_hnsw_flat | 0.98 | 981.2 | 10 | 0.9895 | yes / yes | 2.20 [1.85, 2.34] | 3479 | 10752 |
| faiss_hnsw_flat | 0.99 | 1837.7 | 10 | 0.9970 | yes / yes | 2.63 [2.40, 2.76] | 3479 | 10747 |
| faiss_hnsw_flat | 0.995 | 6308.7 | 10 | 0.9984 | yes / no |  | 3479 | 10760 |
| faiss_hnsw_sq8 | 0.98 | 794.4 | 10 | 0.9896 | yes / yes | 1.78 [1.50, 1.90] | 4234 | 19457 |
| faiss_hnsw_sq8 | 0.99 | 1484.0 | 10 | 0.9970 | yes / yes | 2.12 [1.94, 2.25] | 4234 | 19188 |
| faiss_hnsw_sq8 | 0.995 | 2848.9 | 10 | 0.9984 | yes / no |  | 4234 | 19471 |
| faiss_ivfpq_fs | 0.98 | 5425.8 | 10 | 1.0020 | yes / yes | 12.17 [10.20, 12.99] | 3088 | 16262 |
| faiss_ivfpq_fs | 0.99 | 5425.8 | 10 | 1.0020 | yes / yes | 7.76 [7.06, 8.24] | 3088 | 16262 |
| faiss_ivfpq_fs | 0.995 | 5425.8 | 10 | 1.0020 | yes / yes |  | 3088 | 16262 |
| faiss_rabitq_flat | 0.98 | 10887.0 | 10 | 0.9979 | yes / yes | 24.42 [20.44, 25.49] | 3103 | 16356 |
| faiss_rabitq_flat | 0.99 | 10887.0 | 10 | 0.9979 | yes / yes | 15.58 [14.20, 16.12] | 3103 | 16356 |
| faiss_rabitq_flat | 0.995 | 10887.4 | 10 | 1.0006 | yes / yes |  | 3103 | 16455 |
| faiss_rabitq_hnsw | 0.98 | 4113.4 | 10 | 0.9845 | yes / no | 9.23 [7.70, 9.61] | 3598 | 17583 |
| faiss_rabitq_ivf | 0.98 | 12091.1 | 10 | 0.9998 | yes / yes | 27.12 [22.72, 28.41] | 3082 | 16270 |
| faiss_rabitq_ivf | 0.99 | 12091.1 | 10 | 0.9998 | yes / yes | 17.30 [15.78, 17.94] | 3082 | 16270 |
| faiss_rabitq_ivf | 0.995 | 12091.1 | 10 | 0.9998 | yes / yes |  | 3082 | 16270 |
| hnswlib_f32 | 0.98 | 1157.6 | 10 | 0.9907 | yes / yes | 2.60 [2.18, 2.74] | 3328 | 9041 |
| hnswlib_f32 | 0.99 | 1955.7 | 10 | 0.9951 | yes / no | 2.80 [2.55, 2.90] | 3573 | 10231 |
| hnswlib_f32 | 0.995 | 3658.6 | 10 | 0.9981 | yes / no |  | 3573 | 10227 |
| ours_cascade | 0.98 | 445.8 | 10 | 0.9909 | yes / yes |  | 3915 | 3543 |
| ours_cascade | 0.99 | 698.9 | 10 | 0.9945 | yes / no |  | 3926 | 3947 |
| scann | 0.98 | 6094.7 | 10 | 0.9999 | yes / yes | 13.67 [11.41, 14.26] | 3217 | 11257 |
| scann | 0.99 | 6663.3 | 10 | 0.9961 | yes / yes | 9.53 [8.69, 9.86] | 3388 | 14049 |
| scann | 0.995 | 11048.3 | 10 | 1.0000 | yes / yes |  | 3388 | 14037 |
| usearch_f16 | 0.98 | 2805.2 | 10 | 0.9924 | yes / yes | 6.29 [5.27, 6.69] | 2112 | 7767 |
| usearch_f16 | 0.99 | 5106.3 | 10 | 0.9966 | yes / yes | 7.31 [6.66, 7.79] | 2112 | 7888 |
| usearch_f16 | 0.995 | 10100.5 | 10 | 0.9980 | yes / no |  | 1867 | 7322 |
| usearch_i8 | 0.98 | 6474.6 | 10 | 0.9849 | yes / no | 14.52 [12.22, 15.36] | 1376 | 4722 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1381.0 / 0.9797 | 1431.6 / 0.9799 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 9417.2 / 0.9993 | 9648.9 / 0.9989 | 10766.1 / 0.9991 |
| diskann_vamana | L 200 | 2364.3 / 0.9907 | 2460.4 / 0.9909 | 2404.4 / 0.9910 | 2505.6 / 0.9909 | 2602.8 / 0.9909 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 16943.6 / 0.9993 | 16906.7 / 0.9989 | 18144.6 / 0.9991 |
| diskann_vamana | L 400 |  |  | 4223.6 / 0.9931 | 4320.4 / 0.9930 | 4401.5 / 0.9930 | 4294.8 / 0.9931 | 4363.2 / 0.9930 | 4820.4 / 0.9930 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 7634.1 / 0.9993 | 7699.7 / 0.9989 | 8105.3 / 0.9991 |  |  |  |
| faiss_bin_flat | exhaustive | 1970.3 / 0.9719 | 2058.0 / 0.9719 | 2047.3 / 0.9827 | 2108.8 / 0.9827 | 2255.5 / 0.9827 | 2236.6 / 0.9893 | 2305.3 / 0.9895 | 2685.4 / 0.9895 | 2835.2 / 0.9957 | 2885.7 / 0.9956 | 4064.0 / 0.9956 |
| faiss_bin_hnsw | ef 100 | 415.5 / 0.8970 | 484.8 / 0.8970 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3172.8 / 0.9937 | 3223.7 / 0.9936 | 4464.5 / 0.9935 |
| faiss_bin_hnsw | ef 200 | 690.7 / 0.9357 | 754.3 / 0.9357 | 729.3 / 0.9454 | 805.4 / 0.9452 | 930.3 / 0.9452 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5829.4 / 0.9952 | 5923.3 / 0.9951 | 7120.7 / 0.9951 |
| faiss_bin_hnsw | ef 400 |  |  | 1235.7 / 0.9707 | 1319.4 / 0.9707 | 1460.3 / 0.9707 | 1345.8 / 0.9762 | 1414.5 / 0.9764 | 1826.6 / 0.9764 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2370.8 / 0.9862 | 2447.6 / 0.9864 | 2844.2 / 0.9864 |  |  |  |
| faiss_hnsw_flat | ef 100 | 713.9 / 0.9840 | 768.6 / 0.9842 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 5359.0 / 0.9984 | 5403.2 / 0.9980 | 6582.1 / 0.9982 |
| faiss_hnsw_flat | ef 200 | 1212.3 / 0.9915 | 1287.9 / 0.9917 | 1241.4 / 0.9918 | 1326.1 / 0.9917 | 1453.7 / 0.9917 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 9630.8 / 0.9985 | 9725.5 / 0.9981 | 10958.7 / 0.9983 |
| faiss_hnsw_flat | ef 400 |  |  | 2195.9 / 0.9970 | 2294.9 / 0.9969 | 2412.0 / 0.9969 | 2316.3 / 0.9970 | 2387.1 / 0.9967 | 2807.2 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4117.2 / 0.9979 | 4200.0 / 0.9975 | 4612.2 / 0.9977 |  |  |  |
| faiss_rabitq_flat | exhaustive | 11109.8 / 1.0000 | 11233.4 / 0.9999 | 11212.9 / 0.9999 | 11241.6 / 0.9997 | 11351.7 / 0.9997 | 11381.6 / 1.0001 | 11589.4 / 1.0000 | 11741.9 / 0.9999 | 11689.8 / 1.0001 | 11770.4 / 0.9998 | 13010.0 / 0.9999 |
| faiss_rabitq_ivf | nprobe 1 | 159.3 / 0.2257 | 224.2 / 0.2257 | 188.8 / 0.2257 | 257.8 / 0.2257 | 390.6 / 0.2257 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 180.4 / 0.3084 | 246.5 / 0.3084 | 213.4 / 0.3084 | 283.7 / 0.3084 | 415.3 / 0.3084 | 285.9 / 0.3084 | 350.4 / 0.3084 | 756.4 / 0.3084 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 494.9 / 0.3582 | 562.8 / 0.3582 | 1772.8 / 0.3582 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 329.0 / 0.3896 | 397.8 / 0.3896 | 798.4 / 0.3896 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 575.0 / 0.4355 | 645.6 / 0.4354 | 1861.3 / 0.4354 |
| hnswlib_f32 | ef 100 | 676.5 / 0.9793 | 741.0 / 0.9793 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 5223.5 / 0.9974 | 5287.1 / 0.9971 | 6500.9 / 0.9973 |
| hnswlib_f32 | ef 200 | 1190.9 / 0.9911 | 1248.3 / 0.9913 | 1215.0 / 0.9914 | 1289.8 / 0.9913 | 1409.8 / 0.9913 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 9234.9 / 0.9982 | 9243.9 / 0.9979 | 10335.9 / 0.9981 |
| hnswlib_f32 | ef 400 |  |  | 2173.8 / 0.9966 | 2253.7 / 0.9965 | 2384.7 / 0.9965 | 2217.3 / 0.9966 | 2345.9 / 0.9963 | 2743.0 / 0.9965 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 4056.8 / 0.9974 | 4186.9 / 0.9971 | 4549.5 / 0.9973 |  |  |  |
| ours_scan | ef 100 | 106.8 / 0.9327 | 663.2 / 0.9327 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 400.7 / 0.9911 | 404.0 / 0.9909 | 703.2 / 0.9909 |
| ours_scan | ef 200 |  |  | 146.4 / 0.9583 | 3743.2 / 0.9582 | 188.6 / 0.9582 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 205.9 / 0.9710 | 1034.0 / 0.9712 | 327.5 / 0.9712 |  |  |  |
| ours_walk | ef 100 | 113.8 / 0.9327 | 1482.6 / 0.9327 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 396.4 / 0.9911 | 414.6 / 0.9909 | 724.7 / 0.9909 |
| ours_walk | ef 200 | 146.2 / 0.9462 | 3424.8 / 0.9462 | 461.7 / 0.9583 | 3042.6 / 0.9582 | 1881.8 / 0.9582 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 583.9 / 0.9935 | 603.6 / 0.9933 | 894.2 / 0.9933 |
| ours_walk | ef 400 |  |  | 4708.8 / 0.9657 | 3039.9 / 0.9657 | 1828.6 / 0.9657 | 223.7 / 0.9710 | 776.4 / 0.9712 | 334.0 / 0.9712 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 1131.6 / 0.9800 | 1948.6 / 0.9802 | 1258.5 / 0.9802 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 211.8 / 0.2315 | 268.1 / 0.2315 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 292.0 / 0.2315 | 347.9 / 0.2315 | 465.0 / 0.2315 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 227.8 / 0.3199 | 283.7 / 0.3199 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 309.0 / 0.3199 | 364.6 / 0.3199 | 479.8 / 0.3199 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 460.5 / 0.3199 | 517.2 / 0.3199 | 867.7 / 0.3199 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 941.6 / 0.3646 | 1006.1 / 0.3646 | 2050.7 / 0.3646 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 495.8 / 0.3945 | 549.4 / 0.3945 | 901.7 / 0.3945 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 999.1 / 0.4493 | 1048.2 / 0.4493 | 2107.8 / 0.4493 |
| usearch_b1_rescore | ef 100 | 386.2 / 0.8977 | 449.7 / 0.8977 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2903.8 / 0.9851 | 2981.6 / 0.9849 | 4193.0 / 0.9849 |
| usearch_b1_rescore | ef 200 | 629.5 / 0.9332 | 688.4 / 0.9332 | 650.5 / 0.9447 | 726.6 / 0.9447 | 847.1 / 0.9447 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 5364.8 / 0.9861 | 5435.0 / 0.9861 | 6661.0 / 0.9860 |
| usearch_b1_rescore | ef 400 |  |  | 1153.9 / 0.9579 | 1218.7 / 0.9579 | 1350.6 / 0.9579 | 1219.3 / 0.9642 | 1284.2 / 0.9644 | 1689.2 / 0.9644 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2228.2 / 0.9755 | 2292.6 / 0.9757 | 2709.5 / 0.9757 |  |  |  |

### csn1m / jina-v2-base-code (n_ho = 2400, exact quality 0.4412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 416.3 | 10 | 0.9802 | yes / no | 3.90 [0.04, 3.99] | 3412 | 13807 |
| diskann_vamana | 0.99 | 644.4 | 10 | 0.9917 | yes / no | 5.09 [0.05, 5.38] | 3412 | 13792 |
| diskann_vamana | 0.995 | 1039.3 | 10 | 0.9959 | yes / no | 6.20 [0.11, 6.62] | 3412 | 13814 |
| faiss_bin_flat | 0.98 | 1837.9 | 10 | 0.9907 | yes / yes | 17.20 [0.15, 17.59] | 3064 | 15472 |
| faiss_bin_flat | 0.99 | 1856.4 | 10 | 0.9976 | yes / yes | 14.67 [0.16, 15.42] | 3064 | 15477 |
| faiss_bin_flat | 0.995 | 1856.4 | 10 | 0.9976 | yes / no | 11.08 [0.20, 11.83] | 3064 | 15477 |
| faiss_bin_hnsw | 0.98 | 323.8 | 10 | 0.9893 | yes / yes | 3.03 [0.03, 3.12] | 3314 | 16288 |
| faiss_bin_hnsw | 0.99 | 525.4 | 10 | 0.9918 | yes / no | 4.15 [0.04, 4.36] | 3314 | 16291 |
| faiss_bin_hnsw | 0.995 | 720.7 | 10 | 0.9977 | yes / yes | 4.30 [0.08, 4.57] | 3559 | 17063 |
| faiss_exact | 0.98 | 71106.0 | 10 | 1.0000 | yes / yes | 665.43 [6.02, 676.08] | 2971 | 9184 |
| faiss_exact | 0.99 | 71106.0 | 10 | 1.0000 | yes / yes | 561.91 [6.00, 587.55] | 2971 | 9184 |
| faiss_exact | 0.995 | 71106.0 | 10 | 1.0000 | yes / yes | 424.42 [7.68, 451.24] | 2971 | 9184 |
| faiss_hnsw_flat | 0.98 | 212.4 | 10 | 0.9819 | yes / no | 1.99 [0.02, 2.04] | 3234 | 9922 |
| faiss_hnsw_flat | 0.99 | 380.2 | 10 | 0.9932 | yes / no | 3.00 [0.03, 3.15] | 3233 | 9942 |
| faiss_hnsw_flat | 0.995 | 500.3 | 10 | 0.9955 | yes / no | 2.99 [0.05, 3.19] | 3479 | 10723 |
| faiss_hnsw_sq8 | 0.98 | 200.9 | 10 | 0.9819 | yes / no | 1.88 [0.02, 1.92] | 3867 | 17997 |
| faiss_hnsw_sq8 | 0.99 | 304.4 | 10 | 0.9919 | yes / no | 2.41 [0.03, 2.54] | 4234 | 19168 |
| faiss_hnsw_sq8 | 0.995 | 419.0 | 10 | 0.9955 | yes / no | 2.50 [0.05, 2.66] | 4234 | 19164 |
| faiss_ivfpq_fs | 0.98 | 1245.3 | 10 | 0.9966 | yes / yes | 11.65 [0.11, 12.25] | 3107 | 15670 |
| faiss_ivfpq_fs | 0.99 | 1438.9 | 10 | 0.9982 | yes / yes | 11.37 [0.12, 11.97] | 3088 | 15629 |
| faiss_ivfpq_fs | 0.995 | 1438.9 | 10 | 0.9982 | yes / no | 8.59 [0.16, 9.15] | 3088 | 15629 |
| faiss_rabitq_flat | 0.98 | 10868.5 | 10 | 0.9992 | yes / yes | 101.71 [0.92, 103.68] | 3103 | 15583 |
| faiss_rabitq_flat | 0.99 | 10868.5 | 10 | 0.9992 | yes / yes | 85.89 [0.92, 89.77] | 3103 | 15583 |
| faiss_rabitq_flat | 0.995 | 10868.5 | 10 | 0.9992 | yes / yes | 64.87 [1.17, 68.98] | 3103 | 15583 |
| faiss_rabitq_hnsw | 0.98 | 321.8 | 10 | 0.9913 | yes / yes | 3.01 [0.03, 3.09] | 3598 | 17204 |
| faiss_rabitq_hnsw | 0.99 | 563.6 | 10 | 0.9977 | yes / yes | 4.45 [0.05, 4.70] | 3598 | 17205 |
| faiss_rabitq_hnsw | 0.995 | 618.2 | 10 | 0.9983 | yes / no | 3.69 [0.07, 3.93] | 3598 | 17233 |
| faiss_rabitq_ivf | 0.98 | 2232.2 | 10 | 0.9964 | yes / yes | 20.89 [0.19, 21.59] | 3091 | 15702 |
| faiss_rabitq_ivf | 0.99 | 3207.7 | 10 | 0.9982 | yes / yes | 25.35 [0.27, 26.57] | 3082 | 15644 |
| faiss_rabitq_ivf | 0.995 | 3207.7 | 10 | 0.9982 | yes / no | 19.15 [0.35, 20.37] | 3082 | 15644 |
| hnswlib_f32 | 0.98 | 226.9 | 10 | 0.9813 | yes / no | 2.12 [0.02, 2.18] | 3573 | 10246 |
| hnswlib_f32 | 0.99 | 395.6 | 10 | 0.9951 | yes / yes | 3.13 [0.03, 3.27] | 3573 | 10256 |
| hnswlib_f32 | 0.995 | 543.2 | 10 | 0.9964 | yes / no | 3.24 [0.06, 3.45] | 3573 | 10236 |
| ours_cascade | 0.98 | 106.9 | 10 | 0.9927 | yes / yes |  | 3904 | 2960 |
| ours_cascade | 0.99 | 126.5 | 10 | 0.9954 | yes / yes |  | 3900 | 3005 |
| ours_cascade | 0.995 | 167.5 | 10 | 0.9977 | yes / yes |  | 3909 | 3067 |
| scann | 0.98 | 772.8 | 10 | 0.9888 | yes / yes | 7.23 [0.07, 7.34] | 3389 | 14330 |
| scann | 0.99 | 772.8 | 10 | 0.9888 | no / no | 6.11 [0.07, 6.39] | 3389 | 14330 |
| scann | 0.995 | 2318.4 | 10 | 0.9979 | yes / no | 13.84 [0.25, 14.72] | 3389 | 14335 |
| usearch_b1_rescore | 0.98 | 214.9 | 10 | 0.9810 | yes / no | 2.01 [0.02, 2.06] | 3407 | 16452 |
| usearch_b1_rescore | 0.99 | 319.2 | 10 | 0.9882 | no / no | 2.52 [0.03, 2.65] | 3407 | 16466 |
| usearch_b1_rescore | 0.995 | 676.0 | 10 | 0.9972 | yes / no | 4.04 [0.07, 4.29] | 3407 | 16430 |
| usearch_f16 | 0.98 | 599.4 | 10 | 0.9859 | yes / yes | 5.61 [0.05, 5.83] | 2112 | 7787 |
| usearch_f16 | 0.99 | 828.3 | 10 | 0.9877 | no / no | 6.55 [0.07, 6.89] | 2112 | 7790 |
| usearch_f16 | 0.995 | 1716.0 | 10 | 0.9971 | yes / no | 10.24 [0.19, 10.93] | 1867 | 7033 |
| usearch_i8 | 0.98 | 579.7 | 10 | 0.9805 | yes / no | 5.42 [0.05, 5.53] | 1376 | 4696 |
| usearch_i8 | 0.99 | 1183.6 | 10 | 0.9893 | no / no | 9.35 [0.10, 9.86] | 1131 | 3953 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1222.3 / 0.9990 | 1283.5 / 0.9990 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 8170.3 / 1.0000 | 8175.3 / 1.0000 | 9429.9 / 1.0000 |
| diskann_vamana | L 200 | 2073.7 / 0.9999 | 2122.2 / 0.9999 | 2090.4 / 0.9999 | 2149.6 / 0.9999 | 2298.3 / 0.9999 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 14594.5 / 1.0000 | 14852.9 / 1.0000 | 15909.2 / 1.0000 |
| diskann_vamana | L 400 |  |  | 3607.5 / 0.9999 | 3686.1 / 0.9999 | 3855.7 / 0.9999 | 3696.7 / 0.9999 | 3737.7 / 0.9999 | 4148.1 / 0.9999 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 6526.8 / 1.0000 | 6591.0 / 1.0000 | 7065.6 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 1960.5 / 0.9972 | 2023.8 / 0.9972 | 2047.5 / 0.9982 | 2120.9 / 0.9982 | 2242.6 / 0.9982 | 2228.1 / 0.9998 | 2285.1 / 0.9998 | 2669.2 / 0.9998 | 2812.3 / 1.0000 | 2874.8 / 1.0000 | 4091.4 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 394.3 / 0.9883 | 461.2 / 0.9883 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2866.7 / 1.0000 | 2990.2 / 1.0000 | 4163.2 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 634.0 / 0.9926 | 705.5 / 0.9926 | 678.7 / 0.9946 | 743.2 / 0.9946 | 883.1 / 0.9946 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5310.7 / 1.0000 | 5428.7 / 1.0000 | 6678.9 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 1148.9 / 0.9982 | 1222.5 / 0.9982 | 1374.2 / 0.9982 | 1225.4 / 0.9998 | 1296.9 / 0.9998 | 1701.2 / 0.9998 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2155.9 / 0.9998 | 2234.5 / 0.9998 | 2626.4 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 100 | 670.4 / 0.9967 | 736.5 / 0.9967 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4912.5 / 1.0000 | 5074.1 / 1.0000 | 6246.8 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1141.9 / 0.9989 | 1198.8 / 0.9989 | 1199.2 / 0.9989 | 1279.2 / 0.9989 | 1410.1 / 0.9989 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 8960.1 / 1.0000 | 9174.2 / 1.0000 | 10320.8 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2071.5 / 1.0000 | 2157.5 / 1.0000 | 2288.0 / 1.0000 | 2177.5 / 1.0000 | 2234.9 / 1.0000 | 2621.8 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3821.2 / 1.0000 | 3933.4 / 1.0000 | 4293.5 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 11057.9 / 1.0000 | 11173.1 / 1.0000 | 11246.8 / 1.0000 | 11223.0 / 1.0000 | 11364.9 / 1.0000 | 11346.9 / 1.0000 | 11304.0 / 1.0000 | 11756.8 / 1.0000 | 11666.2 / 1.0000 | 11752.6 / 1.0000 | 12995.0 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 157.1 / 0.5727 | 222.5 / 0.5727 | 187.7 / 0.5727 | 259.5 / 0.5727 | 390.3 / 0.5727 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 179.6 / 0.7199 | 243.9 / 0.7199 | 211.5 / 0.7199 | 281.5 / 0.7199 | 413.3 / 0.7199 | 277.3 / 0.7199 | 348.0 / 0.7199 | 752.3 / 0.7199 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 493.9 / 0.7876 | 559.0 / 0.7876 | 1783.4 / 0.7876 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 318.7 / 0.8236 | 392.0 / 0.8236 | 788.4 / 0.8236 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 566.4 / 0.8709 | 630.5 / 0.8708 | 1848.7 / 0.8708 |
| hnswlib_f32 | ef 100 | 646.0 / 0.9975 | 716.4 / 0.9975 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 4714.0 / 1.0000 | 4889.7 / 1.0000 | 6091.6 / 1.0000 |
| hnswlib_f32 | ef 200 | 1127.8 / 0.9988 | 1195.3 / 0.9988 | 1174.5 / 0.9988 | 1236.0 / 0.9988 | 1351.4 / 0.9988 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 8251.2 / 1.0000 | 8445.7 / 1.0000 | 9679.8 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 2018.6 / 1.0000 | 2097.8 / 1.0000 | 2242.4 / 1.0000 | 2131.8 / 1.0000 | 2170.9 / 1.0000 | 2610.7 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 3714.8 / 1.0000 | 3714.9 / 1.0000 | 4205.9 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 79.8 / 0.9927 | 93.3 / 0.9927 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 295.8 / 0.9999 | 300.3 / 0.9999 | 589.6 / 0.9999 |
| ours_scan | ef 200 |  |  | 108.7 / 0.9960 | 123.0 / 0.9960 | 148.7 / 0.9960 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 154.6 / 0.9989 | 169.5 / 0.9989 | 263.3 / 0.9989 |  |  |  |
| ours_walk | ef 100 | 374.2 / 0.9927 | 94.8 / 0.9927 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 295.2 / 0.9999 | 306.9 / 0.9999 | 590.9 / 0.9999 |
| ours_walk | ef 200 | 742.3 / 0.9946 | 666.9 / 0.9946 | 110.1 / 0.9960 | 123.7 / 0.9960 | 156.3 / 0.9960 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 438.1 / 0.9999 | 454.6 / 0.9999 | 729.5 / 0.9999 |
| ours_walk | ef 400 |  |  | 404.0 / 0.9972 | 961.3 / 0.9972 | 707.3 / 0.9972 | 204.5 / 0.9989 | 186.5 / 0.9989 | 272.2 / 0.9989 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 543.7 / 0.9988 | 536.1 / 0.9988 | 612.0 / 0.9988 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 209.0 / 0.5662 | 265.9 / 0.5662 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 285.0 / 0.5662 | 344.9 / 0.5662 | 464.3 / 0.5662 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 223.9 / 0.7001 | 280.9 / 0.7001 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 298.0 / 0.7001 | 359.9 / 0.7001 | 475.6 / 0.7001 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 454.3 / 0.7001 | 513.1 / 0.7001 | 862.6 / 0.7001 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 920.3 / 0.7603 | 966.5 / 0.7603 | 2013.9 / 0.7603 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 486.2 / 0.7999 | 539.6 / 0.7998 | 889.4 / 0.7998 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 957.9 / 0.8455 | 1031.0 / 0.8455 | 2070.2 / 0.8455 |
| usearch_b1_rescore | ef 100 | 331.7 / 0.9845 | 397.7 / 0.9845 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2459.4 / 0.9983 | 2542.4 / 0.9983 | 3720.7 / 0.9983 |
| usearch_b1_rescore | ef 200 | 541.6 / 0.9911 | 602.1 / 0.9911 | 564.1 / 0.9939 | 634.5 / 0.9939 | 760.6 / 0.9939 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 4528.3 / 0.9981 | 4577.2 / 0.9981 | 5845.0 / 0.9981 |
| usearch_b1_rescore | ef 400 |  |  | 981.1 / 0.9955 | 1039.1 / 0.9955 | 1188.4 / 0.9955 | 1037.0 / 0.9972 | 1090.9 / 0.9972 | 1499.7 / 0.9972 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1866.8 / 0.9981 | 1918.3 / 0.9981 | 2340.8 / 0.9981 |  |  |  |

### d20k / CodeRankEmbed (n_ho = 2400, exact quality 0.8271)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 338.8 | 10 | 0.9887 | yes / no | 4.52 [4.46, 5.36] | 109 | 307 |
| diskann_vamana | 0.99 | 394.5 | 10 | 0.9950 | yes / yes | 5.26 [5.17, 6.24] | 108 | 301 |
| diskann_vamana | 0.995 | 575.3 | 10 | 0.9983 | yes / yes | 6.15 [6.03, 6.48] | 109 | 307 |
| faiss_bin_flat | 0.98 | 48.7 | 10 | 0.9872 | yes / no | 0.65 [0.64, 0.77] | 118 | 320 |
| faiss_bin_flat | 0.99 | 62.9 | 10 | 0.9927 | yes / no | 0.84 [0.83, 0.99] | 118 | 318 |
| faiss_bin_flat | 0.995 | 62.9 | 10 | 0.9927 | no / no | 0.67 [0.66, 0.70] | 118 | 318 |
| faiss_bin_hnsw | 0.98 | 144.0 | 10 | 0.9829 | yes / no | 1.92 [1.90, 2.28] | 119 | 352 |
| faiss_bin_hnsw | 0.99 | 193.4 | 10 | 0.9937 | yes / no | 2.58 [2.55, 3.06] | 119 | 353 |
| faiss_bin_hnsw | 0.995 | 236.0 | 10 | 0.9962 | yes / no | 2.52 [2.48, 2.65] | 119 | 336 |
| faiss_exact | 0.98 | 1407.1 | 10 | 1.0000 | yes / yes | 18.76 [17.94, 22.25] | 87 | 200 |
| faiss_exact | 0.99 | 1407.1 | 10 | 1.0000 | yes / yes | 18.76 [17.94, 22.25] | 87 | 200 |
| faiss_exact | 0.995 | 1407.1 | 10 | 1.0000 | yes / yes | 15.04 [14.36, 15.81] | 87 | 200 |
| faiss_hnsw_flat | 0.98 | 138.9 | 10 | 0.9892 | yes / yes | 1.85 [1.83, 2.20] | 90 | 209 |
| faiss_hnsw_flat | 0.99 | 251.7 | 10 | 0.9952 | yes / yes | 3.36 [3.29, 3.98] | 90 | 210 |
| faiss_hnsw_flat | 0.995 | 332.5 | 10 | 0.9990 | yes / yes | 3.55 [3.47, 3.75] | 93 | 216 |
| faiss_hnsw_sq8 | 0.98 | 83.0 | 10 | 0.9907 | yes / yes | 1.11 [1.10, 1.31] | 119 | 372 |
| faiss_hnsw_sq8 | 0.99 | 132.1 | 10 | 0.9952 | yes / yes | 1.76 [1.74, 2.09] | 119 | 373 |
| faiss_hnsw_sq8 | 0.995 | 164.8 | 10 | 0.9990 | yes / yes | 1.76 [1.73, 1.85] | 119 | 381 |
| faiss_ivfpq_fs | 0.98 | 115.7 | 10 | 1.0000 | yes / yes | 1.54 [1.52, 1.83] | 120 | 342 |
| faiss_ivfpq_fs | 0.99 | 115.7 | 10 | 1.0000 | yes / yes | 1.54 [1.52, 1.83] | 120 | 342 |
| faiss_ivfpq_fs | 0.995 | 115.7 | 10 | 1.0000 | yes / yes | 1.24 [1.21, 1.30] | 120 | 342 |
| faiss_rabitq_flat | 0.98 | 232.1 | 10 | 0.9998 | yes / yes | 3.09 [3.07, 3.67] | 119 | 321 |
| faiss_rabitq_flat | 0.99 | 232.1 | 10 | 0.9998 | yes / yes | 3.09 [3.07, 3.67] | 119 | 321 |
| faiss_rabitq_flat | 0.995 | 232.1 | 10 | 0.9998 | yes / yes | 2.48 [2.43, 2.60] | 119 | 321 |
| faiss_rabitq_hnsw | 0.98 | 96.6 | 10 | 0.9917 | yes / yes | 1.29 [1.28, 1.53] | 119 | 359 |
| faiss_rabitq_hnsw | 0.99 | 155.4 | 10 | 0.9981 | yes / yes | 2.07 [2.05, 2.46] | 119 | 358 |
| faiss_rabitq_hnsw | 0.995 | 260.6 | 10 | 0.9991 | yes / yes | 2.79 [2.73, 2.93] | 119 | 359 |
| faiss_rabitq_ivf | 0.98 | 271.2 | 10 | 0.9912 | yes / yes | 3.62 [3.58, 4.29] | 119 | 336 |
| faiss_rabitq_ivf | 0.99 | 295.2 | 10 | 0.9923 | yes / no | 3.94 [3.88, 4.67] | 119 | 336 |
| faiss_rabitq_ivf | 0.995 | 329.9 | 10 | 1.0000 | yes / yes | 3.53 [3.46, 3.70] | 119 | 334 |
| hnswlib_f32 | 0.98 | 139.4 | 10 | 0.9851 | yes / no | 1.86 [1.80, 2.20] | 93 | 187 |
| hnswlib_f32 | 0.99 | 352.4 | 10 | 1.0002 | yes / yes | 4.70 [4.60, 5.57] | 96 | 194 |
| hnswlib_f32 | 0.995 | 468.8 | 10 | 0.9982 | yes / yes | 5.01 [4.90, 5.29] | 93 | 188 |
| ours_cascade | 0.98 | 75.0 | 10 | 0.9902 | yes / yes |  | 188 | 130 |
| ours_cascade | 0.99 | 75.0 | 10 | 0.9902 | yes / no |  | 188 | 130 |
| ours_cascade | 0.995 | 93.6 | 10 | 0.9941 | no / no |  | 189 | 198 |
| scann | 0.98 | 258.1 | 10 | 1.0000 | yes / yes | 3.44 [3.41, 4.08] | 130 | 375 |
| scann | 0.99 | 258.1 | 10 | 1.0000 | yes / yes | 3.44 [3.41, 4.08] | 130 | 375 |
| scann | 0.995 | 258.1 | 10 | 1.0000 | yes / yes | 2.76 [2.71, 2.89] | 130 | 375 |
| usearch_b1_rescore | 0.98 | 116.2 | 10 | 0.9822 | yes / no | 1.55 [1.53, 1.84] | 123 | 325 |
| usearch_b1_rescore | 0.99 | 145.0 | 10 | 0.9919 | yes / no | 1.93 [1.92, 2.29] | 125 | 336 |
| usearch_b1_rescore | 0.995 | 214.2 | 10 | 0.9931 | no / no | 2.29 [2.25, 2.40] | 130 | 356 |
| usearch_f16 | 0.98 | 190.3 | 10 | 0.9894 | yes / yes | 2.54 [2.50, 3.00] | 65 | 151 |
| usearch_f16 | 0.99 | 258.2 | 10 | 0.9902 | yes / no | 3.44 [3.40, 4.08] | 70 | 172 |
| usearch_f16 | 0.995 | 470.9 | 10 | 0.9955 | yes / no | 5.03 [4.93, 5.28] | 70 | 173 |
| usearch_i8 | 0.98 | 96.9 | 10 | 0.9877 | yes / yes | 1.29 [1.28, 1.53] | 50 | 89 |
| usearch_i8 | 0.99 | 102.3 | 10 | 0.9921 | yes / no | 1.36 [1.35, 1.62] | 56 | 110 |
| usearch_i8 | 0.995 | 320.7 | 10 | 0.9961 | yes / no | 3.43 [3.36, 3.60] | 55 | 111 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 559.6 / 0.9976 | 618.5 / 0.9976 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2657.5 / 1.0001 | 2719.5 / 1.0000 | 3778.3 / 1.0000 |
| diskann_vamana | L 200 | 890.4 / 0.9996 | 952.6 / 0.9995 | 908.7 / 0.9996 | 969.6 / 0.9995 | 1085.1 / 0.9995 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3747.0 / 1.0001 | 3813.0 / 1.0000 | 4871.7 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1448.5 / 1.0001 | 1513.4 / 1.0000 | 1619.2 / 1.0000 | 1494.4 / 1.0001 | 1538.6 / 1.0000 | 1906.4 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2258.0 / 1.0001 | 2305.0 / 1.0000 | 2661.7 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 114.7 / 0.9946 | 163.6 / 0.9946 | 145.9 / 0.9973 | 195.4 / 0.9973 | 295.6 / 0.9973 | 208.7 / 0.9978 | 258.8 / 0.9978 | 562.0 / 0.9978 | 387.9 / 0.9995 | 436.1 / 0.9994 | 1346.3 / 0.9993 |
| faiss_bin_hnsw | ef 100 | 141.1 / 0.9872 | 192.5 / 0.9872 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 931.0 / 0.9995 | 984.4 / 0.9994 | 1966.7 / 0.9993 |
| faiss_bin_hnsw | ef 200 | 206.5 / 0.9920 | 258.7 / 0.9920 | 232.5 / 0.9945 | 286.0 / 0.9945 | 391.7 / 0.9945 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1683.6 / 0.9995 | 1741.1 / 0.9994 | 2715.4 / 0.9993 |
| faiss_bin_hnsw | ef 400 |  |  | 357.9 / 0.9975 | 412.4 / 0.9975 | 519.8 / 0.9975 | 410.0 / 0.9984 | 464.2 / 0.9983 | 787.9 / 0.9983 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 652.1 / 0.9978 | 704.6 / 0.9978 | 1031.8 / 0.9978 |  |  |  |
| faiss_hnsw_flat | ef 100 | 354.6 / 0.9978 | 411.0 / 0.9978 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2131.8 / 1.0001 | 2232.5 / 1.0000 | 3237.9 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 573.0 / 0.9996 | 630.2 / 0.9995 | 608.7 / 0.9996 | 658.4 / 0.9995 | 766.9 / 0.9995 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3447.6 / 1.0001 | 3552.6 / 1.0000 | 4518.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 973.9 / 1.0001 | 1035.5 / 1.0000 | 1137.7 / 1.0000 | 1033.9 / 1.0001 | 1092.9 / 1.0000 | 1452.8 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1652.3 / 1.0001 | 1709.6 / 1.0000 | 2076.8 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 295.9 / 0.9999 | 345.2 / 0.9999 | 322.8 / 1.0001 | 370.2 / 1.0000 | 468.1 / 1.0000 | 368.8 / 1.0001 | 418.1 / 1.0000 | 714.3 / 1.0000 | 493.5 / 1.0001 | 544.6 / 1.0000 | 1450.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 113.4 / 0.8142 | 162.0 / 0.8142 | 257.7 / 0.8142 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 171.9 / 0.8766 | 220.6 / 0.8766 | 515.8 / 0.8766 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 288.9 / 0.8989 | 337.8 / 0.8989 | 1226.6 / 0.8989 |
| faiss_rabitq_ivf | nprobe 3 | 74.9 / 0.6302 | 121.6 / 0.6302 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 365.0 / 0.9526 | 415.6 / 0.9526 | 1315.0 / 0.9526 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 97.1 / 0.7165 | 144.5 / 0.7165 | 239.1 / 0.7165 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 84.6 / 0.7436 | 131.6 / 0.7436 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 141.4 / 0.7978 | 189.4 / 0.7978 | 479.8 / 0.7978 |  |  |  |
| hnswlib_f32 | ef 100 | 381.7 / 1.0001 | 438.7 / 1.0000 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2112.1 / 1.0001 | 2128.9 / 1.0000 | 3195.3 / 1.0000 |
| hnswlib_f32 | ef 200 | 620.9 / 1.0004 | 682.5 / 1.0003 | 622.4 / 1.0005 | 695.7 / 1.0003 | 814.5 / 1.0003 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 3095.7 / 1.0001 | 3124.9 / 1.0000 | 4210.3 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1017.0 / 1.0001 | 1097.7 / 1.0000 | 1228.4 / 1.0000 | 1085.6 / 1.0001 | 1143.7 / 1.0000 | 1471.6 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1689.7 / 1.0001 | 1783.2 / 1.0000 | 2105.1 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 60.7 / 0.9941 | 71.6 / 0.9941 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 99.2 / 0.9989 | 109.0 / 0.9989 | 346.9 / 0.9988 |
| ours_scan | ef 200 |  |  | 64.8 / 0.9973 | 76.6 / 0.9973 | 101.5 / 0.9973 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 73.2 / 0.9979 | 86.1 / 0.9979 | 162.2 / 0.9979 |  |  |  |
| ours_walk | ef 100 | 58.4 / 0.9920 | 70.7 / 0.9920 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 133.6 / 0.9995 | 146.5 / 0.9994 | 401.5 / 0.9993 |
| ours_walk | ef 200 | 67.7 / 0.9931 | 80.2 / 0.9931 | 70.5 / 0.9967 | 83.2 / 0.9967 | 109.7 / 0.9967 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 162.4 / 0.9995 | 176.6 / 0.9994 | 440.1 / 0.9993 |
| ours_walk | ef 400 |  |  | 85.4 / 0.9973 | 99.0 / 0.9973 | 124.9 / 0.9973 | 91.2 / 0.9978 | 104.9 / 0.9978 | 186.8 / 0.9978 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 108.1 / 0.9978 | 122.4 / 0.9978 | 208.1 / 0.9978 |  |  |  |
| scann | reorder 100 | 334.8 / 1.0001 | 376.7 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 752.0 / 1.0001 | 803.8 / 1.0000 | 1633.9 / 1.0000 |
| scann | reorder 200 |  |  | 383.3 / 1.0001 | 429.9 / 1.0000 | 517.2 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 478.5 / 1.0001 | 528.2 / 1.0000 | 795.6 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 126.6 / 0.9834 | 178.5 / 0.9834 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 631.1 / 0.9972 | 687.3 / 0.9971 | 1677.5 / 0.9971 |
| usearch_b1_rescore | ef 200 | 183.9 / 0.9901 | 236.9 / 0.9901 | 189.7 / 0.9919 | 242.9 / 0.9919 | 349.1 / 0.9919 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1042.7 / 0.9972 | 1101.1 / 0.9971 | 2090.3 / 0.9971 |
| usearch_b1_rescore | ef 400 |  |  | 296.0 / 0.9950 | 350.3 / 0.9950 | 457.6 / 0.9950 | 307.7 / 0.9956 | 363.7 / 0.9957 | 687.6 / 0.9956 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 505.2 / 0.9961 | 563.1 / 0.9961 | 890.7 / 0.9961 |  |  |  |

### d20k / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.6987)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 790.9 | 10 | 0.9873 | yes / no | 6.44 [6.38, 6.67] | 111 | 352 |
| diskann_vamana | 0.99 | 1308.8 | 10 | 0.9987 | yes / yes | 8.97 [8.74, 9.22] | 111 | 364 |
| diskann_vamana | 0.995 | 1564.2 | 10 | 0.9996 | yes / yes | 9.95 [9.74, 10.10] | 114 | 359 |
| faiss_bin_flat | 0.98 | 110.6 | 10 | 0.9932 | yes / yes | 0.90 [0.90, 0.92] | 118 | 377 |
| faiss_bin_flat | 0.99 | 218.4 | 10 | 0.9965 | yes / yes | 1.50 [1.46, 1.53] | 118 | 371 |
| faiss_bin_flat | 0.995 | 218.4 | 10 | 0.9965 | yes / no | 1.39 [1.37, 1.40] | 118 | 371 |
| faiss_bin_hnsw | 0.98 | 378.0 | 10 | 0.9893 | yes / yes | 3.08 [3.06, 3.13] | 119 | 391 |
| faiss_bin_hnsw | 0.99 | 473.9 | 10 | 0.9965 | yes / yes | 3.25 [3.18, 3.32] | 119 | 389 |
| faiss_bin_hnsw | 0.995 | 770.4 | 10 | 0.9963 | yes / no | 4.90 [4.83, 4.93] | 119 | 388 |
| faiss_exact | 0.98 | 1256.5 | 10 | 1.0000 | yes / yes | 10.24 [10.09, 10.58] | 88 | 208 |
| faiss_exact | 0.99 | 1256.5 | 10 | 1.0000 | yes / yes | 8.61 [8.39, 8.95] | 88 | 208 |
| faiss_exact | 0.995 | 1256.5 | 10 | 1.0000 | yes / yes | 7.99 [7.84, 8.25] | 88 | 208 |
| faiss_hnsw_flat | 0.98 | 227.7 | 10 | 0.9873 | yes / yes | 1.85 [1.83, 1.90] | 91 | 216 |
| faiss_hnsw_flat | 0.99 | 414.0 | 10 | 0.9954 | yes / yes | 2.84 [2.76, 2.91] | 91 | 213 |
| faiss_hnsw_flat | 0.995 | 504.5 | 10 | 0.9978 | yes / yes | 3.21 [3.13, 3.29] | 94 | 226 |
| faiss_hnsw_sq8 | 0.98 | 179.1 | 10 | 0.9867 | yes / no | 1.46 [1.44, 1.48] | 119 | 437 |
| faiss_hnsw_sq8 | 0.99 | 260.2 | 10 | 0.9953 | yes / yes | 1.78 [1.74, 1.83] | 119 | 429 |
| faiss_hnsw_sq8 | 0.995 | 260.2 | 10 | 0.9953 | yes / no | 1.66 [1.63, 1.68] | 119 | 429 |
| faiss_ivfpq_fs | 0.98 | 166.4 | 10 | 1.0000 | yes / yes | 1.36 [1.34, 1.38] | 120 | 404 |
| faiss_ivfpq_fs | 0.99 | 166.4 | 10 | 1.0000 | yes / yes | 1.14 [1.12, 1.17] | 120 | 404 |
| faiss_ivfpq_fs | 0.995 | 166.4 | 10 | 1.0000 | yes / yes | 1.06 [1.04, 1.07] | 120 | 404 |
| faiss_rabitq_flat | 0.98 | 260.4 | 10 | 0.9999 | yes / yes | 2.12 [2.11, 2.16] | 118 | 380 |
| faiss_rabitq_flat | 0.99 | 260.4 | 10 | 0.9999 | yes / yes | 1.78 [1.75, 1.83] | 118 | 380 |
| faiss_rabitq_flat | 0.995 | 260.4 | 10 | 0.9999 | yes / yes | 1.66 [1.63, 1.67] | 118 | 380 |
| faiss_rabitq_hnsw | 0.98 | 271.2 | 10 | 0.9899 | yes / yes | 2.21 [2.20, 2.25] | 119 | 414 |
| faiss_rabitq_hnsw | 0.99 | 433.8 | 10 | 0.9977 | yes / yes | 2.97 [2.91, 3.05] | 119 | 417 |
| faiss_rabitq_hnsw | 0.995 | 433.8 | 10 | 0.9977 | yes / yes | 2.76 [2.72, 2.78] | 119 | 417 |
| faiss_rabitq_ivf | 0.98 | 354.0 | 10 | 0.9881 | yes / no | 2.88 [2.86, 2.93] | 119 | 400 |
| faiss_rabitq_ivf | 0.99 | 382.6 | 10 | 0.9916 | yes / no | 2.62 [2.56, 2.69] | 119 | 395 |
| faiss_rabitq_ivf | 0.995 | 422.1 | 10 | 1.0000 | yes / yes | 2.69 [2.65, 2.71] | 119 | 401 |
| hnswlib_f32 | 0.98 | 265.1 | 10 | 0.9928 | yes / yes | 2.16 [2.11, 2.24] | 97 | 192 |
| hnswlib_f32 | 0.99 | 409.5 | 10 | 0.9954 | yes / yes | 2.81 [2.72, 2.91] | 94 | 190 |
| hnswlib_f32 | 0.995 | 484.5 | 10 | 0.9982 | yes / yes | 3.08 [2.98, 3.18] | 97 | 197 |
| ours_cascade | 0.98 | 122.7 | 10 | 0.9885 | yes / yes |  | 205 | 292 |
| ours_cascade | 0.99 | 145.9 | 10 | 0.9934 | yes / no |  | 190 | 452 |
| ours_cascade | 0.995 | 157.2 | 10 | 0.9980 | yes / no |  | 191 | 658 |
| scann | 0.98 | 296.1 | 10 | 1.0000 | yes / yes | 2.41 [2.40, 2.46] | 131 | 415 |
| scann | 0.99 | 296.1 | 10 | 1.0000 | yes / yes | 2.03 [1.98, 2.08] | 131 | 415 |
| scann | 0.995 | 296.1 | 10 | 1.0000 | yes / yes | 1.88 [1.86, 1.90] | 131 | 415 |
| usearch_b1_rescore | 0.98 | 300.0 | 10 | 0.9888 | yes / yes | 2.44 [2.42, 2.48] | 123 | 393 |
| usearch_b1_rescore | 0.99 | 341.8 | 10 | 0.9921 | yes / no | 2.34 [2.29, 2.40] | 125 | 390 |
| usearch_b1_rescore | 0.995 | 1106.2 | 10 | 0.9987 | yes / yes | 7.04 [6.93, 7.09] | 125 | 394 |
| usearch_f16 | 0.98 | 270.7 | 10 | 0.9935 | yes / yes | 2.21 [2.16, 2.24] | 66 | 174 |
| usearch_f16 | 0.99 | 488.1 | 10 | 0.9954 | yes / yes | 3.35 [3.26, 3.43] | 66 | 172 |
| usearch_f16 | 0.995 | 870.0 | 10 | 0.9991 | yes / yes | 5.54 [5.40, 5.62] | 66 | 174 |
| usearch_i8 | 0.98 | 140.1 | 10 | 0.9852 | yes / no | 1.14 [1.13, 1.16] | 57 | 129 |
| usearch_i8 | 0.99 | 251.4 | 10 | 0.9935 | yes / no | 1.72 [1.68, 1.76] | 57 | 125 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 487.5 / 0.9479 | 545.0 / 0.9482 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2248.7 / 0.9992 | 2316.8 / 0.9992 | 3367.0 / 0.9994 |
| diskann_vamana | L 200 | 749.7 / 0.9801 | 800.3 / 0.9803 | 766.4 / 0.9801 | 819.7 / 0.9803 | 933.0 / 0.9803 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3292.5 / 0.9998 | 3359.3 / 0.9998 | 4383.1 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1197.8 / 0.9960 | 1253.1 / 0.9963 | 1370.4 / 0.9963 | 1232.1 / 0.9960 | 1287.8 / 0.9960 | 1639.1 / 0.9963 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1891.0 / 0.9991 | 1954.9 / 0.9991 | 2309.1 / 0.9993 |  |  |  |
| faiss_bin_flat | exhaustive | 114.4 / 0.9842 | 162.3 / 0.9842 | 144.8 / 0.9932 | 193.9 / 0.9932 | 292.0 / 0.9932 | 205.9 / 0.9960 | 255.4 / 0.9962 | 551.3 / 0.9962 | 376.0 / 0.9990 | 424.9 / 0.9993 | 1320.7 / 0.9993 |
| faiss_bin_hnsw | ef 100 | 135.4 / 0.9524 | 186.1 / 0.9525 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 873.7 / 0.9985 | 924.2 / 0.9988 | 1891.2 / 0.9988 |
| faiss_bin_hnsw | ef 200 | 192.6 / 0.9745 | 244.6 / 0.9746 | 217.6 / 0.9806 | 271.0 / 0.9806 | 374.6 / 0.9806 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1606.7 / 0.9984 | 1667.8 / 0.9987 | 2632.8 / 0.9987 |
| faiss_bin_hnsw | ef 400 |  |  | 329.9 / 0.9901 | 384.6 / 0.9901 | 488.6 / 0.9901 | 378.5 / 0.9925 | 432.6 / 0.9928 | 750.1 / 0.9928 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 604.9 / 0.9958 | 655.8 / 0.9960 | 980.3 / 0.9960 |  |  |  |
| faiss_hnsw_flat | ef 100 | 305.3 / 0.9904 | 360.2 / 0.9906 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1916.8 / 0.9998 | 1980.9 / 0.9998 | 2982.4 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 485.4 / 0.9973 | 537.9 / 0.9975 | 512.8 / 0.9973 | 570.9 / 0.9975 | 689.9 / 0.9975 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3191.6 / 0.9998 | 3264.0 / 0.9998 | 4269.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 844.0 / 0.9986 | 897.3 / 0.9988 | 1018.0 / 0.9988 | 904.5 / 0.9986 | 953.0 / 0.9986 | 1302.0 / 0.9988 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1450.4 / 0.9992 | 1520.1 / 0.9992 | 1859.5 / 0.9994 |  |  |  |
| faiss_rabitq_flat | exhaustive | 295.8 / 0.9997 | 345.4 / 0.9999 | 321.2 / 0.9998 | 370.2 / 1.0000 | 467.3 / 1.0000 | 366.3 / 0.9998 | 413.5 / 1.0000 | 710.5 / 1.0000 | 487.4 / 0.9998 | 535.8 / 0.9999 | 1434.6 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 112.0 / 0.6233 | 160.5 / 0.6232 | 256.1 / 0.6232 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 169.4 / 0.7293 | 218.9 / 0.7293 | 512.9 / 0.7293 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 285.2 / 0.7688 | 334.4 / 0.7687 | 1220.2 / 0.7687 |
| faiss_rabitq_ivf | nprobe 3 | 75.3 / 0.4051 | 122.1 / 0.4050 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 358.1 / 0.8904 | 406.1 / 0.8902 | 1297.7 / 0.8902 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 95.6 / 0.4866 | 143.1 / 0.4866 | 238.1 / 0.4866 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 84.5 / 0.5113 | 131.7 / 0.5113 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 138.5 / 0.6011 | 187.9 / 0.6011 | 478.0 / 0.6011 |  |  |  |
| hnswlib_f32 | ef 100 | 294.5 / 0.9867 | 355.1 / 0.9868 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1749.5 / 0.9998 | 1787.4 / 0.9998 | 2830.9 / 1.0000 |
| hnswlib_f32 | ef 200 | 466.0 / 0.9970 | 540.2 / 0.9973 | 497.3 / 0.9970 | 554.5 / 0.9973 | 674.3 / 0.9973 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2699.7 / 0.9998 | 2689.3 / 0.9998 | 3742.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 832.6 / 0.9989 | 879.0 / 0.9991 | 993.3 / 0.9991 | 863.8 / 0.9989 | 909.8 / 0.9989 | 1249.8 / 0.9991 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1393.9 / 0.9992 | 1445.7 / 0.9992 | 1770.5 / 0.9994 |  |  |  |
| ours_scan | ef 100 | 60.6 / 0.9816 | 71.2 / 0.9817 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 97.5 / 0.9990 | 108.2 / 0.9993 | 338.1 / 0.9993 |
| ours_scan | ef 200 |  |  | 64.8 / 0.9916 | 75.6 / 0.9916 | 99.4 / 0.9916 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 73.9 / 0.9954 | 85.1 / 0.9957 | 156.9 / 0.9957 |  |  |  |
| ours_walk | ef 100 | 55.3 / 0.9678 | 67.2 / 0.9678 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 126.7 / 0.9976 | 139.4 / 0.9978 | 381.9 / 0.9978 |
| ours_walk | ef 200 | 63.8 / 0.9759 | 75.9 / 0.9760 | 67.2 / 0.9858 | 79.8 / 0.9858 | 102.9 / 0.9858 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 156.8 / 0.9989 | 171.7 / 0.9992 | 417.1 / 0.9992 |
| ours_walk | ef 400 |  |  | 79.6 / 0.9885 | 93.0 / 0.9885 | 117.5 / 0.9885 | 85.6 / 0.9912 | 98.6 / 0.9915 | 174.3 / 0.9915 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 102.2 / 0.9940 | 114.7 / 0.9943 | 197.1 / 0.9943 |  |  |  |
| scann | reorder 100 | 334.4 / 0.9998 | 375.7 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 746.3 / 0.9998 | 793.5 / 0.9998 | 1608.1 / 1.0000 |
| scann | reorder 200 |  |  | 383.2 / 0.9997 | 430.0 / 1.0000 | 516.7 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 476.7 / 0.9998 | 524.9 / 1.0000 | 790.0 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 119.2 / 0.9459 | 170.5 / 0.9459 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 586.4 / 0.9978 | 638.7 / 0.9980 | 1593.6 / 0.9980 |
| usearch_b1_rescore | ef 200 | 171.3 / 0.9674 | 222.9 / 0.9674 | 176.9 / 0.9749 | 230.8 / 0.9749 | 333.9 / 0.9749 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 972.9 / 0.9978 | 1028.9 / 0.9981 | 1980.6 / 0.9981 |
| usearch_b1_rescore | ef 400 |  |  | 275.3 / 0.9880 | 328.3 / 0.9880 | 431.8 / 0.9880 | 286.2 / 0.9898 | 339.1 / 0.9901 | 654.9 / 0.9901 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 467.8 / 0.9937 | 523.1 / 0.9940 | 841.1 / 0.9940 |  |  |  |

### d20k / jina-v2-base-code (n_ho = 2400, exact quality 0.8010)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 145.6 | 10 | 0.9911 | yes / yes | 1.95 [1.93, 1.97] | 107 | 299 |
| diskann_vamana | 0.99 | 194.7 | 10 | 0.9928 | yes / no | 2.60 [2.57, 2.65] | 109 | 308 |
| diskann_vamana | 0.995 | 197.2 | 10 | 0.9981 | yes / yes | 2.64 [2.59, 2.71] | 109 | 307 |
| faiss_bin_flat | 0.98 | 47.4 | 10 | 0.9986 | yes / yes | 0.63 [0.63, 0.64] | 118 | 319 |
| faiss_bin_flat | 0.99 | 47.4 | 10 | 0.9986 | yes / yes | 0.63 [0.63, 0.64] | 118 | 319 |
| faiss_bin_flat | 0.995 | 47.4 | 10 | 0.9986 | yes / yes | 0.63 [0.63, 0.64] | 118 | 319 |
| faiss_bin_hnsw | 0.98 | 80.0 | 10 | 0.9881 | yes / yes | 1.07 [1.06, 1.08] | 119 | 338 |
| faiss_bin_hnsw | 0.99 | 87.5 | 10 | 0.9904 | yes / no | 1.17 [1.16, 1.18] | 119 | 330 |
| faiss_bin_hnsw | 0.995 | 97.6 | 10 | 0.9975 | yes / no | 1.30 [1.29, 1.32] | 119 | 338 |
| faiss_exact | 0.98 | 1414.6 | 10 | 1.0000 | yes / yes | 18.92 [18.71, 19.19] | 87 | 201 |
| faiss_exact | 0.99 | 1414.6 | 10 | 1.0000 | yes / yes | 18.92 [18.71, 19.19] | 87 | 201 |
| faiss_exact | 0.995 | 1414.6 | 10 | 1.0000 | yes / yes | 18.92 [18.71, 19.19] | 87 | 201 |
| faiss_hnsw_flat | 0.98 | 61.5 | 10 | 0.9852 | yes / no | 0.82 [0.81, 0.85] | 90 | 208 |
| faiss_hnsw_flat | 0.99 | 94.0 | 10 | 0.9970 | yes / yes | 1.26 [1.24, 1.28] | 93 | 218 |
| faiss_hnsw_flat | 0.995 | 107.4 | 10 | 0.9973 | yes / no | 1.44 [1.41, 1.48] | 98 | 233 |
| faiss_hnsw_sq8 | 0.98 | 51.2 | 10 | 0.9822 | yes / no | 0.68 [0.68, 0.69] | 119 | 381 |
| faiss_hnsw_sq8 | 0.99 | 67.0 | 10 | 0.9969 | yes / yes | 0.90 [0.89, 0.91] | 119 | 382 |
| faiss_hnsw_sq8 | 0.995 | 74.3 | 10 | 0.9972 | yes / no | 0.99 [0.99, 1.01] | 119 | 396 |
| faiss_ivfpq_fs | 0.98 | 73.2 | 10 | 0.9876 | yes / yes | 0.98 [0.97, 0.99] | 120 | 343 |
| faiss_ivfpq_fs | 0.99 | 117.9 | 10 | 0.9999 | yes / yes | 1.58 [1.55, 1.59] | 120 | 344 |
| faiss_ivfpq_fs | 0.995 | 117.9 | 10 | 0.9999 | yes / yes | 1.58 [1.55, 1.59] | 120 | 344 |
| faiss_rabitq_flat | 0.98 | 231.0 | 10 | 1.0000 | yes / yes | 3.09 [3.06, 3.13] | 119 | 322 |
| faiss_rabitq_flat | 0.99 | 231.0 | 10 | 1.0000 | yes / yes | 3.09 [3.06, 3.13] | 119 | 322 |
| faiss_rabitq_flat | 0.995 | 231.0 | 10 | 1.0000 | yes / yes | 3.09 [3.06, 3.13] | 119 | 322 |
| faiss_rabitq_hnsw | 0.98 | 45.9 | 10 | 0.9847 | yes / no | 0.61 [0.61, 0.62] | 119 | 337 |
| faiss_rabitq_hnsw | 0.99 | 58.6 | 10 | 0.9940 | yes / no | 0.78 [0.78, 0.79] | 119 | 360 |
| faiss_rabitq_hnsw | 0.995 | 82.1 | 10 | 0.9982 | yes / yes | 1.10 [1.09, 1.11] | 119 | 359 |
| faiss_rabitq_ivf | 0.98 | 157.6 | 10 | 0.9897 | yes / yes | 2.11 [2.09, 2.13] | 119 | 337 |
| faiss_rabitq_ivf | 0.99 | 251.4 | 10 | 0.9964 | yes / yes | 3.36 [3.33, 3.40] | 119 | 336 |
| faiss_rabitq_ivf | 0.995 | 251.4 | 10 | 0.9964 | yes / no | 3.36 [3.33, 3.40] | 119 | 336 |
| hnswlib_f32 | 0.98 | 76.0 | 10 | 0.9865 | yes / yes | 1.02 [1.00, 1.03] | 93 | 188 |
| hnswlib_f32 | 0.99 | 101.8 | 10 | 0.9946 | yes / yes | 1.36 [1.33, 1.39] | 96 | 193 |
| hnswlib_f32 | 0.995 | 112.7 | 10 | 0.9967 | yes / no | 1.51 [1.49, 1.54] | 100 | 208 |
| ours_cascade | 0.98 | 74.8 | 10 | 0.9988 | yes / yes |  | 188 | 113 |
| ours_cascade | 0.99 | 74.8 | 10 | 0.9988 | yes / yes |  | 188 | 113 |
| ours_cascade | 0.995 | 74.8 | 10 | 0.9988 | yes / yes |  | 188 | 113 |
| scann | 0.98 | 255.5 | 10 | 1.0000 | yes / yes | 3.42 [3.39, 3.45] | 130 | 377 |
| scann | 0.99 | 255.5 | 10 | 1.0000 | yes / yes | 3.42 [3.39, 3.45] | 130 | 377 |
| scann | 0.995 | 255.5 | 10 | 1.0000 | yes / yes | 3.42 [3.39, 3.45] | 130 | 377 |
| usearch_b1_rescore | 0.98 | 89.3 | 10 | 0.9948 | yes / yes | 1.19 [1.18, 1.21] | 123 | 326 |
| usearch_b1_rescore | 0.99 | 89.3 | 10 | 0.9948 | yes / yes | 1.19 [1.18, 1.21] | 123 | 326 |
| usearch_b1_rescore | 0.995 | 91.5 | 10 | 0.9969 | yes / no | 1.22 [1.21, 1.24] | 123 | 327 |
| usearch_f16 | 0.98 | 70.5 | 10 | 0.9892 | yes / yes | 0.94 [0.93, 0.96] | 62 | 141 |
| usearch_f16 | 0.99 | 97.6 | 10 | 0.9943 | yes / yes | 1.31 [1.29, 1.33] | 65 | 150 |
| usearch_f16 | 0.995 | 167.1 | 10 | 0.9970 | yes / no | 2.23 [2.21, 2.29] | 65 | 152 |
| usearch_i8 | 0.98 | 35.8 | 10 | 0.9910 | yes / yes | 0.48 [0.48, 0.48] | 47 | 78 |
| usearch_i8 | 0.99 | 61.1 | 10 | 0.9963 | yes / yes | 0.82 [0.81, 0.83] | 47 | 79 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 491.5 / 0.9999 | 547.5 / 0.9999 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2343.1 / 1.0000 | 2407.5 / 1.0000 | 3462.9 / 1.0000 |
| diskann_vamana | L 200 | 759.0 / 1.0000 | 820.1 / 1.0000 | 778.8 / 1.0000 | 837.4 / 1.0000 | 950.1 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 3436.6 / 1.0000 | 3498.5 / 1.0000 | 4542.3 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1227.7 / 1.0000 | 1294.1 / 1.0000 | 1405.1 / 1.0000 | 1262.0 / 1.0000 | 1320.6 / 1.0000 | 1678.7 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 1965.0 / 1.0000 | 2020.3 / 1.0000 | 2377.4 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 114.1 / 0.9999 | 162.5 / 0.9999 | 145.9 / 0.9998 | 194.7 / 0.9998 | 293.0 / 0.9998 | 208.7 / 0.9998 | 257.4 / 0.9998 | 557.6 / 0.9998 | 384.5 / 0.9998 | 431.9 / 0.9998 | 1335.9 / 0.9998 |
| faiss_bin_hnsw | ef 100 | 129.5 / 0.9997 | 180.2 / 0.9997 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 844.6 / 0.9998 | 896.7 / 0.9998 | 1881.4 / 0.9998 |
| faiss_bin_hnsw | ef 200 | 184.4 / 0.9996 | 236.1 / 0.9996 | 208.4 / 0.9995 | 261.0 / 0.9995 | 364.5 / 0.9995 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1580.0 / 0.9998 | 1629.5 / 0.9998 | 2615.3 / 0.9998 |
| faiss_bin_hnsw | ef 400 |  |  | 314.5 / 0.9998 | 367.9 / 0.9998 | 472.7 / 0.9998 | 361.5 / 0.9998 | 415.3 / 0.9998 | 736.1 / 0.9998 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 580.1 / 0.9998 | 631.5 / 0.9998 | 958.6 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 100 | 323.7 / 0.9995 | 376.0 / 0.9995 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1985.8 / 1.0000 | 2038.2 / 1.0000 | 3052.9 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 509.6 / 1.0000 | 570.5 / 1.0000 | 541.2 / 1.0000 | 600.0 / 1.0000 | 713.3 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 3301.4 / 1.0000 | 3370.2 / 1.0000 | 4370.0 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 877.6 / 1.0000 | 935.4 / 1.0000 | 1048.5 / 1.0000 | 936.1 / 1.0000 | 995.1 / 1.0000 | 1336.6 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1517.0 / 1.0000 | 1582.0 / 1.0000 | 1926.1 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 295.5 / 1.0000 | 346.7 / 1.0000 | 322.3 / 1.0000 | 369.0 / 1.0000 | 467.0 / 1.0000 | 367.6 / 1.0000 | 415.9 / 1.0000 | 715.0 / 1.0000 | 490.4 / 1.0000 | 537.6 / 1.0000 | 1443.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 108.5 / 0.8846 | 157.7 / 0.8846 | 253.5 / 0.8847 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 164.2 / 0.9353 | 212.7 / 0.9353 | 509.9 / 0.9353 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 276.9 / 0.9475 | 326.5 / 0.9475 | 1224.9 / 0.9475 |
| faiss_rabitq_ivf | nprobe 3 | 74.2 / 0.7322 | 120.0 / 0.7322 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 345.5 / 0.9780 | 394.6 / 0.9780 | 1299.4 / 0.9780 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 93.4 / 0.8079 | 141.3 / 0.8079 | 236.5 / 0.8079 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 82.9 / 0.8284 | 129.9 / 0.8284 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 135.9 / 0.8711 | 184.6 / 0.8711 | 477.0 / 0.8711 |  |  |  |
| hnswlib_f32 | ef 100 | 345.3 / 0.9994 | 399.4 / 0.9994 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 1900.1 / 1.0000 | 1974.2 / 1.0000 | 2978.1 / 1.0000 |
| hnswlib_f32 | ef 200 | 555.1 / 1.0000 | 609.6 / 1.0000 | 573.7 / 1.0000 | 626.5 / 1.0000 | 741.9 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 2860.5 / 1.0000 | 2961.8 / 1.0000 | 3919.5 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 927.6 / 1.0000 | 979.5 / 1.0000 | 1098.3 / 1.0000 | 971.5 / 1.0000 | 1021.0 / 1.0000 | 1374.8 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1539.9 / 1.0000 | 1606.0 / 1.0000 | 1954.0 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 59.8 / 0.9999 | 70.3 / 0.9999 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 98.2 / 0.9998 | 108.0 / 0.9998 | 353.7 / 0.9998 |
| ours_scan | ef 200 |  |  | 64.2 / 0.9998 | 75.4 / 0.9998 | 99.7 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 73.5 / 0.9998 | 85.3 / 0.9998 | 163.1 / 0.9998 |  |  |  |
| ours_walk | ef 100 | 50.3 / 0.9990 | 62.7 / 0.9990 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 122.2 / 0.9998 | 135.5 / 0.9998 | 386.0 / 0.9998 |
| ours_walk | ef 200 | 58.8 / 0.9993 | 71.7 / 0.9993 | 62.5 / 0.9993 | 75.6 / 0.9993 | 99.6 / 0.9993 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 155.8 / 0.9998 | 170.0 / 0.9998 | 438.6 / 0.9998 |
| ours_walk | ef 400 |  |  | 73.8 / 0.9993 | 87.2 / 0.9993 | 111.8 / 0.9993 | 80.1 / 0.9993 | 92.4 / 0.9993 | 174.2 / 0.9993 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 97.3 / 0.9993 | 110.7 / 0.9993 | 193.1 / 0.9993 |  |  |  |
| scann | reorder 100 | 333.3 / 1.0000 | 376.4 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 754.2 / 1.0000 | 804.6 / 1.0000 | 1624.0 / 1.0000 |
| scann | reorder 200 |  |  | 382.3 / 1.0000 | 428.6 / 1.0000 | 513.4 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 477.0 / 1.0000 | 525.1 / 1.0000 | 790.9 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 114.4 / 0.9968 | 165.5 / 0.9968 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 565.0 / 0.9973 | 616.1 / 0.9973 | 1588.0 / 0.9973 |
| usearch_b1_rescore | ef 200 | 163.7 / 0.9971 | 215.7 / 0.9971 | 169.7 / 0.9971 | 223.3 / 0.9971 | 326.1 / 0.9971 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 944.6 / 0.9973 | 998.7 / 0.9973 | 1968.8 / 0.9973 |
| usearch_b1_rescore | ef 400 |  |  | 276.4 / 0.9974 | 328.3 / 0.9974 | 433.4 / 0.9974 | 287.4 / 0.9973 | 340.7 / 0.9973 | 658.3 / 0.9973 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 449.0 / 0.9973 | 502.9 / 0.9973 | 823.3 / 0.9973 |  |  |  |

### dall / CodeRankEmbed (n_ho = 2400, exact quality 0.7906)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 1801.3 | 10 | 0.9930 | yes / yes | 7.16 [7.09, 7.29] | 497 | 1900 |
| diskann_vamana | 0.99 | 3060.0 | 10 | 0.9955 | yes / yes | 10.93 [10.61, 11.22] | 500 | 1911 |
| diskann_vamana | 0.995 | 3779.5 | 10 | 0.9982 | yes / yes | 12.55 [12.33, 12.88] | 507 | 1919 |
| faiss_bin_flat | 0.98 | 254.8 | 10 | 0.9868 | yes / no | 1.01 [1.00, 1.03] | 471 | 2277 |
| faiss_bin_flat | 0.99 | 295.2 | 10 | 0.9944 | yes / no | 1.05 [1.03, 1.07] | 471 | 2241 |
| faiss_bin_flat | 0.995 | 360.6 | 10 | 0.9973 | yes / no | 1.20 [1.18, 1.21] | 471 | 2230 |
| faiss_bin_hnsw | 0.98 | 341.6 | 10 | 0.9828 | yes / no | 1.36 [1.34, 1.39] | 541 | 2432 |
| faiss_bin_hnsw | 0.99 | 703.3 | 10 | 0.9918 | yes / no | 2.51 [2.45, 2.56] | 506 | 2368 |
| faiss_bin_hnsw | 0.995 | 1225.7 | 10 | 0.9965 | yes / no | 4.07 [4.03, 4.14] | 506 | 2381 |
| faiss_exact | 0.98 | 10844.5 | 10 | 1.0000 | yes / yes | 43.12 [41.93, 45.28] | 440 | 1175 |
| faiss_exact | 0.99 | 10844.5 | 10 | 1.0000 | yes / yes | 38.74 [37.42, 40.48] | 440 | 1175 |
| faiss_exact | 0.995 | 10844.5 | 10 | 1.0000 | yes / yes | 36.00 [34.97, 37.81] | 440 | 1175 |
| faiss_hnsw_flat | 0.98 | 651.8 | 10 | 0.9906 | yes / yes | 2.59 [2.50, 2.65] | 460 | 1190 |
| faiss_hnsw_flat | 0.99 | 866.6 | 10 | 0.9937 | yes / no | 3.10 [3.00, 3.17] | 477 | 1226 |
| faiss_hnsw_flat | 0.995 | 1623.2 | 10 | 0.9993 | yes / yes | 5.39 [5.27, 5.58] | 477 | 1393 |
| faiss_hnsw_sq8 | 0.98 | 545.0 | 10 | 0.9891 | yes / yes | 2.17 [2.12, 2.24] | 575 | 2579 |
| faiss_hnsw_sq8 | 0.99 | 715.5 | 10 | 0.9943 | yes / no | 2.56 [2.47, 2.61] | 610 | 2651 |
| faiss_hnsw_sq8 | 0.995 | 1368.0 | 10 | 0.9991 | yes / yes | 4.54 [4.35, 4.58] | 610 | 2676 |
| faiss_ivfpq_fs | 0.98 | 401.1 | 10 | 0.9998 | yes / yes | 1.59 [1.58, 1.63] | 473 | 2304 |
| faiss_ivfpq_fs | 0.99 | 401.1 | 10 | 0.9998 | yes / yes | 1.43 [1.40, 1.46] | 473 | 2304 |
| faiss_ivfpq_fs | 0.995 | 401.1 | 10 | 0.9998 | yes / yes | 1.33 [1.32, 1.35] | 473 | 2304 |
| faiss_rabitq_flat | 0.98 | 1534.5 | 10 | 0.9988 | yes / yes | 6.10 [6.03, 6.18] | 471 | 2308 |
| faiss_rabitq_flat | 0.99 | 1534.5 | 10 | 0.9988 | yes / yes | 5.48 [5.36, 5.55] | 471 | 2308 |
| faiss_rabitq_flat | 0.995 | 1534.5 | 10 | 0.9988 | yes / yes | 5.09 [5.04, 5.15] | 471 | 2308 |
| faiss_rabitq_hnsw | 0.98 | 313.8 | 10 | 0.9843 | yes / no | 1.25 [1.23, 1.28] | 541 | 2535 |
| faiss_rabitq_hnsw | 0.99 | 445.7 | 10 | 0.9931 | yes / no | 1.59 [1.54, 1.63] | 541 | 2517 |
| faiss_rabitq_hnsw | 0.995 | 639.0 | 10 | 0.9990 | yes / yes | 2.12 [2.09, 2.15] | 541 | 2559 |
| faiss_rabitq_ivf | 0.98 | 1201.2 | 10 | 0.9938 | yes / yes | 4.78 [4.71, 4.86] | 472 | 2360 |
| faiss_rabitq_ivf | 0.99 | 1748.3 | 10 | 1.0000 | yes / yes | 6.25 [6.11, 6.36] | 472 | 2279 |
| faiss_rabitq_ivf | 0.995 | 1748.3 | 10 | 1.0000 | yes / yes | 5.80 [5.74, 5.89] | 472 | 2279 |
| hnswlib_f32 | 0.98 | 613.0 | 10 | 0.9902 | yes / yes | 2.44 [2.39, 2.56] | 525 | 1246 |
| hnswlib_f32 | 0.99 | 962.4 | 10 | 0.9980 | yes / yes | 3.44 [3.33, 3.61] | 491 | 1144 |
| hnswlib_f32 | 0.995 | 1785.5 | 10 | 0.9986 | yes / yes | 5.93 [5.77, 6.17] | 491 | 1204 |
| ours_cascade | 0.98 | 251.5 | 10 | 0.9852 | yes / no |  | 552 | 221 |
| ours_cascade | 0.99 | 280.0 | 10 | 0.9946 | yes / no |  | 556 | 287 |
| ours_cascade | 0.995 | 301.2 | 10 | 0.9971 | yes / no |  | 556 | 399 |
| scann | 0.98 | 1849.7 | 10 | 1.0000 | yes / yes | 7.36 [7.23, 7.52] | 508 | 1600 |
| scann | 0.99 | 1849.7 | 10 | 1.0000 | yes / yes | 6.61 [6.43, 6.76] | 508 | 1600 |
| scann | 0.995 | 1849.7 | 10 | 1.0000 | yes / yes | 6.14 [6.04, 6.27] | 508 | 1600 |
| usearch_b1_rescore | 0.98 | 504.6 | 10 | 0.9838 | yes / no | 2.01 [1.96, 2.05] | 523 | 2462 |
| usearch_b1_rescore | 0.99 | 708.8 | 10 | 0.9893 | no / no | 2.53 [2.45, 2.60] | 557 | 2604 |
| usearch_b1_rescore | 0.995 | 1137.0 | 10 | 0.9940 | no / no | 3.77 [3.63, 3.84] | 523 | 2451 |
| usearch_f16 | 0.98 | 1813.9 | 10 | 0.9910 | yes / yes | 7.21 [6.94, 7.55] | 284 | 1026 |
| usearch_f16 | 0.99 | 2398.5 | 10 | 0.9935 | yes / no | 8.57 [8.26, 8.99] | 267 | 977 |
| usearch_f16 | 0.995 | 3733.0 | 10 | 0.9971 | yes / no | 12.39 [11.88, 12.89] | 319 | 1178 |
| usearch_i8 | 0.98 | 1269.3 | 10 | 0.9917 | yes / yes | 5.05 [4.91, 5.18] | 181 | 550 |
| usearch_i8 | 0.99 | 1269.3 | 10 | 0.9917 | yes / no | 4.53 [4.38, 4.65] | 181 | 550 |
| usearch_i8 | 0.995 | 2406.4 | 10 | 0.9937 | no / no | 7.99 [7.81, 8.20] | 181 | 553 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 930.5 / 0.9665 | 991.8 / 0.9664 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 5636.3 / 0.9994 | 5676.6 / 0.9999 | 6745.8 / 0.9998 |
| diskann_vamana | L 200 | 1553.1 / 0.9860 | 1605.5 / 0.9859 | 1568.8 / 0.9860 | 1625.7 / 0.9859 | 1739.0 / 0.9859 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 9325.7 / 0.9997 | 9380.3 / 1.0001 | 10412.4 / 1.0001 |
| diskann_vamana | L 400 |  |  | 2686.8 / 0.9985 | 2756.2 / 0.9984 | 2861.1 / 0.9984 | 2726.3 / 0.9984 | 2780.4 / 0.9984 | 3129.7 / 0.9984 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 4684.2 / 0.9990 | 4694.1 / 0.9994 | 5079.9 / 0.9993 |  |  |  |
| faiss_bin_flat | exhaustive | 334.1 / 0.9934 | 391.6 / 0.9934 | 386.1 / 0.9958 | 443.7 / 0.9958 | 559.8 / 0.9958 | 490.5 / 0.9982 | 547.7 / 0.9982 | 891.4 / 0.9981 | 794.7 / 0.9995 | 855.0 / 0.9994 | 1895.6 / 0.9994 |
| faiss_bin_hnsw | ef 100 | 191.3 / 0.9456 | 257.1 / 0.9456 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1448.9 / 0.9985 | 1513.6 / 0.9984 | 2728.7 / 0.9984 |
| faiss_bin_hnsw | ef 200 | 273.9 / 0.9707 | 336.9 / 0.9707 | 314.3 / 0.9734 | 381.6 / 0.9734 | 511.6 / 0.9734 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2674.8 / 0.9992 | 2731.3 / 0.9992 | 3936.1 / 0.9991 |
| faiss_bin_hnsw | ef 400 |  |  | 488.4 / 0.9849 | 555.3 / 0.9849 | 685.7 / 0.9849 | 576.7 / 0.9876 | 641.4 / 0.9876 | 1041.4 / 0.9876 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 963.5 / 0.9969 | 1028.0 / 0.9969 | 1426.5 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 466.2 / 0.9828 | 521.8 / 0.9828 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3413.0 / 0.9992 | 3478.4 / 0.9995 | 4502.7 / 0.9995 |
| faiss_hnsw_flat | ef 200 | 789.5 / 0.9914 | 840.4 / 0.9913 | 812.3 / 0.9914 | 878.2 / 0.9913 | 992.4 / 0.9913 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 6110.7 / 0.9997 | 6185.1 / 1.0001 | 7231.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1413.1 / 0.9979 | 1487.0 / 0.9978 | 1592.8 / 0.9978 | 1502.5 / 0.9978 | 1539.7 / 0.9979 | 1897.6 / 0.9978 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2635.9 / 0.9991 | 2668.2 / 0.9994 | 3043.3 / 0.9993 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1622.0 / 1.0001 | 1689.5 / 1.0001 | 1679.4 / 1.0001 | 1729.0 / 1.0001 | 1832.9 / 1.0001 | 1749.1 / 1.0000 | 1814.0 / 1.0001 | 2156.5 / 1.0000 | 2006.7 / 0.9997 | 2063.1 / 1.0001 | 3109.6 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 88.1 / 0.3543 | 141.1 / 0.3543 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 459.6 / 0.7749 | 515.5 / 0.7749 | 1533.8 / 0.7749 |
| faiss_rabitq_ivf | nprobe 2 | 100.7 / 0.4667 | 153.7 / 0.4667 | 119.1 / 0.4667 | 173.3 / 0.4667 | 279.8 / 0.4667 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 137.9 / 0.5694 | 193.4 / 0.5694 | 302.0 / 0.5694 | 179.3 / 0.5694 | 234.4 / 0.5694 | 562.2 / 0.5694 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 217.5 / 0.6688 | 275.4 / 0.6689 | 608.2 / 0.6689 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 364.2 / 0.6870 | 421.1 / 0.6870 | 1426.8 / 0.6870 |
| hnswlib_f32 | ef 100 | 507.3 / 0.9824 | 559.7 / 0.9824 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 3448.1 / 0.9992 | 3551.8 / 0.9996 | 4644.0 / 0.9995 |
| hnswlib_f32 | ef 200 | 865.1 / 0.9959 | 922.5 / 0.9958 | 855.0 / 0.9959 | 946.6 / 0.9958 | 1046.0 / 0.9958 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 5876.1 / 0.9991 | 6035.7 / 0.9995 | 7159.0 / 0.9995 |
| hnswlib_f32 | ef 400 |  |  | 1499.9 / 0.9986 | 1590.7 / 0.9986 | 1699.1 / 0.9985 | 1603.2 / 0.9985 | 1630.6 / 0.9986 | 2002.5 / 0.9985 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2762.6 / 0.9992 | 2857.7 / 0.9993 | 3222.1 / 0.9992 |  |  |  |
| ours_scan | ef 100 | 232.2 / 0.9932 | 249.9 / 0.9932 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 327.4 / 0.9990 | 345.9 / 0.9989 | 627.4 / 0.9989 |
| ours_scan | ef 200 |  |  | 243.7 / 0.9952 | 260.6 / 0.9952 | 291.9 / 0.9952 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 265.8 / 0.9981 | 279.4 / 0.9981 | 372.4 / 0.9981 |  |  |  |
| ours_walk | ef 100 | 81.1 / 0.9769 | 97.5 / 0.9769 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 278.9 / 0.9966 | 298.7 / 0.9965 | 643.9 / 0.9964 |
| ours_walk | ef 200 | 96.5 / 0.9823 | 112.9 / 0.9823 | 106.8 / 0.9846 | 122.5 / 0.9846 | 154.2 / 0.9846 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 341.6 / 0.9992 | 361.0 / 0.9991 | 705.9 / 0.9991 |
| ours_walk | ef 400 |  |  | 131.8 / 0.9896 | 147.4 / 0.9896 | 177.0 / 0.9896 | 149.8 / 0.9927 | 166.5 / 0.9927 | 267.1 / 0.9927 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 195.0 / 0.9948 | 210.7 / 0.9948 | 309.5 / 0.9948 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 141.7 / 0.1222 | 187.9 / 0.1222 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 763.3 / 0.3873 | 811.1 / 0.3873 | 1686.7 / 0.3873 |
| scann | leaves_to_search 2, reorder 100 | 153.2 / 0.1680 | 198.9 / 0.1680 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 205.8 / 0.1680 | 251.3 / 0.1680 | 343.8 / 0.1680 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 223.3 / 0.2342 | 273.1 / 0.2342 | 365.8 / 0.2342 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 330.8 / 0.2342 | 378.7 / 0.2342 | 665.6 / 0.2342 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 690.7 / 0.3020 | 742.6 / 0.3020 | 1594.4 / 0.3020 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 364.0 / 0.3020 | 413.3 / 0.3020 | 706.1 / 0.3020 |  |  |  |
| usearch_b1_rescore | ef 100 | 183.1 / 0.9338 | 250.8 / 0.9338 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1256.6 / 0.9957 | 1326.1 / 0.9956 | 2517.6 / 0.9956 |
| usearch_b1_rescore | ef 200 | 276.3 / 0.9664 | 341.5 / 0.9664 | 297.8 / 0.9677 | 364.7 / 0.9677 | 481.0 / 0.9677 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2155.5 / 0.9981 | 2227.2 / 0.9979 | 3336.0 / 0.9979 |
| usearch_b1_rescore | ef 400 |  |  | 493.4 / 0.9821 | 563.3 / 0.9821 | 670.9 / 0.9821 | 537.6 / 0.9842 | 610.1 / 0.9842 | 970.3 / 0.9842 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 910.5 / 0.9944 | 973.4 / 0.9944 | 1373.2 / 0.9944 |  |  |  |

### dall / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.6332)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 539.9 | 10 | 0.9900 | yes / yes | 1.65 [1.62, 1.69] | 471 | 2287 |
| faiss_exact | 0.98 | 10977.6 | 10 | 1.0000 | yes / yes | 33.60 [32.20, 34.62] | 440 | 1181 |
| faiss_exact | 0.99 | 10977.6 | 10 | 1.0000 | yes / yes | 28.52 [27.47, 29.19] | 440 | 1181 |
| faiss_exact | 0.995 | 10977.6 | 10 | 1.0000 | yes / yes | 22.31 [21.53, 23.05] | 440 | 1181 |
| faiss_hnsw_flat | 0.98 | 1252.0 | 10 | 0.9909 | yes / yes | 3.83 [3.75, 3.95] | 477 | 1268 |
| faiss_hnsw_flat | 0.99 | 1374.4 | 10 | 0.9907 | yes / no | 3.57 [3.50, 3.72] | 511 | 1352 |
| faiss_hnsw_sq8 | 0.98 | 1041.3 | 10 | 0.9926 | yes / yes | 3.19 [3.10, 3.32] | 610 | 2688 |
| faiss_hnsw_sq8 | 0.99 | 1151.9 | 10 | 0.9907 | yes / no | 2.99 [2.95, 3.11] | 644 | 2771 |
| faiss_hnsw_sq8 | 0.995 | 2171.4 | 10 | 0.9988 | yes / yes | 4.41 [4.38, 4.59] | 644 | 2776 |
| faiss_ivfpq_fs | 0.98 | 403.5 | 10 | 0.9980 | yes / yes | 1.24 [1.19, 1.28] | 473 | 2335 |
| faiss_ivfpq_fs | 0.99 | 403.5 | 10 | 0.9980 | yes / yes | 1.05 [1.01, 1.08] | 473 | 2335 |
| faiss_ivfpq_fs | 0.995 | 550.0 | 10 | 0.9992 | yes / yes | 1.12 [1.11, 1.15] | 473 | 2318 |
| faiss_rabitq_flat | 0.98 | 1557.7 | 10 | 0.9981 | yes / yes | 4.77 [4.69, 4.90] | 471 | 2267 |
| faiss_rabitq_flat | 0.99 | 1557.7 | 10 | 0.9981 | yes / yes | 4.05 [4.01, 4.13] | 471 | 2267 |
| faiss_rabitq_flat | 0.995 | 1557.7 | 10 | 0.9981 | yes / yes | 3.17 [3.15, 3.25] | 471 | 2267 |
| faiss_rabitq_hnsw | 0.98 | 1088.5 | 10 | 0.9923 | yes / yes | 3.33 [3.24, 3.42] | 541 | 2489 |
| faiss_rabitq_ivf | 0.98 | 1205.8 | 10 | 0.9887 | yes / yes | 3.69 [3.62, 3.78] | 472 | 2315 |
| faiss_rabitq_ivf | 0.99 | 1747.6 | 10 | 1.0000 | yes / yes | 4.54 [4.51, 4.65] | 472 | 2316 |
| faiss_rabitq_ivf | 0.995 | 1747.6 | 10 | 1.0000 | yes / yes | 3.55 [3.54, 3.66] | 472 | 2316 |
| hnswlib_f32 | 0.98 | 1285.7 | 10 | 0.9857 | yes / no | 3.94 [3.83, 4.08] | 491 | 1200 |
| hnswlib_f32 | 0.99 | 2330.0 | 10 | 0.9968 | yes / yes | 6.05 [5.95, 6.33] | 491 | 1165 |
| hnswlib_f32 | 0.995 | 2471.1 | 10 | 0.9966 | yes / no | 5.02 [4.93, 5.24] | 525 | 1281 |
| ours_cascade | 0.98 | 326.7 | 10 | 0.9817 | yes / no |  | 562 | 510 |
| ours_cascade | 0.99 | 384.9 | 10 | 0.9948 | yes / no |  | 562 | 879 |
| ours_cascade | 0.995 | 492.0 | 10 | 0.9950 | no / no |  | 556 | 1451 |
| scann | 0.98 | 1859.0 | 10 | 1.0000 | yes / yes | 5.69 [5.55, 5.82] | 508 | 1586 |
| scann | 0.99 | 1859.0 | 10 | 1.0000 | yes / yes | 4.83 [4.75, 4.91] | 508 | 1586 |
| scann | 0.995 | 1859.0 | 10 | 1.0000 | yes / yes | 3.78 [3.72, 3.87] | 508 | 1586 |
| usearch_f16 | 0.98 | 3593.6 | 10 | 0.9939 | yes / yes | 11.00 [10.74, 11.55] | 267 | 981 |
| usearch_f16 | 0.99 | 4596.8 | 10 | 0.9968 | yes / yes | 11.94 [11.76, 12.45] | 319 | 1189 |
| usearch_i8 | 0.98 | 3218.7 | 10 | 0.9879 | yes / yes | 9.85 [9.66, 10.11] | 181 | 543 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 791.7 / 0.7097 | 847.0 / 0.7098 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 4115.5 / 0.9742 | 4187.7 / 0.9742 | 5213.1 / 0.9741 |
| diskann_vamana | L 200 | 1230.2 / 0.8311 | 1303.1 / 0.8312 | 1252.2 / 0.8310 | 1313.0 / 0.8313 | 1417.7 / 0.8312 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 6877.3 / 0.9940 | 6987.8 / 0.9940 | 7988.9 / 0.9940 |
| diskann_vamana | L 400 |  |  | 2040.4 / 0.9115 | 2088.6 / 0.9118 | 2200.9 / 0.9117 | 2075.2 / 0.9115 | 2122.7 / 0.9118 | 2460.1 / 0.9117 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 3413.9 / 0.9608 | 3472.2 / 0.9606 | 3813.3 / 0.9605 |  |  |  |
| faiss_bin_flat | exhaustive | 334.6 / 0.9586 | 390.0 / 0.9586 | 387.5 / 0.9716 | 444.2 / 0.9717 | 558.5 / 0.9717 | 488.0 / 0.9855 | 547.0 / 0.9855 | 886.0 / 0.9855 | 787.0 / 0.9946 | 841.4 / 0.9948 | 1873.0 / 0.9948 |
| faiss_bin_hnsw | ef 100 | 181.2 / 0.8086 | 247.2 / 0.8087 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1316.3 / 0.9835 | 1389.5 / 0.9838 | 2582.1 / 0.9837 |
| faiss_bin_hnsw | ef 200 | 254.2 / 0.8824 | 321.7 / 0.8824 | 294.2 / 0.8919 | 364.6 / 0.8919 | 497.0 / 0.8919 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2406.1 / 0.9886 | 2487.6 / 0.9889 | 3715.3 / 0.9888 |
| faiss_bin_hnsw | ef 400 |  |  | 447.1 / 0.9362 | 517.6 / 0.9363 | 648.0 / 0.9363 | 530.5 / 0.9464 | 599.7 / 0.9462 | 1001.1 / 0.9463 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 869.3 / 0.9701 | 934.7 / 0.9700 | 1339.4 / 0.9701 |  |  |  |
| faiss_hnsw_flat | ef 100 | 388.2 / 0.9282 | 444.9 / 0.9284 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2722.8 / 0.9987 | 2759.6 / 0.9988 | 3804.3 / 0.9987 |
| faiss_hnsw_flat | ef 200 | 630.4 / 0.9634 | 686.0 / 0.9634 | 657.3 / 0.9633 | 715.7 / 0.9635 | 833.2 / 0.9634 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 4878.7 / 0.9987 | 4984.9 / 0.9988 | 6010.7 / 0.9987 |
| faiss_hnsw_flat | ef 400 |  |  | 1123.4 / 0.9866 | 1179.0 / 0.9867 | 1303.7 / 0.9867 | 1187.3 / 0.9864 | 1252.1 / 0.9867 | 1597.2 / 0.9867 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2061.8 / 0.9965 | 2114.1 / 0.9967 | 2470.1 / 0.9966 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1622.1 / 0.9996 | 1704.5 / 0.9996 | 1678.0 / 1.0001 | 1726.4 / 1.0001 | 1845.7 / 1.0000 | 1761.5 / 1.0001 | 1805.6 / 1.0000 | 2154.6 / 1.0000 | 1995.0 / 1.0000 | 2041.2 / 1.0001 | 3073.6 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 91.6 / 0.1445 | 143.1 / 0.1445 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 446.9 / 0.4763 | 498.8 / 0.4766 | 1508.4 / 0.4765 |
| faiss_rabitq_ivf | nprobe 2 | 102.9 / 0.1944 | 156.3 / 0.1944 | 122.2 / 0.1944 | 175.7 / 0.1944 | 280.1 / 0.1944 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 139.9 / 0.2562 | 193.7 / 0.2562 | 301.6 / 0.2562 | 180.3 / 0.2562 | 237.1 / 0.2562 | 559.8 / 0.2562 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 214.5 / 0.3462 | 273.0 / 0.3464 | 601.3 / 0.3464 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 355.2 / 0.3616 | 411.6 / 0.3617 | 1406.3 / 0.3617 |
| hnswlib_f32 | ef 100 | 393.3 / 0.9036 | 451.6 / 0.9038 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2607.0 / 0.9968 | 2683.6 / 0.9969 | 3751.9 / 0.9968 |
| hnswlib_f32 | ef 200 | 642.3 / 0.9490 | 716.3 / 0.9491 | 672.2 / 0.9490 | 737.3 / 0.9491 | 844.6 / 0.9491 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 4464.7 / 0.9981 | 4594.4 / 0.9981 | 5629.6 / 0.9980 |
| hnswlib_f32 | ef 400 |  |  | 1170.1 / 0.9790 | 1222.8 / 0.9793 | 1342.8 / 0.9793 | 1204.6 / 0.9790 | 1256.6 / 0.9793 | 1622.9 / 0.9793 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2084.6 / 0.9946 | 2145.9 / 0.9948 | 2501.6 / 0.9947 |  |  |  |
| ours_scan | ef 100 | 231.9 / 0.9537 | 249.7 / 0.9537 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 324.3 / 0.9946 | 339.9 / 0.9949 | 623.4 / 0.9948 |
| ours_scan | ef 200 |  |  | 242.8 / 0.9680 | 260.5 / 0.9681 | 288.0 / 0.9681 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 263.7 / 0.9817 | 281.2 / 0.9817 | 373.7 / 0.9817 |  |  |  |
| ours_walk | ef 100 | 77.6 / 0.8783 | 92.8 / 0.8783 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 257.1 / 0.9806 | 275.2 / 0.9808 | 615.4 / 0.9807 |
| ours_walk | ef 200 | 89.1 / 0.9126 | 105.3 / 0.9126 | 99.6 / 0.9251 | 116.1 / 0.9252 | 152.3 / 0.9252 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 305.7 / 0.9889 | 322.6 / 0.9893 | 679.5 / 0.9892 |
| ours_walk | ef 400 |  |  | 122.7 / 0.9412 | 137.0 / 0.9413 | 169.2 / 0.9413 | 141.1 / 0.9517 | 158.4 / 0.9517 | 264.7 / 0.9518 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 176.0 / 0.9690 | 190.7 / 0.9690 | 292.8 / 0.9690 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 140.4 / 0.0704 | 184.4 / 0.0704 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 747.5 / 0.2078 | 795.6 / 0.2077 | 1652.1 / 0.2077 |
| scann | leaves_to_search 2, reorder 100 | 150.3 / 0.0930 | 195.9 / 0.0930 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 201.4 / 0.0930 | 248.6 / 0.0930 | 340.2 / 0.0930 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 220.6 / 0.1126 | 270.7 / 0.1126 | 364.0 / 0.1126 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 322.4 / 0.1126 | 372.7 / 0.1126 | 643.2 / 0.1126 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 669.2 / 0.1481 | 719.1 / 0.1481 | 1564.9 / 0.1481 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 361.1 / 0.1481 | 406.0 / 0.1481 | 690.9 / 0.1481 |  |  |  |
| usearch_b1_rescore | ef 100 | 179.2 / 0.8132 | 245.9 / 0.8132 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1114.7 / 0.9787 | 1177.8 / 0.9790 | 2309.6 / 0.9790 |
| usearch_b1_rescore | ef 200 | 257.8 / 0.8768 | 311.8 / 0.8768 | 279.8 / 0.8899 | 344.2 / 0.8900 | 460.2 / 0.8900 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1870.2 / 0.9901 | 1948.8 / 0.9904 | 3046.3 / 0.9904 |
| usearch_b1_rescore | ef 400 |  |  | 437.3 / 0.9306 | 492.6 / 0.9307 | 618.5 / 0.9307 | 478.0 / 0.9427 | 546.6 / 0.9426 | 904.9 / 0.9427 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 799.0 / 0.9628 | 867.9 / 0.9628 | 1242.5 / 0.9628 |  |  |  |

### dall / jina-v2-base-code (n_ho = 2400, exact quality 0.7576)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 522.5 | 10 | 0.9892 | yes / yes | 2.10 [2.07, 2.18] | 483 | 1840 |
| diskann_vamana | 0.99 | 789.3 | 10 | 0.9955 | yes / yes | 3.18 [3.09, 3.24] | 498 | 1899 |
| diskann_vamana | 0.995 | 900.5 | 10 | 0.9979 | yes / yes | 3.36 [3.29, 3.43] | 483 | 1839 |
| faiss_bin_flat | 0.98 | 237.0 | 10 | 0.9893 | yes / yes | 0.95 [0.95, 0.97] | 471 | 2160 |
| faiss_bin_flat | 0.99 | 250.1 | 10 | 0.9968 | yes / yes | 1.01 [0.99, 1.02] | 471 | 2164 |
| faiss_bin_flat | 0.995 | 250.1 | 10 | 0.9968 | yes / no | 0.93 [0.92, 0.94] | 471 | 2164 |
| faiss_bin_hnsw | 0.98 | 117.6 | 10 | 0.9850 | yes / no | 0.47 [0.47, 0.48] | 541 | 2388 |
| faiss_bin_hnsw | 0.99 | 186.2 | 10 | 0.9929 | yes / no | 0.75 [0.74, 0.77] | 471 | 2226 |
| faiss_bin_hnsw | 0.995 | 230.2 | 10 | 0.9954 | yes / no | 0.86 [0.85, 0.87] | 506 | 2280 |
| faiss_exact | 0.98 | 10884.0 | 10 | 1.0000 | yes / yes | 43.83 [43.06, 44.89] | 440 | 1305 |
| faiss_exact | 0.99 | 10884.0 | 10 | 1.0000 | yes / yes | 43.83 [43.06, 44.89] | 440 | 1305 |
| faiss_exact | 0.995 | 10884.0 | 10 | 1.0000 | yes / yes | 40.63 [39.77, 41.38] | 440 | 1305 |
| faiss_hnsw_flat | 0.98 | 160.8 | 10 | 0.9877 | yes / yes | 0.65 [0.63, 0.67] | 459 | 1355 |
| faiss_hnsw_flat | 0.99 | 207.9 | 10 | 0.9879 | no / no | 0.84 [0.82, 0.86] | 477 | 1405 |
| faiss_hnsw_flat | 0.995 | 425.7 | 10 | 0.9979 | yes / yes | 1.59 [1.54, 1.62] | 511 | 1526 |
| faiss_hnsw_sq8 | 0.98 | 139.0 | 10 | 0.9884 | yes / yes | 0.56 [0.54, 0.58] | 575 | 2522 |
| faiss_hnsw_sq8 | 0.99 | 175.2 | 10 | 0.9872 | no / no | 0.71 [0.69, 0.73] | 610 | 2578 |
| faiss_hnsw_sq8 | 0.995 | 314.6 | 10 | 0.9975 | yes / no | 1.17 [1.14, 1.19] | 610 | 2578 |
| faiss_ivfpq_fs | 0.98 | 227.0 | 10 | 0.9907 | yes / yes | 0.91 [0.89, 0.95] | 473 | 2209 |
| faiss_ivfpq_fs | 0.99 | 227.0 | 10 | 0.9907 | yes / no | 0.91 [0.89, 0.95] | 473 | 2209 |
| faiss_ivfpq_fs | 0.995 | 395.2 | 10 | 1.0000 | yes / yes | 1.48 [1.45, 1.49] | 472 | 2203 |
| faiss_rabitq_flat | 0.98 | 1530.7 | 10 | 0.9997 | yes / yes | 6.16 [6.08, 6.28] | 471 | 2180 |
| faiss_rabitq_flat | 0.99 | 1530.7 | 10 | 0.9997 | yes / yes | 6.16 [6.08, 6.28] | 471 | 2180 |
| faiss_rabitq_flat | 0.995 | 1530.7 | 10 | 0.9997 | yes / yes | 5.71 [5.62, 5.79] | 471 | 2180 |
| faiss_rabitq_hnsw | 0.98 | 95.1 | 10 | 0.9922 | yes / yes | 0.38 [0.37, 0.40] | 541 | 2410 |
| faiss_rabitq_hnsw | 0.99 | 154.8 | 10 | 0.9968 | yes / yes | 0.62 [0.61, 0.64] | 541 | 2408 |
| faiss_rabitq_hnsw | 0.995 | 275.2 | 10 | 0.9985 | yes / yes | 1.03 [1.00, 1.05] | 541 | 2410 |
| faiss_rabitq_ivf | 0.98 | 901.7 | 10 | 0.9905 | yes / yes | 3.63 [3.60, 3.70] | 472 | 2198 |
| faiss_rabitq_ivf | 0.99 | 901.7 | 10 | 0.9905 | yes / no | 3.63 [3.60, 3.70] | 472 | 2198 |
| faiss_rabitq_ivf | 0.995 | 1186.8 | 10 | 0.9957 | yes / no | 4.43 [4.36, 4.50] | 472 | 2203 |
| hnswlib_f32 | 0.98 | 244.8 | 10 | 0.9909 | yes / yes | 0.99 [0.96, 1.02] | 491 | 1334 |
| hnswlib_f32 | 0.99 | 315.8 | 10 | 0.9950 | yes / yes | 1.27 [1.23, 1.31] | 474 | 1287 |
| hnswlib_f32 | 0.995 | 428.5 | 10 | 0.9964 | yes / no | 1.60 [1.55, 1.62] | 491 | 1335 |
| ours_cascade | 0.98 | 248.3 | 10 | 0.9979 | yes / yes |  | 551 | 208 |
| ours_cascade | 0.99 | 248.3 | 10 | 0.9979 | yes / yes |  | 551 | 208 |
| ours_cascade | 0.995 | 267.9 | 10 | 0.9975 | yes / no |  | 552 | 252 |
| scann | 0.98 | 950.1 | 10 | 0.9908 | yes / yes | 3.83 [3.78, 3.89] | 526 | 2026 |
| scann | 0.99 | 1014.3 | 10 | 0.9987 | yes / yes | 4.08 [4.03, 4.16] | 534 | 2045 |
| scann | 0.995 | 1534.4 | 10 | 0.9997 | yes / yes | 5.73 [5.65, 5.84] | 526 | 2032 |
| usearch_b1_rescore | 0.98 | 118.9 | 10 | 0.9885 | yes / yes | 0.48 [0.47, 0.50] | 523 | 2324 |
| usearch_b1_rescore | 0.99 | 141.3 | 10 | 0.9890 | no / no | 0.57 [0.56, 0.58] | 557 | 2466 |
| usearch_b1_rescore | 0.995 | 234.9 | 10 | 0.9949 | no / no | 0.88 [0.86, 0.89] | 557 | 2465 |
| usearch_f16 | 0.98 | 413.5 | 10 | 0.9894 | yes / yes | 1.66 [1.63, 1.73] | 284 | 1026 |
| usearch_f16 | 0.99 | 825.8 | 10 | 0.9967 | yes / yes | 3.33 [3.19, 3.43] | 319 | 1171 |
| usearch_f16 | 0.995 | 1560.6 | 10 | 0.9949 | no / no | 5.83 [5.55, 5.94] | 267 | 954 |
| usearch_i8 | 0.98 | 289.7 | 10 | 0.9878 | yes / yes | 1.17 [1.15, 1.19] | 181 | 554 |
| usearch_i8 | 0.99 | 526.0 | 10 | 0.9947 | yes / yes | 2.12 [2.08, 2.16] | 181 | 555 |
| usearch_i8 | 0.995 | 959.3 | 10 | 0.9970 | yes / no | 3.58 [3.52, 3.63] | 181 | 554 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 734.1 / 0.9919 | 781.4 / 0.9919 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 4253.0 / 0.9999 | 4277.5 / 1.0000 | 5345.2 / 1.0000 |
| diskann_vamana | L 200 | 1192.3 / 0.9978 | 1249.3 / 0.9978 | 1206.3 / 0.9978 | 1276.9 / 0.9978 | 1379.6 / 0.9978 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 7112.8 / 0.9999 | 7128.9 / 1.0000 | 8154.5 / 1.0000 |
| diskann_vamana | L 400 |  |  | 2042.3 / 0.9996 | 2094.1 / 0.9997 | 2208.4 / 0.9997 | 2071.7 / 0.9996 | 2141.2 / 0.9997 | 2482.2 / 0.9997 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 3481.1 / 0.9999 | 3535.0 / 1.0000 | 3867.4 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 334.1 / 0.9979 | 390.6 / 0.9979 | 386.0 / 0.9982 | 444.1 / 0.9982 | 558.7 / 0.9982 | 491.4 / 1.0001 | 548.1 / 1.0001 | 894.9 / 1.0001 | 794.3 / 1.0000 | 853.7 / 1.0000 | 1898.9 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 175.7 / 0.9850 | 237.6 / 0.9850 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1244.9 / 1.0000 | 1306.2 / 1.0000 | 2425.4 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 241.2 / 0.9946 | 310.9 / 0.9946 | 281.5 / 0.9949 | 344.1 / 0.9949 | 476.8 / 0.9949 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2297.0 / 1.0000 | 2357.1 / 1.0000 | 3566.0 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 422.7 / 0.9971 | 485.4 / 0.9971 | 616.5 / 0.9971 | 498.9 / 0.9990 | 559.4 / 0.9990 | 921.7 / 0.9990 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 815.1 / 1.0001 | 881.3 / 1.0001 | 1274.7 / 1.0001 |  |  |  |
| faiss_hnsw_flat | ef 100 | 399.8 / 0.9943 | 461.5 / 0.9943 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2810.9 / 0.9999 | 2862.6 / 1.0000 | 3898.0 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 654.2 / 0.9996 | 714.5 / 0.9996 | 685.0 / 0.9995 | 748.1 / 0.9996 | 859.7 / 0.9996 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 5078.0 / 0.9999 | 5113.1 / 1.0000 | 6118.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1168.3 / 0.9999 | 1237.5 / 1.0000 | 1344.2 / 1.0000 | 1233.0 / 0.9999 | 1289.2 / 1.0000 | 1643.4 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2128.6 / 0.9999 | 2194.7 / 1.0000 | 2540.6 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1625.9 / 1.0000 | 1692.6 / 1.0000 | 1679.9 / 1.0000 | 1724.1 / 1.0000 | 1837.3 / 1.0000 | 1762.7 / 0.9999 | 1804.0 / 1.0000 | 2149.3 / 1.0000 | 1994.6 / 0.9999 | 2032.9 / 1.0000 | 3079.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 91.7 / 0.4295 | 145.2 / 0.4295 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 445.1 / 0.8460 | 504.8 / 0.8460 | 1531.4 / 0.8460 |
| faiss_rabitq_ivf | nprobe 2 | 103.4 / 0.5657 | 158.0 / 0.5657 | 122.1 / 0.5657 | 179.2 / 0.5657 | 281.9 / 0.5657 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 140.1 / 0.6840 | 195.8 / 0.6840 | 304.0 / 0.6840 | 180.0 / 0.6840 | 237.0 / 0.6840 | 571.8 / 0.6840 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 214.5 / 0.7644 | 271.5 / 0.7644 | 605.2 / 0.7644 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 362.6 / 0.7785 | 420.5 / 0.7785 | 1424.7 / 0.7785 |
| hnswlib_f32 | ef 100 | 433.6 / 0.9948 | 488.5 / 0.9948 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2766.9 / 0.9999 | 2858.9 / 1.0000 | 3915.5 / 1.0000 |
| hnswlib_f32 | ef 200 | 716.6 / 0.9987 | 767.2 / 0.9987 | 724.1 / 0.9987 | 790.1 / 0.9987 | 882.6 / 0.9987 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 4708.1 / 0.9999 | 4788.0 / 1.0000 | 5859.3 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1253.4 / 1.0000 | 1309.1 / 1.0000 | 1404.9 / 1.0000 | 1293.7 / 1.0000 | 1339.8 / 1.0000 | 1703.5 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2217.0 / 0.9999 | 2224.3 / 1.0000 | 2643.8 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 232.1 / 0.9975 | 247.4 / 0.9975 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 323.4 / 1.0000 | 338.4 / 1.0000 | 608.0 / 1.0000 |
| ours_scan | ef 200 |  |  | 242.1 / 0.9982 | 259.2 / 0.9982 | 290.7 / 0.9982 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 265.0 / 1.0001 | 279.4 / 1.0001 | 368.0 / 1.0001 |  |  |  |
| ours_walk | ef 100 | 67.4 / 0.9949 | 85.2 / 0.9949 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 240.1 / 1.0000 | 254.8 / 1.0000 | 565.4 / 1.0000 |
| ours_walk | ef 200 | 78.7 / 0.9962 | 95.3 / 0.9962 | 89.1 / 0.9969 | 105.3 / 0.9969 | 140.9 / 0.9969 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 284.5 / 1.0000 | 301.6 / 1.0000 | 650.0 / 1.0000 |
| ours_walk | ef 400 |  |  | 106.6 / 0.9971 | 122.6 / 0.9971 | 157.9 / 0.9971 | 126.6 / 0.9990 | 142.8 / 0.9990 | 253.9 / 0.9990 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 152.2 / 1.0001 | 168.4 / 1.0001 | 288.0 / 1.0001 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 145.8 / 0.2233 | 191.9 / 0.2233 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 757.4 / 0.6013 | 810.2 / 0.6013 | 1665.2 / 0.6013 |
| scann | leaves_to_search 2, reorder 100 | 155.5 / 0.3165 | 203.1 / 0.3165 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 210.4 / 0.3165 | 257.4 / 0.3165 | 348.7 / 0.3165 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 227.8 / 0.3992 | 276.8 / 0.3992 | 370.2 / 0.3992 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 334.5 / 0.3992 | 385.5 / 0.3992 | 673.8 / 0.3992 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 697.5 / 0.4833 | 742.9 / 0.4833 | 1604.1 / 0.4833 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 368.4 / 0.4833 | 414.2 / 0.4833 | 701.1 / 0.4833 |  |  |  |
| usearch_b1_rescore | ef 100 | 164.2 / 0.9884 | 231.2 / 0.9884 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1003.0 / 0.9995 | 1082.1 / 0.9995 | 2165.2 / 0.9995 |
| usearch_b1_rescore | ef 200 | 231.8 / 0.9930 | 294.5 / 0.9930 | 254.4 / 0.9929 | 321.9 / 0.9929 | 433.1 / 0.9929 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1734.2 / 0.9995 | 1810.1 / 0.9995 | 2900.5 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 388.5 / 0.9972 | 466.7 / 0.9972 | 571.1 / 0.9972 | 435.3 / 0.9991 | 498.9 / 0.9991 | 847.2 / 0.9991 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 730.0 / 0.9990 | 787.2 / 0.9990 | 1163.0 / 0.9990 |  |  |  |

### fiqa / CodeRankEmbed (n_ho = 259, exact quality 0.2924)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 823.6 | 10 | 0.9657 | no / no | 3.75 [3.62, 4.08] | 214 | 820 |
| diskann_vamana | 0.99 | 823.6 | 10 | 0.9657 | no / no |  | 214 | 820 |
| diskann_vamana | 0.995 | 1666.7 | 10 | 0.9951 | yes / no |  | 208 | 788 |
| faiss_exact | 0.98 | 4434.6 | 10 | 1.0000 | yes / yes | 20.18 [19.09, 21.81] | 181 | 478 |
| faiss_exact | 0.99 | 4434.6 | 10 | 1.0000 | yes / yes |  | 181 | 478 |
| faiss_exact | 0.995 | 4434.6 | 10 | 1.0000 | yes / yes |  | 181 | 478 |
| faiss_hnsw_flat | 0.98 | 427.0 | 10 | 0.9507 | no / no | 1.94 [1.85, 2.03] | 196 | 537 |
| faiss_hnsw_flat | 0.99 | 427.0 | 10 | 0.9507 | no / no |  | 196 | 537 |
| faiss_hnsw_flat | 0.995 | 486.7 | 10 | 0.9552 | no / no |  | 210 | 577 |
| faiss_hnsw_sq8 | 0.98 | 357.8 | 10 | 0.9552 | no / no | 1.63 [1.56, 1.71] | 253 | 1178 |
| faiss_hnsw_sq8 | 0.99 | 357.8 | 10 | 0.9552 | no / no |  | 253 | 1178 |
| faiss_hnsw_sq8 | 0.995 | 357.8 | 10 | 0.9552 | no / no |  | 253 | 1178 |
| faiss_ivfpq_fs | 0.98 | 70.5 | 10 | 0.9440 | no / no | 0.32 [0.31, 0.34] | 190 | 989 |
| faiss_ivfpq_fs | 0.99 | 70.5 | 10 | 0.9440 | no / no |  | 190 | 989 |
| faiss_ivfpq_fs | 0.995 | 113.1 | 10 | 0.9775 | no / no |  | 190 | 985 |
| faiss_rabitq_flat | 0.98 | 646.2 | 10 | 0.9984 | yes / yes | 2.94 [2.85, 3.07] | 187 | 973 |
| faiss_rabitq_flat | 0.99 | 646.2 | 10 | 0.9984 | yes / yes |  | 187 | 973 |
| faiss_rabitq_flat | 0.995 | 646.2 | 10 | 0.9984 | yes / no |  | 187 | 973 |
| faiss_rabitq_hnsw | 0.98 | 133.6 | 10 | 0.9741 | no / no | 0.61 [0.59, 0.64] | 216 | 1039 |
| faiss_rabitq_hnsw | 0.99 | 231.5 | 10 | 0.9676 | no / no |  | 202 | 1012 |
| faiss_rabitq_hnsw | 0.995 | 231.5 | 10 | 0.9676 | no / no |  | 202 | 1012 |
| faiss_rabitq_ivf | 0.98 | 238.4 | 10 | 0.9401 | no / no | 1.08 [1.05, 1.15] | 188 | 974 |
| faiss_rabitq_ivf | 0.99 | 416.3 | 10 | 0.9737 | no / no |  | 188 | 970 |
| faiss_rabitq_ivf | 0.995 | 796.4 | 10 | 1.0000 | yes / yes |  | 188 | 973 |
| hnswlib_f32 | 0.98 | 1989.1 | 10 | 0.9988 | yes / yes | 9.05 [8.66, 9.97] | 196 | 458 |
| hnswlib_f32 | 0.99 | 1989.1 | 10 | 0.9988 | yes / yes |  | 196 | 458 |
| hnswlib_f32 | 0.995 | 1989.1 | 10 | 0.9988 | yes / yes |  | 196 | 458 |
| ours_cascade | 0.98 | 219.8 | 10 | 0.9888 | yes / no |  | 226 | 967 |
| scann | 0.98 | 666.3 | 10 | 1.0000 | yes / yes | 3.03 [2.94, 3.17] | 245 | 688 |
| scann | 0.99 | 666.3 | 10 | 1.0000 | yes / yes |  | 245 | 688 |
| scann | 0.995 | 666.3 | 10 | 1.0000 | yes / yes |  | 245 | 688 |
| usearch_f16 | 0.98 | 1377.4 | 10 | 0.9848 | yes / no | 6.27 [6.05, 6.95] | 117 | 429 |
| usearch_f16 | 0.99 | 1377.4 | 10 | 0.9848 | no / no |  | 117 | 429 |
| usearch_f16 | 0.995 | 1377.4 | 10 | 0.9848 | no / no |  | 117 | 429 |
| usearch_i8 | 0.98 | 854.3 | 10 | 1.0021 | yes / yes | 3.89 [3.73, 4.12] | 90 | 307 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 786.5 / 0.9621 | 838.4 / 0.9658 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 4260.6 / 0.9963 | 4365.6 / 0.9962 | 5454.1 / 1.0000 |
| diskann_vamana | L 200 | 1263.5 / 0.9741 | 1321.0 / 0.9778 | 1281.1 / 0.9741 | 1314.0 / 0.9778 | 1456.6 / 0.9778 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 6857.4 / 0.9963 | 6900.2 / 0.9962 | 7815.4 / 1.0000 |
| diskann_vamana | L 400 |  |  | 2114.1 / 0.9968 | 2159.5 / 1.0006 | 2311.1 / 1.0006 | 2168.6 / 0.9968 | 2185.5 / 0.9968 | 2562.8 / 1.0006 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 3589.4 / 0.9963 | 3644.6 / 0.9962 | 4016.8 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 194.9 / 0.9321 | 249.1 / 0.9321 | 237.7 / 0.9663 | 295.9 / 0.9701 | 408.9 / 0.9701 | 322.3 / 0.9794 | 385.3 / 0.9819 | 728.6 / 0.9819 | 560.5 / 0.9888 | 631.1 / 0.9878 | 1694.8 / 0.9916 |
| faiss_bin_hnsw | ef 100 | 175.4 / 0.9337 | 234.2 / 0.9337 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1218.1 / 0.9780 | 1289.2 / 0.9769 | 2440.9 / 0.9807 |
| faiss_bin_hnsw | ef 200 | 253.3 / 0.9694 | 314.7 / 0.9694 | 283.8 / 0.9614 | 351.8 / 0.9651 | 467.8 / 0.9651 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 2161.7 / 0.9888 | 2255.7 / 0.9878 | 3438.5 / 0.9916 |
| faiss_bin_hnsw | ef 400 |  |  | 437.7 / 0.9753 | 502.1 / 0.9791 | 627.2 / 0.9791 | 507.5 / 0.9751 | 575.1 / 0.9777 | 948.1 / 0.9777 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 829.5 / 0.9719 | 899.1 / 0.9745 | 1294.0 / 0.9745 |  |  |  |
| faiss_hnsw_flat | ef 100 | 440.7 / 0.9470 | 497.3 / 0.9507 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2926.9 / 0.9963 | 3009.1 / 0.9962 | 4037.3 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 715.5 / 0.9585 | 769.8 / 0.9623 | 730.9 / 0.9585 | 802.2 / 0.9623 | 921.9 / 0.9623 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 5026.1 / 0.9963 | 5093.3 / 0.9962 | 6120.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1257.2 / 0.9907 | 1316.4 / 0.9945 | 1435.6 / 0.9945 | 1344.7 / 0.9907 | 1390.7 / 0.9906 | 1753.8 / 0.9945 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2259.7 / 0.9963 | 2301.3 / 0.9962 | 2656.9 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 723.5 / 0.9962 | 787.4 / 1.0000 | 765.6 / 0.9963 | 824.9 / 1.0000 | 928.2 / 1.0000 | 828.7 / 0.9963 | 909.8 / 1.0000 | 1229.3 / 1.0000 | 1016.1 / 0.9963 | 1081.6 / 0.9962 | 2146.0 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 197.0 / 0.7869 | 260.5 / 0.7869 | 593.8 / 0.7869 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 329.4 / 0.8328 | 397.5 / 0.8368 | 1457.3 / 0.8368 |
| faiss_rabitq_ivf | nprobe 2 | 94.8 / 0.5123 | 152.9 / 0.5099 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 409.0 / 0.8652 | 471.7 / 0.8691 | 1525.1 / 0.8691 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 120.1 / 0.5948 | 175.6 / 0.5940 | 286.2 / 0.5940 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 105.0 / 0.6368 | 159.4 / 0.6368 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 166.1 / 0.6907 | 226.5 / 0.6907 | 568.4 / 0.6907 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 136.2 / 0.7007 | 191.7 / 0.7007 | 302.8 / 0.7007 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 461.5 / 0.9367 | 519.0 / 0.9391 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2906.2 / 0.9963 | 2989.7 / 0.9962 | 4106.0 / 1.0000 |
| hnswlib_f32 | ef 200 | 763.8 / 0.9739 | 824.6 / 0.9776 | 760.5 / 0.9739 | 809.6 / 0.9776 | 942.3 / 0.9776 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 4706.8 / 0.9963 | 4766.0 / 0.9962 | 5901.8 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1282.8 / 0.9964 | 1344.4 / 1.0002 | 1460.8 / 1.0002 | 1312.4 / 0.9964 | 1385.5 / 0.9964 | 1810.6 / 1.0002 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2281.9 / 0.9963 | 2311.0 / 0.9962 | 2747.7 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 121.1 / 0.9500 | 137.0 / 0.9500 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 178.0 / 0.9888 | 199.4 / 0.9878 | 492.9 / 0.9916 |
| ours_scan | ef 200 |  |  | 130.0 / 0.9698 | 145.9 / 0.9736 | 175.5 / 0.9736 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 143.4 / 0.9890 | 162.3 / 0.9915 | 250.6 / 0.9915 |  |  |  |
| ours_walk | ef 100 | 73.0 / 0.9421 | 86.6 / 0.9407 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 204.8 / 0.9890 | 221.3 / 0.9879 | 554.0 / 0.9917 |
| ours_walk | ef 200 | 84.5 / 0.9620 | 101.2 / 0.9606 | 92.7 / 0.9746 | 108.8 / 0.9784 | 139.0 / 0.9784 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 256.6 / 0.9890 | 275.1 / 0.9879 | 581.9 / 0.9917 |
| ours_walk | ef 400 |  |  | 114.6 / 0.9685 | 131.6 / 0.9723 | 158.2 / 0.9723 | 128.6 / 0.9850 | 142.9 / 0.9875 | 236.1 / 0.9875 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 156.0 / 0.9819 | 173.5 / 0.9857 | 268.4 / 0.9857 |  |  |  |
| scann | reorder 100 | 781.7 / 0.9963 | 835.7 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1371.3 / 0.9963 | 1437.9 / 0.9962 | 2384.2 / 1.0000 |
| scann | reorder 200 |  |  | 853.0 / 0.9963 | 911.2 / 1.0000 | 1007.7 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 988.4 / 0.9963 | 1042.4 / 0.9962 | 1356.5 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 152.5 / 0.9259 | 214.7 / 0.9259 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 877.5 / 0.9877 | 945.1 / 0.9875 | 2131.0 / 0.9914 |
| usearch_b1_rescore | ef 200 | 234.3 / 0.9581 | 296.2 / 0.9581 | 250.4 / 0.9541 | 314.0 / 0.9567 | 439.6 / 0.9567 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1482.1 / 0.9890 | 1547.0 / 0.9879 | 2758.4 / 0.9917 |
| usearch_b1_rescore | ef 400 |  |  | 383.9 / 0.9766 | 453.3 / 0.9804 | 585.1 / 0.9804 | 413.9 / 0.9876 | 482.9 / 0.9901 | 860.1 / 0.9901 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 672.1 / 0.9890 | 734.9 / 0.9916 | 1140.9 / 0.9916 |  |  |  |

### fiqa / bge-base-en-v1.5 (n_ho = 259, exact quality 0.4175)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 702.1 | 10 | 0.9912 | yes / no | 4.87 [4.77, 4.97] | 209 | 778 |
| diskann_vamana | 0.99 | 996.8 | 10 | 1.0000 | yes / yes | 6.09 [5.95, 6.24] | 216 | 808 |
| diskann_vamana | 0.995 | 996.8 | 10 | 1.0000 | yes / yes |  | 216 | 808 |
| faiss_exact | 0.98 | 3954.1 | 10 | 1.0000 | yes / yes | 27.42 [26.68, 28.55] | 181 | 551 |
| faiss_exact | 0.99 | 3954.1 | 10 | 1.0000 | yes / yes | 24.17 [23.63, 25.16] | 181 | 551 |
| faiss_exact | 0.995 | 3954.1 | 10 | 1.0000 | yes / yes |  | 181 | 551 |
| faiss_hnsw_flat | 0.98 | 359.6 | 10 | 1.0001 | yes / yes | 2.49 [2.43, 2.56] | 196 | 590 |
| faiss_hnsw_flat | 0.99 | 359.6 | 10 | 1.0001 | yes / yes | 2.20 [2.14, 2.25] | 196 | 590 |
| faiss_hnsw_flat | 0.995 | 359.6 | 10 | 1.0001 | yes / yes |  | 196 | 590 |
| faiss_hnsw_sq8 | 0.98 | 200.5 | 10 | 0.9961 | yes / yes | 1.39 [1.37, 1.42] | 232 | 1060 |
| faiss_hnsw_sq8 | 0.99 | 406.6 | 10 | 0.9726 | no / no | 2.49 [2.45, 2.53] | 253 | 1129 |
| faiss_hnsw_sq8 | 0.995 | 672.2 | 10 | 1.0000 | yes / yes |  | 232 | 1064 |
| faiss_ivfpq_fs | 0.98 | 113.1 | 10 | 0.9991 | yes / yes | 0.78 [0.77, 0.81] | 190 | 936 |
| faiss_ivfpq_fs | 0.99 | 113.1 | 10 | 0.9991 | yes / yes | 0.69 [0.68, 0.71] | 190 | 936 |
| faiss_ivfpq_fs | 0.995 | 151.2 | 10 | 1.0000 | yes / yes |  | 190 | 937 |
| faiss_rabitq_flat | 0.98 | 648.4 | 10 | 0.9974 | yes / yes | 4.50 [4.42, 4.57] | 186 | 918 |
| faiss_rabitq_flat | 0.99 | 648.4 | 10 | 0.9974 | yes / yes | 3.96 [3.92, 4.02] | 186 | 918 |
| faiss_rabitq_flat | 0.995 | 648.4 | 10 | 0.9974 | yes / no |  | 186 | 918 |
| faiss_rabitq_hnsw | 0.98 | 268.5 | 10 | 1.0007 | yes / yes | 1.86 [1.82, 1.90] | 195 | 949 |
| faiss_rabitq_hnsw | 0.99 | 340.4 | 10 | 1.0039 | yes / yes | 2.08 [2.05, 2.12] | 202 | 972 |
| faiss_rabitq_hnsw | 0.995 | 445.0 | 10 | 1.0001 | yes / yes |  | 216 | 1016 |
| faiss_rabitq_ivf | 0.98 | 198.4 | 10 | 0.9946 | yes / yes | 1.38 [1.35, 1.42] | 190 | 936 |
| faiss_rabitq_ivf | 0.99 | 198.4 | 10 | 0.9946 | yes / no | 1.21 [1.20, 1.25] | 190 | 936 |
| faiss_rabitq_ivf | 0.995 | 342.0 | 10 | 1.0003 | yes / yes |  | 191 | 937 |
| hnswlib_f32 | 0.98 | 155.0 | 10 | 0.9879 | yes / no | 1.07 [1.02, 1.11] | 196 | 535 |
| hnswlib_f32 | 0.99 | 279.7 | 10 | 0.9902 | yes / no | 1.71 [1.59, 1.75] | 196 | 532 |
| hnswlib_f32 | 0.995 | 904.5 | 10 | 1.0000 | yes / yes |  | 196 | 531 |
| ours_cascade | 0.98 | 144.2 | 10 | 0.9935 | yes / no |  | 225 | 294 |
| ours_cascade | 0.99 | 163.6 | 10 | 0.9959 | yes / no |  | 226 | 474 |
| scann | 0.98 | 662.8 | 10 | 1.0000 | yes / yes | 4.60 [4.52, 4.66] | 245 | 767 |
| scann | 0.99 | 662.8 | 10 | 1.0000 | yes / yes | 4.05 [4.01, 4.10] | 245 | 767 |
| scann | 0.995 | 662.8 | 10 | 1.0000 | yes / yes |  | 245 | 767 |
| usearch_f16 | 0.98 | 621.6 | 10 | 0.9896 | yes / no | 4.31 [4.14, 4.43] | 117 | 425 |
| usearch_f16 | 0.99 | 621.6 | 10 | 0.9896 | no / no | 3.80 [3.66, 3.90] | 117 | 425 |
| usearch_f16 | 0.995 | 1084.4 | 10 | 0.9895 | no / no |  | 117 | 424 |
| usearch_i8 | 0.98 | 318.3 | 10 | 0.9973 | yes / no | 2.21 [2.14, 2.25] | 75 | 249 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 590.7 / 0.9978 | 660.3 / 0.9978 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 2975.4 / 1.0000 | 3036.6 / 1.0000 | 4103.8 / 1.0000 |
| diskann_vamana | L 200 | 914.3 / 1.0000 | 982.1 / 1.0000 | 939.8 / 1.0000 | 1009.0 / 1.0000 | 1131.5 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 4780.8 / 1.0000 | 4819.0 / 1.0000 | 5922.3 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1481.7 / 1.0000 | 1549.4 / 1.0000 | 1669.2 / 1.0000 | 1529.7 / 1.0000 | 1593.6 / 1.0000 | 1952.9 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2448.7 / 1.0000 | 2504.2 / 1.0000 | 2883.3 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 194.5 / 0.9852 | 247.5 / 0.9852 | 235.1 / 0.9877 | 294.2 / 0.9877 | 404.0 / 0.9877 | 320.1 / 0.9969 | 377.3 / 0.9969 | 719.9 / 0.9969 | 554.1 / 0.9986 | 616.8 / 0.9986 | 1659.2 / 0.9986 |
| faiss_bin_hnsw | ef 100 | 166.7 / 0.9646 | 225.5 / 0.9646 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1058.9 / 0.9986 | 1139.8 / 0.9959 | 2288.3 / 0.9959 |
| faiss_bin_hnsw | ef 200 | 233.8 / 0.9643 | 294.2 / 0.9643 | 265.2 / 0.9719 | 331.0 / 0.9719 | 446.0 / 0.9719 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1924.1 / 0.9986 | 1991.2 / 0.9959 | 3177.4 / 0.9959 |
| faiss_bin_hnsw | ef 400 |  |  | 398.7 / 0.9790 | 463.5 / 0.9790 | 587.9 / 0.9790 | 458.3 / 0.9876 | 528.5 / 0.9876 | 902.8 / 0.9876 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 725.9 / 0.9969 | 797.4 / 0.9969 | 1175.9 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 392.2 / 1.0001 | 448.0 / 1.0001 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2431.4 / 1.0000 | 2494.2 / 1.0000 | 3564.1 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 620.3 / 1.0000 | 678.8 / 1.0000 | 661.5 / 1.0000 | 715.0 / 1.0000 | 826.9 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 4156.9 / 1.0000 | 4230.6 / 1.0000 | 5340.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1062.9 / 1.0000 | 1135.9 / 1.0000 | 1264.2 / 1.0000 | 1123.7 / 1.0000 | 1200.3 / 1.0000 | 1552.1 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1867.7 / 1.0000 | 1922.6 / 1.0000 | 2282.0 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 726.9 / 1.0001 | 778.7 / 1.0001 | 764.3 / 1.0000 | 824.0 / 1.0000 | 936.2 / 1.0000 | 827.0 / 1.0000 | 891.8 / 1.0000 | 1236.5 / 1.0000 | 1003.4 / 1.0000 | 1070.1 / 1.0000 | 2129.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 195.2 / 0.9588 | 260.3 / 0.9588 | 601.2 / 0.9588 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 331.0 / 0.9597 | 396.9 / 0.9597 | 1435.4 / 0.9597 |
| faiss_rabitq_ivf | nprobe 2 | 98.1 / 0.7265 | 152.8 / 0.7265 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 404.1 / 0.9816 | 465.8 / 0.9816 | 1516.2 / 0.9816 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 121.4 / 0.8174 | 178.9 / 0.8174 | 291.7 / 0.8174 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 106.9 / 0.8622 | 161.3 / 0.8622 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 165.5 / 0.8618 | 230.6 / 0.8618 | 570.2 / 0.8618 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 138.4 / 0.8850 | 196.3 / 0.8850 | 308.4 / 0.8850 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 399.5 / 0.9885 | 468.4 / 0.9885 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2269.4 / 1.0000 | 2423.4 / 1.0000 | 3506.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 653.8 / 1.0000 | 699.7 / 1.0000 | 671.9 / 1.0000 | 722.5 / 1.0000 | 848.5 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 3665.1 / 1.0000 | 3820.7 / 1.0000 | 4961.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1099.6 / 1.0000 | 1124.1 / 1.0000 | 1282.2 / 1.0000 | 1122.9 / 1.0000 | 1215.0 / 1.0000 | 1571.4 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1850.5 / 1.0000 | 1933.7 / 1.0000 | 2287.4 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 121.5 / 0.9873 | 137.0 / 0.9873 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 173.1 / 0.9959 | 192.0 / 0.9959 | 473.6 / 0.9959 |
| ours_scan | ef 200 |  |  | 128.9 / 0.9874 | 146.4 / 0.9874 | 172.0 / 0.9874 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 140.8 / 0.9967 | 159.5 / 0.9967 | 249.2 / 0.9967 |  |  |  |
| ours_walk | ef 100 | 64.8 / 0.9774 | 78.6 / 0.9774 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 166.0 / 0.9959 | 188.4 / 0.9959 | 493.6 / 0.9959 |
| ours_walk | ef 200 | 74.6 / 0.9773 | 88.0 / 0.9773 | 81.3 / 0.9814 | 96.1 / 0.9814 | 125.1 / 0.9814 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 209.6 / 0.9986 | 227.9 / 0.9959 | 542.4 / 0.9959 |
| ours_walk | ef 400 |  |  | 94.4 / 0.9913 | 110.0 / 0.9913 | 137.4 / 0.9913 | 105.8 / 0.9994 | 121.9 / 0.9994 | 212.3 / 0.9994 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 127.5 / 0.9995 | 144.7 / 0.9995 | 234.5 / 0.9995 |  |  |  |
| scann | reorder 100 | 781.6 / 1.0000 | 832.8 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1351.1 / 1.0000 | 1408.3 / 1.0000 | 2347.4 / 1.0000 |
| scann | reorder 200 |  |  | 853.1 / 1.0000 | 902.1 / 1.0000 | 1007.9 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 986.5 / 1.0000 | 1036.6 / 1.0000 | 1346.1 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 147.8 / 0.9720 | 208.5 / 0.9720 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 738.4 / 0.9986 | 801.7 / 0.9986 | 1941.0 / 0.9986 |
| usearch_b1_rescore | ef 200 | 209.7 / 0.9782 | 269.0 / 0.9782 | 221.6 / 0.9823 | 285.5 / 0.9823 | 404.0 / 0.9823 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1232.5 / 0.9986 | 1298.9 / 0.9986 | 2445.6 / 0.9986 |
| usearch_b1_rescore | ef 400 |  |  | 332.4 / 0.9890 | 398.9 / 0.9890 | 512.6 / 0.9890 | 354.0 / 0.9967 | 424.3 / 0.9967 | 797.4 / 0.9967 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 564.5 / 0.9950 | 631.1 / 0.9950 | 1017.5 / 0.9950 |  |  |  |

### fiqa / jina-v2-base-code (n_ho = 259, exact quality 0.1254)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 281.6 | 10 | 0.9018 | no / no | 1.55 [1.51, 1.58] | 209 | 916 |
| diskann_vamana | 0.99 | 395.9 | 10 | 0.9390 | no / no | 2.18 [2.13, 2.22] | 215 | 950 |
| diskann_vamana | 0.995 | 395.9 | 10 | 0.9390 | no / no | 2.18 [2.13, 2.22] | 215 | 950 |
| faiss_exact | 0.98 | 3957.6 | 10 | 1.0000 | yes / yes | 21.77 [21.30, 22.49] | 181 | 579 |
| faiss_exact | 0.99 | 3957.6 | 10 | 1.0000 | yes / yes | 21.77 [21.30, 22.49] | 181 | 579 |
| faiss_exact | 0.995 | 3957.6 | 10 | 1.0000 | yes / yes | 21.77 [21.30, 22.49] | 181 | 579 |
| faiss_hnsw_flat | 0.98 | 207.7 | 10 | 0.9553 | no / no | 1.14 [1.10, 1.17] | 196 | 605 |
| faiss_hnsw_flat | 0.99 | 278.7 | 10 | 0.9822 | no / no | 1.53 [1.49, 1.57] | 189 | 590 |
| faiss_hnsw_flat | 0.995 | 278.7 | 10 | 0.9822 | no / no | 1.53 [1.49, 1.57] | 189 | 590 |
| faiss_hnsw_sq8 | 0.98 | 204.0 | 10 | 0.9877 | yes / no | 1.12 [1.09, 1.14] | 232 | 1234 |
| faiss_hnsw_sq8 | 0.99 | 204.0 | 10 | 0.9877 | no / no | 1.12 [1.09, 1.14] | 232 | 1234 |
| faiss_hnsw_sq8 | 0.995 | 204.0 | 10 | 0.9877 | no / no | 1.12 [1.09, 1.14] | 232 | 1234 |
| faiss_rabitq_flat | 0.98 | 644.8 | 10 | 1.0000 | yes / yes | 3.55 [3.47, 3.61] | 186 | 1095 |
| faiss_rabitq_flat | 0.99 | 644.8 | 10 | 1.0000 | yes / yes | 3.55 [3.47, 3.61] | 186 | 1095 |
| faiss_rabitq_flat | 0.995 | 644.8 | 10 | 1.0000 | yes / yes | 3.55 [3.47, 3.61] | 186 | 1095 |
| faiss_rabitq_hnsw | 0.98 | 118.5 | 10 | 0.8741 | no / no | 0.65 [0.64, 0.67] | 216 | 1173 |
| faiss_rabitq_hnsw | 0.99 | 287.6 | 10 | 0.9559 | no / no | 1.58 [1.55, 1.61] | 216 | 1183 |
| faiss_rabitq_hnsw | 0.995 | 287.6 | 10 | 0.9559 | no / no | 1.58 [1.55, 1.61] | 216 | 1183 |
| faiss_rabitq_ivf | 0.98 | 248.6 | 10 | 0.9305 | no / no | 1.37 [1.34, 1.40] | 190 | 1094 |
| faiss_rabitq_ivf | 0.99 | 394.1 | 10 | 0.9692 | no / no | 2.17 [2.12, 2.21] | 190 | 1093 |
| faiss_rabitq_ivf | 0.995 | 394.1 | 10 | 0.9692 | no / no | 2.17 [2.12, 2.21] | 190 | 1093 |
| hnswlib_f32 | 0.98 | 144.2 | 10 | 0.9298 | no / no | 0.79 [0.77, 0.81] | 196 | 542 |
| hnswlib_f32 | 0.99 | 153.2 | 10 | 0.9275 | no / no | 0.84 [0.82, 0.86] | 196 | 536 |
| hnswlib_f32 | 0.995 | 153.2 | 10 | 0.9275 | no / no | 0.84 [0.82, 0.86] | 196 | 536 |
| ours_cascade | 0.98 | 181.8 | 10 | 1.0008 | yes / yes |  | 230 | 825 |
| ours_cascade | 0.99 | 181.8 | 10 | 1.0008 | yes / yes |  | 230 | 825 |
| ours_cascade | 0.995 | 181.8 | 10 | 1.0008 | yes / yes |  | 230 | 825 |
| scann | 0.98 | 660.7 | 10 | 1.0000 | yes / yes | 3.63 [3.55, 3.69] | 245 | 829 |
| scann | 0.99 | 660.7 | 10 | 1.0000 | yes / yes | 3.63 [3.55, 3.69] | 245 | 829 |
| scann | 0.995 | 660.7 | 10 | 1.0000 | yes / yes | 3.63 [3.55, 3.69] | 245 | 829 |
| usearch_f16 | 0.98 | 305.6 | 10 | 0.9021 | no / no | 1.68 [1.64, 1.74] | 132 | 567 |
| usearch_f16 | 0.99 | 305.6 | 10 | 0.9021 | no / no | 1.68 [1.64, 1.74] | 132 | 567 |
| usearch_f16 | 0.995 | 305.6 | 10 | 0.9021 | no / no | 1.68 [1.64, 1.74] | 132 | 567 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 622.5 / 0.9701 | 682.3 / 0.9698 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 3132.5 / 1.0008 | 3197.7 / 1.0000 | 4296.9 / 1.0000 |
| diskann_vamana | L 200 | 987.4 / 1.0004 | 1041.1 / 1.0000 | 1006.7 / 1.0008 | 1065.7 / 1.0000 | 1184.7 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 4852.2 / 1.0008 | 4910.6 / 1.0000 | 5958.5 / 1.0000 |
| diskann_vamana | L 400 |  |  | 1623.3 / 1.0008 | 1680.3 / 1.0000 | 1787.7 / 1.0000 | 1651.3 / 1.0008 | 1709.9 / 1.0000 | 2068.8 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 2612.3 / 1.0008 | 2670.9 / 1.0000 | 3030.9 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 193.5 / 0.9879 | 246.8 / 0.9879 | 236.2 / 1.0013 | 293.8 / 1.0013 | 402.8 / 1.0013 | 319.7 / 1.0008 | 377.6 / 1.0004 | 716.9 / 1.0004 | 550.9 / 1.0008 | 614.3 / 1.0000 | 1654.2 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 158.3 / 0.9181 | 216.7 / 0.9181 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 996.8 / 1.0008 | 1066.3 / 1.0000 | 2212.7 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 221.7 / 0.9800 | 284.9 / 0.9800 | 253.5 / 0.9933 | 316.6 / 0.9933 | 437.3 / 0.9933 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1814.4 / 1.0008 | 1886.4 / 1.0000 | 3046.4 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 378.3 / 1.0073 | 442.9 / 1.0073 | 564.5 / 1.0073 | 437.0 / 1.0008 | 505.3 / 1.0004 | 867.6 / 1.0004 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 685.1 / 1.0008 | 756.7 / 1.0004 | 1130.9 / 1.0004 |  |  |  |
| faiss_hnsw_flat | ef 100 | 389.4 / 0.9592 | 454.6 / 0.9588 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2459.2 / 0.9700 | 2540.4 / 0.9692 | 3611.6 / 0.9692 |
| faiss_hnsw_flat | ef 200 | 641.7 / 0.9592 | 691.6 / 0.9588 | 660.7 / 0.9596 | 726.0 / 0.9588 | 843.8 / 0.9588 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 4201.9 / 1.0008 | 4212.6 / 1.0000 | 5335.3 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1088.4 / 0.9706 | 1160.5 / 0.9698 | 1269.3 / 0.9698 | 1154.6 / 0.9706 | 1210.0 / 0.9698 | 1577.5 / 0.9698 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 1899.0 / 0.9700 | 1953.5 / 0.9692 | 2345.3 / 0.9692 |  |  |  |
| faiss_rabitq_flat | exhaustive | 722.3 / 1.0004 | 772.7 / 1.0000 | 759.8 / 1.0008 | 816.9 / 1.0000 | 926.7 / 1.0000 | 818.0 / 1.0008 | 884.0 / 1.0000 | 1229.0 / 1.0000 | 998.7 / 1.0008 | 1066.8 / 1.0000 | 2091.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 192.5 / 0.7087 | 254.4 / 0.7087 | 595.5 / 0.7087 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 324.4 / 0.7539 | 390.5 / 0.7539 | 1431.6 / 0.7539 |
| faiss_rabitq_ivf | nprobe 2 | 95.8 / 0.4532 | 149.3 / 0.4532 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 392.4 / 0.8462 | 461.5 / 0.8457 | 1493.3 / 0.8457 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 119.6 / 0.5887 | 176.2 / 0.5887 | 287.5 / 0.5887 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 105.5 / 0.6217 | 159.9 / 0.6217 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 165.1 / 0.6363 | 225.9 / 0.6363 | 566.3 / 0.6363 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 134.9 / 0.6668 | 190.8 / 0.6668 | 302.4 / 0.6668 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 402.7 / 0.9557 | 450.1 / 0.9553 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 2383.2 / 1.0008 | 2395.3 / 1.0000 | 3553.1 / 1.0000 |
| hnswlib_f32 | ef 200 | 652.3 / 1.0009 | 697.8 / 1.0005 | 662.3 / 1.0014 | 717.4 / 1.0005 | 861.5 / 1.0005 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 3700.8 / 1.0008 | 3715.6 / 1.0000 | 4903.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1076.3 / 1.0014 | 1149.1 / 1.0005 | 1283.2 / 1.0005 | 1153.0 / 1.0014 | 1215.2 / 1.0005 | 1590.9 / 1.0005 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 1891.0 / 1.0008 | 1952.4 / 1.0000 | 2323.3 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 119.5 / 0.9879 | 132.4 / 0.9879 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 169.7 / 1.0008 | 186.8 / 1.0000 | 465.6 / 1.0000 |
| ours_scan | ef 200 |  |  | 127.1 / 1.0073 | 142.4 / 1.0073 | 170.1 / 1.0073 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 138.7 / 1.0008 | 155.0 / 1.0004 | 239.7 / 1.0004 |  |  |  |
| ours_walk | ef 100 | 61.0 / 0.9631 | 73.9 / 0.9631 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 150.1 / 1.0008 | 169.9 / 1.0000 | 446.5 / 1.0000 |
| ours_walk | ef 200 | 68.3 / 0.9631 | 82.7 / 0.9631 | 74.6 / 0.9765 | 90.1 / 0.9765 | 118.5 / 0.9765 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 194.4 / 1.0008 | 213.0 / 1.0000 | 519.6 / 1.0000 |
| ours_walk | ef 400 |  |  | 85.6 / 0.9765 | 99.9 / 0.9765 | 127.5 / 0.9765 | 95.0 / 0.9700 | 111.9 / 0.9696 | 203.9 / 0.9696 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 113.7 / 1.0008 | 129.6 / 1.0004 | 218.1 / 1.0004 |  |  |  |
| scann | reorder 100 | 777.4 / 1.0004 | 829.2 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1344.7 / 1.0008 | 1397.9 / 1.0000 | 2315.9 / 1.0000 |
| scann | reorder 200 |  |  | 843.9 / 1.0004 | 898.4 / 1.0000 | 1001.4 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 976.3 / 1.0008 | 1030.9 / 1.0000 | 1329.1 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 140.3 / 0.9250 | 198.9 / 0.9250 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 688.3 / 1.0008 | 765.3 / 1.0000 | 1878.7 / 1.0000 |
| usearch_b1_rescore | ef 200 | 198.4 / 0.9579 | 258.7 / 0.9579 | 208.9 / 0.9765 | 272.7 / 0.9765 | 389.4 / 0.9765 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1123.9 / 1.0008 | 1189.2 / 1.0000 | 2318.9 / 1.0000 |
| usearch_b1_rescore | ef 400 |  |  | 316.0 / 1.0127 | 377.9 / 1.0127 | 496.8 / 1.0127 | 336.8 / 1.0008 | 401.9 / 1.0004 | 758.3 / 1.0004 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 549.6 / 1.0008 | 619.7 / 1.0004 | 982.9 / 1.0004 |  |  |  |

### gcsn / CodeRankEmbed (n_ho = 2400, exact quality 0.8412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 138.5 | 10 | 0.9990 | yes / yes | 2.79 [2.70, 2.93] | 67 | 131 |
| diskann_vamana | 0.99 | 138.5 | 10 | 0.9990 | yes / yes | 2.79 [2.70, 2.93] | 67 | 131 |
| diskann_vamana | 0.995 | 140.7 | 10 | 0.9994 | yes / yes | 2.30 [2.24, 2.44] | 67 | 131 |
| faiss_bin_flat | 0.98 | 27.5 | 10 | 0.9897 | yes / yes | 0.55 [0.54, 0.58] | 80 | 117 |
| faiss_bin_flat | 0.99 | 27.5 | 10 | 0.9897 | no / no | 0.55 [0.54, 0.58] | 80 | 117 |
| faiss_bin_flat | 0.995 | 40.9 | 10 | 0.9959 | yes / no | 0.67 [0.65, 0.71] | 80 | 117 |
| faiss_bin_hnsw | 0.98 | 101.2 | 10 | 0.9889 | yes / yes | 2.04 [1.99, 2.13] | 80 | 124 |
| faiss_bin_hnsw | 0.99 | 117.0 | 10 | 0.9923 | yes / no | 2.36 [2.30, 2.47] | 80 | 127 |
| faiss_bin_hnsw | 0.995 | 135.4 | 10 | 0.9956 | yes / no | 2.21 [2.16, 2.35] | 80 | 131 |
| faiss_exact | 0.98 | 320.1 | 10 | 1.0000 | yes / yes | 6.45 [6.22, 6.79] | 49 | 79 |
| faiss_exact | 0.99 | 320.1 | 10 | 1.0000 | yes / yes | 6.45 [6.22, 6.79] | 49 | 79 |
| faiss_exact | 0.995 | 320.1 | 10 | 1.0000 | yes / yes | 5.22 [5.04, 5.58] | 49 | 79 |
| faiss_hnsw_flat | 0.98 | 85.5 | 10 | 0.9976 | yes / yes | 1.72 [1.68, 1.81] | 50 | 83 |
| faiss_hnsw_flat | 0.99 | 85.5 | 10 | 0.9976 | yes / yes | 1.72 [1.68, 1.81] | 50 | 83 |
| faiss_hnsw_flat | 0.995 | 115.4 | 10 | 0.9969 | yes / no | 1.88 [1.83, 2.00] | 53 | 92 |
| faiss_hnsw_sq8 | 0.98 | 55.6 | 10 | 0.9914 | yes / yes | 1.12 [1.09, 1.17] | 81 | 141 |
| faiss_hnsw_sq8 | 0.99 | 67.3 | 10 | 0.9956 | yes / yes | 1.36 [1.32, 1.42] | 81 | 143 |
| faiss_hnsw_sq8 | 0.995 | 94.4 | 10 | 0.9963 | yes / no | 1.54 [1.50, 1.64] | 81 | 149 |
| faiss_ivfpq_fs | 0.98 | 69.0 | 10 | 1.0000 | yes / yes | 1.39 [1.35, 1.46] | 82 | 136 |
| faiss_ivfpq_fs | 0.99 | 69.0 | 10 | 1.0000 | yes / yes | 1.39 [1.35, 1.46] | 82 | 136 |
| faiss_ivfpq_fs | 0.995 | 69.0 | 10 | 1.0000 | yes / yes | 1.13 [1.10, 1.20] | 82 | 136 |
| faiss_rabitq_flat | 0.98 | 92.8 | 10 | 0.9999 | yes / yes | 1.87 [1.82, 1.96] | 80 | 121 |
| faiss_rabitq_flat | 0.99 | 92.8 | 10 | 0.9999 | yes / yes | 1.87 [1.82, 1.96] | 80 | 121 |
| faiss_rabitq_flat | 0.995 | 92.8 | 10 | 0.9999 | yes / yes | 1.51 [1.48, 1.61] | 80 | 121 |
| faiss_rabitq_hnsw | 0.98 | 65.7 | 10 | 0.9912 | yes / yes | 1.32 [1.29, 1.39] | 81 | 137 |
| faiss_rabitq_hnsw | 0.99 | 67.2 | 10 | 0.9964 | yes / yes | 1.36 [1.32, 1.42] | 81 | 131 |
| faiss_rabitq_hnsw | 0.995 | 91.3 | 10 | 0.9986 | yes / yes | 1.49 [1.46, 1.59] | 81 | 136 |
| faiss_rabitq_ivf | 0.98 | 135.8 | 10 | 0.9961 | yes / yes | 2.74 [2.67, 2.87] | 81 | 132 |
| faiss_rabitq_ivf | 0.99 | 160.1 | 10 | 1.0000 | yes / yes | 3.23 [3.14, 3.38] | 81 | 128 |
| faiss_rabitq_ivf | 0.995 | 160.1 | 10 | 1.0000 | yes / yes | 2.61 [2.55, 2.78] | 81 | 128 |
| hnswlib_f32 | 0.98 | 90.2 | 10 | 0.9976 | yes / yes | 1.82 [1.77, 1.90] | 52 | 68 |
| hnswlib_f32 | 0.99 | 90.2 | 10 | 0.9976 | yes / yes | 1.82 [1.77, 1.90] | 52 | 68 |
| hnswlib_f32 | 0.995 | 151.0 | 10 | 1.0001 | yes / yes | 2.46 [2.40, 2.62] | 55 | 74 |
| ours_cascade | 0.98 | 49.6 | 10 | 0.9908 | yes / yes |  | 137 | 122 |
| ours_cascade | 0.99 | 49.6 | 10 | 0.9908 | yes / no |  | 137 | 122 |
| ours_cascade | 0.995 | 61.3 | 10 | 0.9959 | yes / no |  | 137 | 183 |
| scann | 0.98 | 217.5 | 10 | 1.0000 | yes / yes | 4.38 [4.19, 4.79] | 79 | 204 |
| scann | 0.99 | 217.5 | 10 | 1.0000 | yes / yes | 4.38 [4.19, 4.79] | 79 | 204 |
| scann | 0.995 | 217.5 | 10 | 1.0000 | yes / yes | 3.55 [3.39, 3.92] | 79 | 204 |
| usearch_b1_rescore | 0.98 | 104.4 | 10 | 0.9876 | yes / no | 2.10 [2.05, 2.21] | 81 | 117 |
| usearch_b1_rescore | 0.99 | 124.3 | 10 | 0.9943 | yes / no | 2.51 [2.44, 2.62] | 82 | 119 |
| usearch_f16 | 0.98 | 90.2 | 10 | 0.9916 | yes / yes | 1.82 [1.77, 1.91] | 40 | 52 |
| usearch_f16 | 0.99 | 115.4 | 10 | 0.9951 | yes / yes | 2.33 [2.27, 2.43] | 41 | 55 |
| usearch_i8 | 0.98 | 59.2 | 10 | 0.9869 | yes / yes | 1.19 [1.16, 1.25] | 35 | 31 |
| usearch_i8 | 0.99 | 77.4 | 10 | 0.9918 | yes / no | 1.56 [1.52, 1.63] | 38 | 42 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 326.2 / 1.0000 | 386.4 / 1.0000 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 996.5 / 1.0001 | 1064.4 / 1.0000 | 2158.3 / 1.0000 |
| diskann_vamana | L 200 | 452.8 / 1.0000 | 509.5 / 1.0000 | 458.3 / 1.0000 | 525.6 / 1.0000 | 639.6 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 1288.4 / 1.0001 | 1360.8 / 1.0000 | 2453.9 / 1.0000 |
| diskann_vamana | L 400 |  |  | 630.1 / 1.0000 | 691.0 / 1.0000 | 814.8 / 1.0000 | 649.8 / 1.0000 | 722.7 / 1.0000 | 1084.3 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 848.9 / 1.0000 | 918.9 / 1.0000 | 1295.9 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 88.1 / 0.9959 | 133.9 / 0.9959 | 115.2 / 0.9981 | 161.8 / 0.9982 | 254.6 / 0.9982 | 167.9 / 0.9996 | 214.5 / 0.9996 | 495.1 / 0.9996 | 307.2 / 1.0001 | 354.4 / 1.0001 | 1191.0 / 1.0001 |
| faiss_bin_hnsw | ef 100 | 131.0 / 0.9952 | 177.9 / 0.9952 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 737.6 / 1.0001 | 784.5 / 1.0001 | 1628.3 / 1.0001 |
| faiss_bin_hnsw | ef 200 | 185.1 / 0.9959 | 230.9 / 0.9959 | 208.2 / 0.9981 | 255.6 / 0.9982 | 349.1 / 0.9982 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1375.1 / 1.0001 | 1417.0 / 1.0001 | 2268.6 / 1.0001 |
| faiss_bin_hnsw | ef 400 |  |  | 292.9 / 0.9981 | 339.8 / 0.9982 | 433.8 / 0.9982 | 339.6 / 0.9996 | 386.5 / 0.9996 | 671.6 / 0.9996 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 506.0 / 0.9996 | 553.1 / 0.9996 | 841.1 / 0.9996 |  |  |  |
| faiss_hnsw_flat | ef 100 | 250.4 / 0.9994 | 303.3 / 0.9993 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1096.2 / 1.0001 | 1175.0 / 1.0000 | 2179.0 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 366.7 / 0.9999 | 425.6 / 0.9999 | 390.9 / 0.9999 | 449.3 / 0.9999 | 551.1 / 0.9999 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 1765.1 / 1.0001 | 1841.3 / 1.0000 | 2849.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 558.5 / 1.0000 | 618.9 / 1.0000 | 716.6 / 1.0000 | 594.8 / 1.0000 | 656.5 / 1.0000 | 1001.9 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 841.8 / 1.0000 | 892.3 / 1.0000 | 1248.4 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 150.4 / 1.0001 | 196.8 / 1.0000 | 172.6 / 1.0000 | 217.9 / 1.0000 | 310.0 / 1.0000 | 211.3 / 1.0000 | 257.4 / 1.0000 | 536.9 / 1.0000 | 309.3 / 1.0000 | 355.8 / 1.0000 | 1194.5 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 137.7 / 0.9175 | 184.6 / 0.9175 | 464.6 / 0.9175 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 108.5 / 0.9224 | 154.6 / 0.9224 | 247.0 / 0.9224 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 167.8 / 0.9669 | 214.7 / 0.9669 | 495.2 / 0.9669 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 284.2 / 0.9750 | 331.5 / 0.9749 | 1170.3 / 0.9749 |
| faiss_rabitq_ivf | nprobe 4 | 71.0 / 0.7555 | 116.4 / 0.7555 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 355.5 / 0.9989 | 404.2 / 0.9989 | 1242.3 / 0.9989 |
| faiss_rabitq_ivf | nprobe 8 | 78.6 / 0.8545 | 124.1 / 0.8545 | 93.0 / 0.8545 | 139.2 / 0.8545 | 231.2 / 0.8545 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 262.5 / 0.9998 | 318.0 / 0.9998 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 901.0 / 1.0001 | 1000.0 / 1.0000 | 2055.0 / 1.0000 |
| hnswlib_f32 | ef 200 | 389.0 / 1.0000 | 444.6 / 1.0000 | 372.1 / 1.0000 | 458.2 / 1.0000 | 567.4 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 1171.9 / 1.0001 | 1276.7 / 1.0000 | 2331.9 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 532.2 / 1.0000 | 628.0 / 1.0000 | 737.8 / 1.0000 | 594.5 / 1.0000 | 644.9 / 1.0000 | 999.4 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 797.1 / 1.0000 | 851.4 / 1.0000 | 1209.9 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 39.5 / 0.9959 | 43.2 / 0.9959 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 72.8 / 1.0001 | 80.2 / 1.0001 | 249.4 / 1.0001 |
| ours_scan | ef 200 |  |  | 43.9 / 0.9982 | 49.7 / 0.9982 | 67.3 / 0.9982 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 50.7 / 0.9997 | 58.9 / 0.9996 | 112.4 / 0.9996 |  |  |  |
| ours_walk | ef 100 | 46.2 / 0.9959 | 54.0 / 0.9959 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 102.5 / 1.0001 | 111.5 / 1.0001 | 262.6 / 1.0001 |
| ours_walk | ef 200 | 52.3 / 0.9959 | 60.1 / 0.9959 | 56.0 / 0.9982 | 64.0 / 0.9982 | 79.5 / 0.9982 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 131.8 / 1.0001 | 139.4 / 1.0001 | 302.8 / 1.0001 |
| ours_walk | ef 400 |  |  | 63.0 / 0.9982 | 71.1 / 0.9982 | 85.7 / 0.9982 | 68.7 / 0.9997 | 77.1 / 0.9997 | 129.8 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 78.2 / 0.9997 | 86.5 / 0.9997 | 137.9 / 0.9997 |  |  |  |
| scann | reorder 100 | 299.6 / 1.0000 | 342.8 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 588.6 / 1.0001 | 633.1 / 1.0000 | 1408.7 / 1.0000 |
| scann | reorder 200 |  |  | 335.4 / 1.0000 | 378.6 / 1.0000 | 468.5 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 400.1 / 1.0000 | 441.4 / 1.0000 | 705.4 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 105.6 / 0.9911 | 152.0 / 0.9911 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 467.8 / 0.9967 | 520.2 / 0.9967 | 1361.5 / 0.9967 |
| usearch_b1_rescore | ef 200 | 152.4 / 0.9922 | 199.1 / 0.9922 | 158.2 / 0.9943 | 204.7 / 0.9944 | 297.8 / 0.9944 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 735.1 / 0.9967 | 785.5 / 0.9967 | 1628.8 / 0.9967 |
| usearch_b1_rescore | ef 400 |  |  | 233.5 / 0.9948 | 279.8 / 0.9949 | 374.1 / 0.9949 | 244.5 / 0.9963 | 291.2 / 0.9963 | 578.8 / 0.9963 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 373.5 / 0.9963 | 421.2 / 0.9963 | 708.2 / 0.9963 |  |  |  |

### gcsn / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.7359)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 259.8 | 10 | 0.9964 | yes / yes | 3.94 [3.79, 4.07] | 69 | 132 |
| diskann_vamana | 0.99 | 259.8 | 10 | 0.9964 | yes / yes | 3.12 [3.03, 3.22] | 69 | 132 |
| diskann_vamana | 0.995 | 323.3 | 10 | 0.9980 | yes / no | 3.25 [3.16, 3.41] | 69 | 134 |
| faiss_bin_flat | 0.98 | 56.6 | 10 | 0.9929 | yes / yes | 0.86 [0.83, 0.89] | 80 | 116 |
| faiss_bin_flat | 0.99 | 56.6 | 10 | 0.9929 | yes / no | 0.68 [0.66, 0.70] | 80 | 116 |
| faiss_bin_flat | 0.995 | 197.7 | 10 | 1.0001 | yes / yes | 1.99 [1.94, 2.08] | 80 | 116 |
| faiss_bin_hnsw | 0.98 | 273.6 | 10 | 0.9861 | yes / no | 4.15 [4.00, 4.28] | 80 | 123 |
| faiss_bin_hnsw | 0.99 | 305.3 | 10 | 0.9933 | yes / no | 3.67 [3.58, 3.77] | 80 | 126 |
| faiss_bin_hnsw | 0.995 | 368.3 | 10 | 0.9982 | yes / yes | 3.71 [3.61, 3.88] | 80 | 126 |
| faiss_exact | 0.98 | 346.2 | 10 | 1.0000 | yes / yes | 5.25 [5.02, 5.42] | 51 | 78 |
| faiss_exact | 0.99 | 346.2 | 10 | 1.0000 | yes / yes | 4.16 [4.02, 4.29] | 51 | 78 |
| faiss_exact | 0.995 | 346.2 | 10 | 1.0000 | yes / yes | 3.48 [3.38, 3.65] | 51 | 78 |
| faiss_hnsw_flat | 0.98 | 206.3 | 10 | 0.9963 | yes / yes | 3.13 [3.02, 3.25] | 52 | 83 |
| faiss_hnsw_flat | 0.99 | 206.3 | 10 | 0.9963 | yes / yes | 2.48 [2.42, 2.57] | 52 | 83 |
| faiss_hnsw_flat | 0.995 | 228.0 | 10 | 0.9981 | yes / yes | 2.29 [2.24, 2.41] | 53 | 86 |
| faiss_hnsw_sq8 | 0.98 | 124.9 | 10 | 0.9900 | yes / yes | 1.90 [1.83, 1.96] | 81 | 141 |
| faiss_hnsw_sq8 | 0.99 | 136.6 | 10 | 0.9944 | yes / yes | 1.64 [1.60, 1.69] | 81 | 144 |
| faiss_hnsw_sq8 | 0.995 | 182.6 | 10 | 0.9979 | yes / yes | 1.84 [1.79, 1.93] | 81 | 143 |
| faiss_ivfpq_fs | 0.98 | 125.4 | 10 | 1.0000 | yes / yes | 1.90 [1.83, 1.96] | 82 | 135 |
| faiss_ivfpq_fs | 0.99 | 125.4 | 10 | 1.0000 | yes / yes | 1.51 [1.47, 1.55] | 82 | 135 |
| faiss_ivfpq_fs | 0.995 | 125.4 | 10 | 1.0000 | yes / yes | 1.26 [1.23, 1.32] | 82 | 135 |
| faiss_rabitq_flat | 0.98 | 116.2 | 10 | 1.0000 | yes / yes | 1.76 [1.70, 1.82] | 80 | 119 |
| faiss_rabitq_flat | 0.99 | 116.2 | 10 | 1.0000 | yes / yes | 1.40 [1.36, 1.44] | 80 | 119 |
| faiss_rabitq_flat | 0.995 | 116.2 | 10 | 1.0000 | yes / yes | 1.17 [1.14, 1.23] | 80 | 119 |
| faiss_rabitq_hnsw | 0.98 | 181.4 | 10 | 0.9954 | yes / yes | 2.75 [2.65, 2.84] | 81 | 136 |
| faiss_rabitq_hnsw | 0.99 | 181.4 | 10 | 0.9954 | yes / no | 2.18 [2.12, 2.24] | 81 | 136 |
| faiss_rabitq_hnsw | 0.995 | 233.8 | 10 | 0.9977 | yes / no | 2.35 [2.29, 2.47] | 81 | 136 |
| faiss_rabitq_ivf | 0.98 | 226.4 | 10 | 0.9893 | yes / yes | 3.44 [3.30, 3.54] | 81 | 130 |
| faiss_rabitq_ivf | 0.99 | 252.7 | 10 | 0.9950 | yes / yes | 3.04 [2.96, 3.13] | 81 | 130 |
| faiss_rabitq_ivf | 0.995 | 252.7 | 10 | 0.9950 | yes / no | 2.54 [2.48, 2.66] | 81 | 130 |
| hnswlib_f32 | 0.98 | 206.2 | 10 | 0.9982 | yes / yes | 3.13 [3.01, 3.23] | 54 | 67 |
| hnswlib_f32 | 0.99 | 206.2 | 10 | 0.9982 | yes / yes | 2.48 [2.41, 2.55] | 54 | 67 |
| hnswlib_f32 | 0.995 | 230.0 | 10 | 0.9994 | yes / yes | 2.31 [2.26, 2.43] | 54 | 66 |
| ours_cascade | 0.98 | 65.9 | 10 | 0.9895 | yes / yes |  | 140 | 180 |
| ours_cascade | 0.99 | 83.2 | 10 | 0.9930 | yes / no |  | 155 | 240 |
| ours_cascade | 0.995 | 99.4 | 10 | 0.9989 | yes / yes |  | 148 | 362 |
| scann | 0.98 | 229.1 | 10 | 1.0000 | yes / yes | 3.48 [3.31, 3.89] | 81 | 204 |
| scann | 0.99 | 229.1 | 10 | 1.0000 | yes / yes | 2.75 [2.65, 3.11] | 81 | 204 |
| scann | 0.995 | 229.1 | 10 | 1.0000 | yes / yes | 2.30 [2.23, 2.59] | 81 | 204 |
| usearch_b1_rescore | 0.98 | 295.3 | 10 | 0.9950 | yes / yes | 4.48 [4.32, 4.62] | 81 | 116 |
| usearch_b1_rescore | 0.99 | 301.8 | 10 | 0.9956 | yes / yes | 3.63 [3.54, 3.72] | 81 | 115 |
| usearch_b1_rescore | 0.995 | 315.8 | 10 | 1.0004 | yes / yes | 3.18 [3.10, 3.33] | 84 | 126 |
| usearch_f16 | 0.98 | 211.9 | 10 | 0.9913 | yes / yes | 3.22 [3.10, 3.32] | 42 | 53 |
| usearch_f16 | 0.99 | 230.5 | 10 | 0.9931 | yes / no | 2.77 [2.70, 2.85] | 45 | 63 |
| usearch_f16 | 0.995 | 266.7 | 10 | 0.9964 | yes / no | 2.68 [2.62, 2.81] | 43 | 56 |
| usearch_i8 | 0.98 | 155.2 | 10 | 0.9897 | yes / yes | 2.36 [2.27, 2.43] | 38 | 35 |
| usearch_i8 | 0.99 | 268.2 | 10 | 0.9943 | yes / no | 3.22 [3.14, 3.31] | 40 | 42 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 269.1 / 0.9845 | 325.6 / 0.9845 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 878.6 / 1.0000 | 948.6 / 1.0000 | 2002.7 / 1.0000 |
| diskann_vamana | L 200 | 363.9 / 0.9954 | 422.7 / 0.9953 | 372.6 / 0.9953 | 432.6 / 0.9953 | 546.2 / 0.9953 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 1193.6 / 1.0000 | 1270.2 / 1.0000 | 2341.0 / 1.0000 |
| diskann_vamana | L 400 |  |  | 512.1 / 0.9989 | 575.8 / 0.9989 | 694.1 / 0.9989 | 532.6 / 0.9989 | 596.0 / 0.9989 | 944.6 / 0.9989 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 737.6 / 1.0000 | 797.4 / 1.0000 | 1153.6 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 86.4 / 0.9903 | 132.3 / 0.9903 | 111.7 / 0.9954 | 158.1 / 0.9954 | 250.7 / 0.9954 | 159.9 / 0.9992 | 206.9 / 0.9991 | 487.0 / 0.9991 | 289.3 / 1.0000 | 336.4 / 1.0000 | 1172.1 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 122.5 / 0.9824 | 169.0 / 0.9824 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 700.1 / 1.0000 | 746.5 / 1.0000 | 1588.6 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 168.6 / 0.9865 | 215.2 / 0.9865 | 191.2 / 0.9919 | 238.0 / 0.9919 | 331.4 / 0.9919 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1323.9 / 1.0000 | 1371.3 / 1.0000 | 2212.0 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 269.3 / 0.9955 | 316.8 / 0.9955 | 408.8 / 0.9955 | 313.8 / 0.9993 | 361.1 / 0.9992 | 645.0 / 0.9992 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 475.9 / 0.9992 | 524.1 / 0.9991 | 811.9 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 100 | 195.0 / 0.9978 | 245.5 / 0.9977 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 985.0 / 1.0000 | 1046.0 / 1.0000 | 2011.9 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 283.1 / 0.9997 | 334.4 / 0.9996 | 307.1 / 0.9996 | 361.8 / 0.9996 | 463.7 / 0.9996 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 1682.3 / 1.0000 | 1736.5 / 1.0000 | 2743.1 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 448.0 / 1.0000 | 505.1 / 1.0000 | 612.9 / 1.0000 | 493.3 / 1.0000 | 550.6 / 1.0000 | 870.0 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 734.4 / 1.0000 | 795.4 / 1.0000 | 1119.2 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 148.4 / 1.0000 | 194.8 / 1.0000 | 167.9 / 1.0000 | 213.4 / 1.0000 | 305.4 / 1.0000 | 202.5 / 1.0000 | 247.7 / 1.0000 | 526.0 / 1.0000 | 293.6 / 1.0000 | 340.2 / 1.0000 | 1178.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 136.7 / 0.8273 | 182.8 / 0.8273 | 461.7 / 0.8273 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 108.1 / 0.8360 | 153.9 / 0.8360 | 246.6 / 0.8360 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 165.4 / 0.9344 | 211.6 / 0.9344 | 490.8 / 0.9344 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 276.7 / 0.9516 | 323.4 / 0.9516 | 1161.0 / 0.9516 |
| faiss_rabitq_ivf | nprobe 4 | 71.1 / 0.6079 | 116.8 / 0.6079 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 338.3 / 0.9990 | 385.3 / 0.9990 | 1224.2 / 0.9990 |
| faiss_rabitq_ivf | nprobe 8 | 79.0 / 0.7314 | 124.6 / 0.7314 | 92.7 / 0.7314 | 138.9 / 0.7314 | 230.8 / 0.7314 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 179.7 / 0.9972 | 242.6 / 0.9971 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 741.3 / 1.0000 | 840.8 / 1.0000 | 1849.3 / 1.0000 |
| hnswlib_f32 | ef 200 | 263.3 / 1.0000 | 333.3 / 0.9999 | 291.3 / 0.9999 | 346.4 / 0.9999 | 450.9 / 0.9999 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 1050.2 / 1.0000 | 1135.7 / 1.0000 | 2174.8 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 426.2 / 1.0000 | 480.7 / 1.0000 | 588.5 / 1.0000 | 447.7 / 1.0000 | 501.4 / 1.0000 | 838.1 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 642.3 / 1.0000 | 689.6 / 1.0000 | 1040.1 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 39.0 / 0.9895 | 46.2 / 0.9895 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 72.7 / 1.0001 | 76.9 / 1.0001 | 223.7 / 1.0001 |
| ours_scan | ef 200 |  |  | 43.5 / 0.9962 | 48.9 / 0.9962 | 67.7 / 0.9962 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 49.8 / 0.9990 | 59.2 / 0.9989 | 110.5 / 0.9989 |  |  |  |
| ours_walk | ef 100 | 44.7 / 0.9860 | 52.8 / 0.9860 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 102.2 / 0.9995 | 109.9 / 0.9995 | 266.1 / 0.9995 |
| ours_walk | ef 200 | 51.2 / 0.9889 | 58.9 / 0.9889 | 54.1 / 0.9942 | 62.0 / 0.9942 | 78.0 / 0.9942 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 131.1 / 1.0000 | 138.3 / 1.0000 | 297.7 / 1.0000 |
| ours_walk | ef 400 |  |  | 60.8 / 0.9941 | 69.0 / 0.9941 | 82.9 / 0.9941 | 67.6 / 0.9984 | 75.4 / 0.9983 | 127.5 / 0.9983 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 77.9 / 0.9990 | 85.8 / 0.9990 | 137.9 / 0.9990 |  |  |  |
| scann | reorder 100 | 299.3 / 1.0001 | 342.3 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 575.5 / 1.0000 | 616.6 / 1.0000 | 1377.9 / 1.0000 |
| scann | reorder 200 |  |  | 339.7 / 1.0000 | 374.9 / 1.0000 | 458.3 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 396.0 / 1.0000 | 441.1 / 1.0000 | 690.9 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 99.8 / 0.9773 | 146.1 / 0.9773 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 444.9 / 0.9965 | 493.2 / 0.9964 | 1336.1 / 0.9964 |
| usearch_b1_rescore | ef 200 | 141.2 / 0.9838 | 187.8 / 0.9838 | 146.9 / 0.9895 | 193.4 / 0.9895 | 285.9 / 0.9895 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 702.8 / 0.9965 | 747.5 / 0.9964 | 1589.9 / 0.9964 |
| usearch_b1_rescore | ef 400 |  |  | 217.2 / 0.9922 | 264.4 / 0.9922 | 358.0 / 0.9922 | 228.8 / 0.9943 | 276.1 / 0.9942 | 559.8 / 0.9942 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 351.4 / 0.9947 | 398.4 / 0.9946 | 684.1 / 0.9946 |  |  |  |

### gcsn / jina-v2-base-code (n_ho = 2400, exact quality 0.8177)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 123.9 | 10 | 0.9999 | yes / yes | 2.49 [2.40, 2.54] | 67 | 131 |
| diskann_vamana | 0.99 | 123.9 | 10 | 0.9999 | yes / yes | 2.49 [2.40, 2.54] | 67 | 131 |
| diskann_vamana | 0.995 | 123.9 | 10 | 0.9999 | yes / yes | 2.49 [2.40, 2.54] | 67 | 131 |
| faiss_bin_flat | 0.98 | 26.3 | 10 | 0.9994 | yes / yes | 0.53 [0.52, 0.53] | 80 | 117 |
| faiss_bin_flat | 0.99 | 26.3 | 10 | 0.9994 | yes / yes | 0.53 [0.52, 0.53] | 80 | 117 |
| faiss_bin_flat | 0.995 | 26.3 | 10 | 0.9994 | yes / yes | 0.53 [0.52, 0.53] | 80 | 117 |
| faiss_bin_hnsw | 0.98 | 62.9 | 10 | 0.9854 | yes / no | 1.26 [1.24, 1.27] | 80 | 125 |
| faiss_bin_hnsw | 0.99 | 69.0 | 10 | 0.9916 | yes / no | 1.38 [1.36, 1.39] | 80 | 123 |
| faiss_bin_hnsw | 0.995 | 77.4 | 10 | 0.9962 | yes / no | 1.55 [1.52, 1.57] | 80 | 127 |
| faiss_exact | 0.98 | 314.0 | 10 | 0.9999 | yes / yes | 6.30 [6.12, 6.37] | 49 | 79 |
| faiss_exact | 0.99 | 314.0 | 10 | 0.9999 | yes / yes | 6.30 [6.12, 6.37] | 49 | 79 |
| faiss_exact | 0.995 | 314.0 | 10 | 0.9999 | yes / yes | 6.30 [6.12, 6.37] | 49 | 79 |
| faiss_hnsw_flat | 0.98 | 72.9 | 10 | 0.9997 | yes / yes | 1.46 [1.43, 1.47] | 50 | 83 |
| faiss_hnsw_flat | 0.99 | 72.9 | 10 | 0.9997 | yes / yes | 1.46 [1.43, 1.47] | 50 | 83 |
| faiss_hnsw_flat | 0.995 | 72.9 | 10 | 0.9997 | yes / yes | 1.46 [1.43, 1.47] | 50 | 83 |
| faiss_hnsw_sq8 | 0.98 | 36.8 | 10 | 0.9916 | yes / yes | 0.74 [0.72, 0.74] | 81 | 143 |
| faiss_hnsw_sq8 | 0.99 | 44.6 | 10 | 0.9953 | yes / yes | 0.90 [0.88, 0.91] | 81 | 144 |
| faiss_hnsw_sq8 | 0.995 | 48.3 | 10 | 0.9993 | yes / yes | 0.97 [0.95, 0.98] | 81 | 142 |
| faiss_ivfpq_fs | 0.98 | 45.4 | 10 | 0.9881 | yes / yes | 0.91 [0.90, 0.92] | 82 | 135 |
| faiss_ivfpq_fs | 0.99 | 65.0 | 10 | 0.9999 | yes / yes | 1.31 [1.28, 1.32] | 82 | 136 |
| faiss_ivfpq_fs | 0.995 | 65.0 | 10 | 0.9999 | yes / yes | 1.31 [1.28, 1.32] | 82 | 136 |
| faiss_rabitq_flat | 0.98 | 91.7 | 10 | 0.9999 | yes / yes | 1.84 [1.82, 1.85] | 80 | 120 |
| faiss_rabitq_flat | 0.99 | 91.7 | 10 | 0.9999 | yes / yes | 1.84 [1.82, 1.85] | 80 | 120 |
| faiss_rabitq_flat | 0.995 | 91.7 | 10 | 0.9999 | yes / yes | 1.84 [1.82, 1.85] | 80 | 120 |
| faiss_rabitq_hnsw | 0.98 | 35.0 | 10 | 0.9920 | yes / yes | 0.70 [0.69, 0.71] | 81 | 129 |
| faiss_rabitq_hnsw | 0.99 | 43.5 | 10 | 0.9949 | yes / no | 0.87 [0.86, 0.88] | 81 | 131 |
| faiss_rabitq_hnsw | 0.995 | 57.4 | 10 | 0.9982 | yes / yes | 1.15 [1.14, 1.16] | 81 | 137 |
| faiss_rabitq_ivf | 0.98 | 86.7 | 10 | 0.9881 | yes / yes | 1.74 [1.72, 1.76] | 81 | 127 |
| faiss_rabitq_ivf | 0.99 | 128.3 | 10 | 0.9979 | yes / yes | 2.57 [2.54, 2.60] | 81 | 131 |
| faiss_rabitq_ivf | 0.995 | 151.5 | 10 | 0.9999 | yes / yes | 3.04 [3.00, 3.06] | 81 | 127 |
| hnswlib_f32 | 0.98 | 79.3 | 10 | 0.9986 | yes / yes | 1.59 [1.56, 1.61] | 52 | 67 |
| hnswlib_f32 | 0.99 | 79.3 | 10 | 0.9986 | yes / yes | 1.59 [1.56, 1.61] | 52 | 67 |
| hnswlib_f32 | 0.995 | 79.3 | 10 | 0.9986 | yes / yes | 1.59 [1.56, 1.61] | 52 | 67 |
| ours_cascade | 0.98 | 49.8 | 10 | 0.9995 | yes / yes |  | 137 | 122 |
| ours_cascade | 0.99 | 49.8 | 10 | 0.9995 | yes / yes |  | 137 | 122 |
| ours_cascade | 0.995 | 49.8 | 10 | 0.9995 | yes / yes |  | 137 | 122 |
| scann | 0.98 | 211.7 | 10 | 0.9999 | yes / yes | 4.25 [4.16, 4.37] | 79 | 204 |
| scann | 0.99 | 211.7 | 10 | 0.9999 | yes / yes | 4.25 [4.16, 4.37] | 79 | 204 |
| scann | 0.995 | 211.7 | 10 | 0.9999 | yes / yes | 4.25 [4.16, 4.37] | 79 | 204 |
| usearch_b1_rescore | 0.98 | 84.8 | 10 | 0.9962 | yes / yes | 1.70 [1.67, 1.72] | 81 | 116 |
| usearch_b1_rescore | 0.99 | 84.8 | 10 | 0.9962 | yes / yes | 1.70 [1.67, 1.72] | 81 | 116 |
| usearch_b1_rescore | 0.995 | 98.5 | 10 | 0.9975 | yes / yes | 1.98 [1.95, 1.99] | 82 | 119 |
| usearch_f16 | 0.98 | 82.5 | 10 | 0.9932 | yes / yes | 1.66 [1.64, 1.67] | 40 | 53 |
| usearch_f16 | 0.99 | 85.2 | 10 | 0.9941 | yes / yes | 1.71 [1.69, 1.72] | 40 | 52 |
| usearch_f16 | 0.995 | 103.8 | 10 | 0.9979 | yes / yes | 2.08 [2.06, 2.10] | 43 | 64 |
| usearch_i8 | 0.98 | 53.6 | 10 | 0.9918 | yes / yes | 1.08 [1.06, 1.08] | 35 | 32 |
| usearch_i8 | 0.99 | 75.0 | 10 | 0.9928 | yes / no | 1.50 [1.48, 1.51] | 36 | 35 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 291.2 / 0.9999 | 351.0 / 0.9999 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 941.6 / 0.9999 | 1004.0 / 0.9999 | 2090.3 / 1.0000 |
| diskann_vamana | L 200 | 398.1 / 0.9999 | 455.8 / 0.9999 | 411.6 / 0.9999 | 473.6 / 0.9999 | 588.0 / 1.0000 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 1235.2 / 0.9999 | 1312.2 / 0.9999 | 2405.5 / 1.0000 |
| diskann_vamana | L 400 |  |  | 563.7 / 0.9999 | 628.3 / 0.9999 | 742.0 / 1.0000 | 583.2 / 0.9999 | 649.1 / 0.9999 | 1004.6 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 797.1 / 0.9999 | 848.0 / 0.9999 | 1224.1 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 88.0 / 0.9995 | 134.0 / 0.9996 | 115.5 / 0.9997 | 162.0 / 0.9997 | 254.2 / 0.9998 | 168.2 / 0.9997 | 214.9 / 0.9997 | 494.4 / 0.9997 | 304.9 / 0.9999 | 351.9 / 0.9999 | 1186.3 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 120.8 / 0.9995 | 167.1 / 0.9996 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 697.9 / 0.9999 | 744.2 / 0.9999 | 1584.8 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 166.9 / 0.9995 | 213.3 / 0.9996 | 188.2 / 0.9997 | 235.6 / 0.9997 | 328.4 / 0.9998 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 1328.3 / 0.9999 | 1369.2 / 0.9999 | 2211.1 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 266.9 / 0.9997 | 313.4 / 0.9997 | 407.4 / 0.9998 | 310.4 / 0.9997 | 356.4 / 0.9997 | 641.5 / 0.9997 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 472.1 / 0.9997 | 518.2 / 0.9997 | 808.9 / 0.9997 |  |  |  |
| faiss_hnsw_flat | ef 100 | 223.9 / 0.9999 | 276.0 / 0.9999 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 1056.4 / 0.9999 | 1123.7 / 0.9999 | 2118.0 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 328.0 / 0.9999 | 380.8 / 0.9999 | 351.0 / 0.9999 | 408.9 / 0.9999 | 512.6 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 1740.2 / 0.9999 | 1796.7 / 0.9999 | 2828.4 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 508.4 / 0.9999 | 564.4 / 0.9999 | 676.6 / 1.0000 | 554.4 / 0.9999 | 611.0 / 0.9999 | 941.8 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 802.3 / 0.9999 | 861.4 / 0.9999 | 1194.5 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 150.1 / 0.9999 | 196.2 / 0.9999 | 171.4 / 0.9999 | 216.8 / 0.9999 | 308.6 / 0.9999 | 209.3 / 0.9999 | 254.3 / 0.9999 | 532.2 / 1.0000 | 304.4 / 0.9999 | 349.5 / 0.9999 | 1187.1 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 134.6 / 0.9609 | 180.9 / 0.9609 | 459.5 / 0.9610 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 106.1 / 0.9630 | 151.8 / 0.9630 | 243.9 / 0.9631 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 161.4 / 0.9854 | 207.7 / 0.9854 | 487.4 / 0.9855 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 273.6 / 0.9896 | 320.5 / 0.9896 | 1157.6 / 0.9897 |
| faiss_rabitq_ivf | nprobe 4 | 69.9 / 0.8315 | 115.8 / 0.8315 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 337.4 / 0.9994 | 385.5 / 0.9994 | 1223.2 / 0.9995 |
| faiss_rabitq_ivf | nprobe 8 | 77.2 / 0.9163 | 123.2 / 0.9165 | 91.4 / 0.9163 | 137.6 / 0.9163 | 229.4 / 0.9164 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 236.4 / 0.9999 | 291.6 / 0.9999 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 847.6 / 0.9999 | 949.1 / 0.9999 | 1981.8 / 1.0000 |
| hnswlib_f32 | ef 200 | 347.6 / 0.9999 | 402.6 / 0.9999 | 359.1 / 0.9999 | 415.4 / 0.9999 | 499.9 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 1134.4 / 0.9999 | 1231.2 / 0.9999 | 2292.3 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 515.8 / 0.9999 | 573.9 / 0.9999 | 646.9 / 1.0000 | 532.5 / 0.9999 | 561.5 / 0.9999 | 938.2 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 741.8 / 0.9999 | 767.0 / 0.9999 | 1152.7 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 38.8 / 0.9995 | 45.6 / 0.9996 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 72.3 / 0.9999 | 79.8 / 0.9999 | 229.1 / 1.0000 |
| ours_scan | ef 200 |  |  | 43.4 / 0.9997 | 51.3 / 0.9997 | 67.1 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 51.1 / 0.9997 | 58.7 / 0.9997 | 109.7 / 0.9997 |  |  |  |
| ours_walk | ef 100 | 43.4 / 0.9995 | 51.0 / 0.9996 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 102.1 / 0.9999 | 109.1 / 0.9999 | 258.8 / 1.0000 |
| ours_walk | ef 200 | 48.2 / 0.9995 | 55.7 / 0.9996 | 52.0 / 0.9997 | 59.5 / 0.9997 | 74.6 / 0.9998 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 131.5 / 0.9999 | 139.7 / 0.9999 | 288.7 / 1.0000 |
| ours_walk | ef 400 |  |  | 58.6 / 0.9997 | 66.1 / 0.9997 | 81.8 / 0.9998 | 65.4 / 0.9997 | 72.8 / 0.9997 | 125.0 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 77.5 / 0.9997 | 85.1 / 0.9997 | 137.5 / 0.9997 |  |  |  |
| scann | reorder 100 | 301.2 / 0.9999 | 341.0 / 0.9999 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 583.6 / 0.9999 | 626.5 / 0.9999 | 1399.5 / 1.0000 |
| scann | reorder 200 |  |  | 334.1 / 0.9999 | 378.2 / 0.9999 | 460.3 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 401.4 / 0.9999 | 443.3 / 0.9999 | 699.8 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 100.0 / 0.9960 | 145.7 / 0.9960 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 442.8 / 0.9962 | 489.6 / 0.9962 | 1333.2 / 0.9963 |
| usearch_b1_rescore | ef 200 | 140.7 / 0.9960 | 186.4 / 0.9960 | 145.8 / 0.9962 | 192.3 / 0.9962 | 284.9 / 0.9963 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 704.9 / 0.9962 | 750.0 / 0.9962 | 1591.5 / 0.9963 |
| usearch_b1_rescore | ef 400 |  |  | 215.3 / 0.9962 | 261.9 / 0.9962 | 355.7 / 0.9963 | 226.4 / 0.9962 | 273.6 / 0.9962 | 557.0 / 0.9963 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 347.7 / 0.9962 | 395.9 / 0.9962 | 681.9 / 0.9963 |  |  |  |

### quora / CodeRankEmbed (n_ho = 4000, exact quality 0.8569)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 360.8 | 10 | 0.9840 | yes / no | 4.97 [4.92, 5.06] | 1802 | 7181 |
| diskann_vamana | 0.99 | 564.6 | 10 | 0.9918 | yes / no | 7.78 [7.69, 7.94] | 1802 | 7183 |
| diskann_vamana | 0.995 | 948.4 | 10 | 0.9970 | yes / yes | 9.05 [8.72, 9.18] | 1802 | 7174 |
| faiss_bin_flat | 0.98 | 896.2 | 10 | 0.9881 | yes / yes | 12.34 [12.01, 12.70] | 1604 | 8024 |
| faiss_bin_flat | 0.99 | 924.3 | 10 | 0.9958 | yes / yes | 12.73 [12.57, 12.84] | 1604 | 8028 |
| faiss_bin_flat | 0.995 | 946.7 | 10 | 0.9985 | yes / yes | 9.03 [8.67, 9.18] | 1604 | 8028 |
| faiss_bin_hnsw | 0.98 | 149.3 | 10 | 0.9846 | yes / yes | 2.06 [2.03, 2.11] | 1765 | 8457 |
| faiss_bin_hnsw | 0.99 | 231.7 | 10 | 0.9919 | yes / no | 3.19 [3.14, 3.25] | 1893 | 8868 |
| faiss_bin_hnsw | 0.995 | 382.6 | 10 | 0.9963 | yes / no | 3.65 [3.56, 3.75] | 1893 | 8866 |
| faiss_exact | 0.98 | 38911.3 | 10 | 1.0000 | yes / yes | 535.87 [506.07, 541.58] | 1572 | 4797 |
| faiss_exact | 0.99 | 38911.3 | 10 | 1.0000 | yes / yes | 535.87 [506.07, 541.58] | 1572 | 4797 |
| faiss_exact | 0.995 | 38911.3 | 10 | 1.0000 | yes / yes | 371.19 [349.67, 377.07] | 1572 | 4797 |
| faiss_hnsw_flat | 0.98 | 192.7 | 10 | 0.9883 | yes / yes | 2.65 [2.61, 2.71] | 1708 | 5192 |
| faiss_hnsw_flat | 0.99 | 315.1 | 10 | 0.9922 | yes / no | 4.34 [4.30, 4.42] | 1836 | 5571 |
| faiss_hnsw_flat | 0.995 | 639.1 | 10 | 0.9980 | yes / yes | 6.10 [5.89, 6.25] | 1708 | 5171 |
| faiss_hnsw_sq8 | 0.98 | 165.9 | 10 | 0.9873 | yes / yes | 2.28 [2.27, 2.35] | 2117 | 9553 |
| faiss_hnsw_sq8 | 0.99 | 268.9 | 10 | 0.9922 | yes / no | 3.70 [3.62, 3.78] | 2245 | 9951 |
| faiss_hnsw_sq8 | 0.995 | 481.5 | 10 | 0.9974 | yes / yes | 4.59 [4.45, 4.70] | 2245 | 9946 |
| faiss_ivfpq_fs | 0.98 | 477.1 | 10 | 0.9893 | yes / yes | 6.57 [6.41, 6.64] | 1638 | 8117 |
| faiss_ivfpq_fs | 0.99 | 918.9 | 10 | 0.9948 | yes / yes | 12.66 [12.39, 12.88] | 1651 | 8149 |
| faiss_ivfpq_fs | 0.995 | 1297.0 | 10 | 0.9978 | yes / yes | 12.37 [11.90, 12.62] | 1638 | 8110 |
| faiss_rabitq_flat | 0.98 | 5647.8 | 10 | 1.0000 | yes / yes | 77.78 [77.01, 78.67] | 1655 | 8098 |
| faiss_rabitq_flat | 0.99 | 5647.8 | 10 | 1.0000 | yes / yes | 77.78 [77.01, 78.67] | 1655 | 8098 |
| faiss_rabitq_flat | 0.995 | 5647.8 | 10 | 1.0000 | yes / yes | 53.88 [52.09, 54.75] | 1655 | 8098 |
| faiss_rabitq_hnsw | 0.98 | 155.8 | 10 | 0.9837 | yes / no | 2.15 [2.11, 2.19] | 1913 | 8925 |
| faiss_rabitq_hnsw | 0.99 | 267.1 | 10 | 0.9940 | yes / yes | 3.68 [3.63, 3.77] | 1913 | 8932 |
| faiss_rabitq_hnsw | 0.995 | 475.2 | 10 | 0.9980 | yes / yes | 4.53 [4.40, 4.67] | 1913 | 8924 |
| faiss_rabitq_ivf | 0.98 | 966.4 | 10 | 0.9880 | yes / yes | 13.31 [13.07, 13.49] | 1637 | 8129 |
| faiss_rabitq_ivf | 0.99 | 1766.0 | 10 | 0.9950 | yes / yes | 24.32 [24.02, 24.86] | 1637 | 8135 |
| faiss_rabitq_ivf | 0.995 | 3469.4 | 10 | 0.9985 | yes / yes | 33.10 [32.02, 33.68] | 1637 | 8141 |
| hnswlib_f32 | 0.98 | 183.0 | 10 | 0.9811 | yes / no | 2.52 [2.48, 2.60] | 1885 | 5299 |
| hnswlib_f32 | 0.99 | 337.0 | 10 | 0.9941 | yes / yes | 4.64 [4.58, 4.73] | 1758 | 4939 |
| hnswlib_f32 | 0.995 | 580.2 | 10 | 0.9965 | yes / no | 5.53 [5.35, 5.70] | 1885 | 5321 |
| ours_cascade | 0.98 | 72.6 | 10 | 0.9926 | yes / yes |  | 2009 | 1251 |
| ours_cascade | 0.99 | 72.6 | 10 | 0.9926 | yes / no |  | 2009 | 1251 |
| ours_cascade | 0.995 | 104.8 | 10 | 0.9982 | yes / yes |  | 2005 | 1343 |
| scann | 0.98 | 463.5 | 10 | 0.9872 | yes / yes | 6.38 [6.33, 6.48] | 1826 | 7401 |
| scann | 0.99 | 1262.0 | 10 | 0.9953 | yes / yes | 17.38 [17.25, 17.54] | 1810 | 7389 |
| scann | 0.995 | 1307.0 | 10 | 0.9965 | yes / no | 12.47 [12.05, 12.66] | 1826 | 7409 |
| usearch_b1_rescore | 0.98 | 132.7 | 10 | 0.9821 | yes / no | 1.83 [1.80, 1.87] | 1796 | 8500 |
| usearch_b1_rescore | 0.99 | 210.6 | 10 | 0.9904 | yes / no | 2.90 [2.85, 2.94] | 1924 | 8891 |
| usearch_b1_rescore | 0.995 | 556.7 | 10 | 0.9974 | yes / yes | 5.31 [5.11, 5.40] | 1924 | 8877 |
| usearch_f16 | 0.98 | 441.6 | 10 | 0.9838 | yes / no | 6.08 [6.02, 6.36] | 932 | 3434 |
| usearch_f16 | 0.99 | 787.3 | 10 | 0.9893 | no / no | 10.84 [10.52, 11.11] | 1125 | 4036 |
| usearch_f16 | 0.995 | 1183.0 | 10 | 0.9967 | yes / no | 11.28 [10.93, 11.78] | 1125 | 4042 |
| usearch_i8 | 0.98 | 320.9 | 10 | 0.9820 | yes / no | 4.42 [4.32, 4.52] | 549 | 1860 |
| usearch_i8 | 0.99 | 465.5 | 10 | 0.9908 | yes / no | 6.41 [6.12, 6.59] | 613 | 2053 |
| usearch_i8 | 0.995 | 1049.6 | 10 | 0.9985 | yes / yes | 10.01 [9.46, 10.26] | 613 | 2052 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 1115.5 / 0.9980 | 1169.4 / 0.9980 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 7856.1 / 0.9999 | 7890.0 / 0.9999 | 9044.6 / 0.9999 |
| diskann_vamana | L 200 | 1912.8 / 0.9996 | 1960.7 / 0.9996 | 1938.3 / 0.9996 | 2011.0 / 0.9996 | 2148.1 / 0.9996 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 14014.6 / 1.0000 | 14049.6 / 1.0000 | 15288.1 / 1.0000 |
| diskann_vamana | L 400 |  |  | 3448.9 / 0.9998 | 3519.6 / 0.9998 | 3676.7 / 0.9998 | 3488.4 / 0.9998 | 3613.8 / 0.9998 | 3976.5 / 0.9998 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 6285.3 / 0.9998 | 6358.5 / 0.9998 | 6757.4 / 0.9998 |  |  |  |
| faiss_bin_flat | exhaustive | 1028.7 / 0.9995 | 1097.6 / 0.9995 | 1110.3 / 0.9998 | 1176.5 / 0.9998 | 1306.6 / 0.9998 | 1260.3 / 1.0000 | 1333.8 / 1.0000 | 1735.5 / 1.0000 | 1763.2 / 1.0000 | 1820.2 / 1.0000 | 2973.2 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 324.3 / 0.9944 | 392.7 / 0.9944 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2436.2 / 1.0000 | 2517.0 / 1.0000 | 3831.9 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 503.3 / 0.9978 | 575.2 / 0.9978 | 553.0 / 0.9981 | 619.5 / 0.9981 | 764.7 / 0.9981 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4564.5 / 1.0000 | 4607.8 / 1.0000 | 5976.2 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 915.6 / 0.9997 | 984.3 / 0.9997 | 1137.5 / 0.9997 | 1009.8 / 0.9999 | 1073.7 / 0.9999 | 1522.2 / 0.9999 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1749.8 / 0.9999 | 1825.6 / 0.9999 | 2279.2 / 0.9999 |  |  |  |
| faiss_hnsw_flat | ef 100 | 616.5 / 0.9971 | 682.2 / 0.9971 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4679.9 / 0.9999 | 4696.2 / 0.9999 | 5935.6 / 0.9999 |
| faiss_hnsw_flat | ef 200 | 1062.5 / 0.9989 | 1138.0 / 0.9989 | 1098.6 / 0.9989 | 1166.8 / 0.9989 | 1296.2 / 0.9989 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 8512.0 / 1.0000 | 8543.5 / 1.0000 | 9724.6 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1923.0 / 0.9998 | 1989.1 / 0.9998 | 2121.4 / 0.9998 | 2038.5 / 0.9998 | 2106.3 / 0.9998 | 2489.3 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3629.2 / 0.9999 | 3691.6 / 0.9999 | 4120.2 / 0.9999 |  |  |  |
| faiss_rabitq_flat | exhaustive | 5835.7 / 1.0000 | 5953.1 / 1.0000 | 5907.8 / 1.0000 | 5962.6 / 1.0000 | 6128.0 / 1.0000 | 6092.3 / 1.0000 | 6084.9 / 1.0000 | 6454.3 / 1.0000 | 6444.5 / 1.0000 | 6452.9 / 1.0000 | 7616.4 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 132.4 / 0.6616 | 197.0 / 0.6616 | 165.7 / 0.6616 | 226.8 / 0.6616 | 351.6 / 0.6616 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 563.8 / 0.9236 | 629.1 / 0.9236 | 1784.3 / 0.9236 |
| faiss_rabitq_ivf | nprobe 2 | 150.4 / 0.7934 | 217.0 / 0.7934 | 187.4 / 0.7934 | 249.5 / 0.7934 | 372.1 / 0.7934 | 242.7 / 0.7934 | 305.9 / 0.7934 | 686.4 / 0.7934 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 275.0 / 0.8749 | 341.5 / 0.8749 | 724.1 / 0.8749 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 482.1 / 0.8907 | 548.4 / 0.8907 | 1696.5 / 0.8907 |
| hnswlib_f32 | ef 100 | 596.8 / 0.9977 | 672.1 / 0.9977 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 4744.2 / 0.9999 | 4779.7 / 0.9999 | 5892.7 / 0.9999 |
| hnswlib_f32 | ef 200 | 1053.1 / 0.9991 | 1123.9 / 0.9991 | 1102.9 / 0.9991 | 1175.2 / 0.9991 | 1262.4 / 0.9991 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 8379.6 / 1.0000 | 8309.1 / 1.0000 | 9420.0 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 2014.8 / 0.9995 | 2081.7 / 0.9995 | 2146.7 / 0.9995 | 2038.6 / 0.9995 | 2116.5 / 0.9995 | 2543.5 / 0.9995 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 3665.9 / 0.9998 | 3721.7 / 0.9998 | 4139.7 / 0.9998 |  |  |  |
| ours_scan | ef 100 | 77.0 / 0.9972 | 91.5 / 0.9972 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 347.2 / 0.9998 | 363.1 / 0.9998 | 634.1 / 0.9998 |
| ours_scan | ef 200 |  |  | 111.2 / 0.9988 | 126.7 / 0.9988 | 152.3 / 0.9988 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 175.6 / 0.9996 | 191.0 / 0.9996 | 281.8 / 0.9996 |  |  |  |
| ours_walk | ef 100 | 76.6 / 0.9972 | 92.7 / 0.9972 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 348.7 / 0.9998 | 366.9 / 0.9998 | 627.2 / 0.9998 |
| ours_walk | ef 200 | 100.9 / 0.9983 | 116.2 / 0.9983 | 110.4 / 0.9988 | 124.3 / 0.9988 | 150.8 / 0.9988 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 491.5 / 0.9999 | 508.1 / 0.9999 | 809.9 / 0.9999 |
| ours_walk | ef 400 |  |  | 152.5 / 0.9994 | 170.1 / 0.9994 | 201.8 / 0.9994 | 174.6 / 0.9996 | 190.7 / 0.9996 | 274.9 / 0.9996 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 242.5 / 0.9998 | 260.0 / 0.9998 | 364.9 / 0.9998 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 184.7 / 0.5556 | 238.6 / 0.5556 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 261.4 / 0.5556 | 312.2 / 0.5556 | 422.3 / 0.5556 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 925.2 / 0.8876 | 978.5 / 0.8876 | 1955.3 / 0.8876 |
| scann | leaves_to_search 2, reorder 100 | 198.1 / 0.6947 | 252.2 / 0.6947 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 270.9 / 0.6947 | 326.4 / 0.6947 | 436.1 / 0.6947 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 416.5 / 0.6947 | 469.3 / 0.6947 | 804.6 / 0.6947 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 436.8 / 0.7980 | 492.6 / 0.7980 | 824.7 / 0.7980 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 877.3 / 0.8252 | 921.9 / 0.8252 | 1930.3 / 0.8252 |
| usearch_b1_rescore | ef 100 | 291.2 / 0.9928 | 359.2 / 0.9928 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2254.2 / 0.9995 | 2322.4 / 0.9995 | 3507.7 / 0.9995 |
| usearch_b1_rescore | ef 200 | 473.6 / 0.9974 | 546.0 / 0.9974 | 504.4 / 0.9979 | 568.4 / 0.9979 | 700.3 / 0.9979 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 4201.5 / 0.9995 | 4274.5 / 0.9995 | 5532.3 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 874.5 / 0.9987 | 944.6 / 0.9987 | 1079.1 / 0.9987 | 920.3 / 0.9989 | 990.5 / 0.9989 | 1393.6 / 0.9989 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1720.0 / 0.9994 | 1779.6 / 0.9994 | 2190.8 / 0.9994 |  |  |  |

### quora / bge-base-en-v1.5 (n_ho = 4000, exact quality 0.8914)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 164.9 | 10 | 0.9845 | yes / yes | 2.46 [2.42, 2.54] | 1693 | 7828 |
| diskann_vamana | 0.99 | 234.7 | 10 | 0.9938 | yes / yes | 3.50 [3.43, 3.55] | 1693 | 7809 |
| diskann_vamana | 0.995 | 313.3 | 10 | 0.9965 | yes / no | 4.67 [4.60, 4.76] | 1819 | 8442 |
| faiss_bin_flat | 0.98 | 878.4 | 10 | 0.9976 | yes / yes | 13.10 [12.86, 13.43] | 1604 | 9419 |
| faiss_bin_flat | 0.99 | 878.4 | 10 | 0.9976 | yes / yes | 13.10 [12.86, 13.43] | 1604 | 9419 |
| faiss_bin_flat | 0.995 | 878.4 | 10 | 0.9976 | yes / yes | 13.10 [12.86, 13.43] | 1604 | 9419 |
| faiss_bin_hnsw | 0.98 | 74.4 | 10 | 0.9834 | yes / no | 1.11 [1.07, 1.13] | 1765 | 9601 |
| faiss_bin_hnsw | 0.99 | 98.2 | 10 | 0.9944 | yes / yes | 1.46 [1.43, 1.50] | 1765 | 9607 |
| faiss_bin_hnsw | 0.995 | 135.0 | 10 | 0.9975 | yes / yes | 2.01 [1.96, 2.09] | 1765 | 9742 |
| faiss_exact | 0.98 | 38240.9 | 10 | 1.0000 | yes / yes | 570.46 [543.98, 585.26] | 1572 | 4915 |
| faiss_exact | 0.99 | 38240.9 | 10 | 1.0000 | yes / yes | 570.46 [543.98, 585.26] | 1572 | 4915 |
| faiss_exact | 0.995 | 38240.9 | 10 | 1.0000 | yes / yes | 570.46 [543.98, 585.26] | 1572 | 4915 |
| faiss_hnsw_flat | 0.98 | 67.9 | 10 | 0.9874 | yes / yes | 1.01 [0.99, 1.06] | 1645 | 5143 |
| faiss_hnsw_flat | 0.99 | 95.1 | 10 | 0.9921 | yes / no | 1.42 [1.39, 1.45] | 1709 | 5294 |
| faiss_hnsw_flat | 0.995 | 129.5 | 10 | 0.9968 | yes / no | 1.93 [1.88, 2.01] | 1709 | 5211 |
| faiss_hnsw_sq8 | 0.98 | 59.4 | 10 | 0.9825 | yes / no | 0.89 [0.86, 0.91] | 2053 | 10780 |
| faiss_hnsw_sq8 | 0.99 | 88.3 | 10 | 0.9921 | yes / no | 1.32 [1.27, 1.35] | 2117 | 10962 |
| faiss_hnsw_sq8 | 0.995 | 115.3 | 10 | 0.9967 | yes / no | 1.72 [1.68, 1.76] | 2117 | 11082 |
| faiss_ivfpq_fs | 0.98 | 110.0 | 10 | 0.9938 | yes / yes | 1.64 [1.61, 1.67] | 1638 | 9441 |
| faiss_ivfpq_fs | 0.99 | 162.5 | 10 | 0.9973 | yes / yes | 2.42 [2.36, 2.48] | 1638 | 9513 |
| faiss_ivfpq_fs | 0.995 | 261.7 | 10 | 0.9992 | yes / yes | 3.90 [3.78, 4.00] | 1638 | 9561 |
| faiss_rabitq_flat | 0.98 | 5616.5 | 10 | 1.0000 | yes / yes | 83.78 [82.48, 85.10] | 1655 | 9481 |
| faiss_rabitq_flat | 0.99 | 5616.5 | 10 | 1.0000 | yes / yes | 83.78 [82.48, 85.10] | 1655 | 9481 |
| faiss_rabitq_flat | 0.995 | 5616.5 | 10 | 1.0000 | yes / yes | 83.78 [82.48, 85.10] | 1655 | 9481 |
| faiss_rabitq_hnsw | 0.98 | 83.4 | 10 | 0.9896 | yes / yes | 1.24 [1.21, 1.31] | 1913 | 10337 |
| faiss_rabitq_hnsw | 0.99 | 83.4 | 10 | 0.9896 | no / no | 1.24 [1.21, 1.31] | 1913 | 10337 |
| faiss_rabitq_hnsw | 0.995 | 126.7 | 10 | 0.9959 | yes / no | 1.89 [1.83, 1.93] | 1913 | 10398 |
| faiss_rabitq_ivf | 0.98 | 187.0 | 10 | 0.9884 | yes / yes | 2.79 [2.70, 2.88] | 1637 | 9512 |
| faiss_rabitq_ivf | 0.99 | 333.5 | 10 | 0.9969 | yes / yes | 4.97 [4.86, 5.06] | 1637 | 9409 |
| faiss_rabitq_ivf | 0.995 | 528.5 | 10 | 0.9983 | yes / yes | 7.88 [7.70, 8.02] | 1637 | 9592 |
| hnswlib_f32 | 0.98 | 66.1 | 10 | 0.9852 | yes / yes | 0.99 [0.95, 1.03] | 1694 | 5049 |
| hnswlib_f32 | 0.99 | 103.8 | 10 | 0.9942 | yes / yes | 1.55 [1.52, 1.60] | 1694 | 5022 |
| hnswlib_f32 | 0.995 | 150.9 | 10 | 0.9972 | yes / yes | 2.25 [2.20, 2.32] | 1885 | 5626 |
| ours_cascade | 0.98 | 67.0 | 10 | 0.9983 | yes / yes |  | 2004 | 1286 |
| ours_cascade | 0.99 | 67.0 | 10 | 0.9983 | yes / yes |  | 2004 | 1286 |
| ours_cascade | 0.995 | 67.0 | 10 | 0.9983 | yes / yes |  | 2004 | 1286 |
| scann | 0.98 | 189.5 | 10 | 0.9909 | yes / yes | 2.83 [2.77, 2.87] | 1804 | 7591 |
| scann | 0.99 | 215.3 | 10 | 0.9965 | yes / yes | 3.21 [3.15, 3.27] | 1820 | 7603 |
| scann | 0.995 | 414.2 | 10 | 0.9986 | yes / yes | 6.18 [6.09, 6.28] | 1804 | 7627 |
| usearch_b1_rescore | 0.98 | 86.8 | 10 | 0.9924 | yes / yes | 1.29 [1.26, 1.33] | 1733 | 9716 |
| usearch_b1_rescore | 0.99 | 94.0 | 10 | 0.9929 | yes / yes | 1.40 [1.37, 1.42] | 1733 | 9434 |
| usearch_b1_rescore | 0.995 | 127.0 | 10 | 0.9977 | yes / yes | 1.89 [1.86, 1.93] | 1797 | 9671 |
| usearch_f16 | 0.98 | 142.6 | 10 | 0.9839 | yes / no | 2.13 [2.02, 2.18] | 932 | 3948 |
| usearch_f16 | 0.99 | 219.1 | 10 | 0.9937 | yes / yes | 3.27 [3.19, 3.35] | 1125 | 4535 |
| usearch_f16 | 0.995 | 358.0 | 10 | 0.9965 | yes / no | 5.34 [5.18, 5.45] | 1125 | 4484 |
| usearch_i8 | 0.98 | 99.9 | 10 | 0.9853 | yes / yes | 1.49 [1.45, 1.52] | 549 | 2061 |
| usearch_i8 | 0.99 | 151.5 | 10 | 0.9911 | yes / no | 2.26 [2.22, 2.30] | 742 | 2714 |
| usearch_i8 | 0.995 | 280.9 | 10 | 0.9958 | yes / no | 4.19 [4.09, 4.28] | 613 | 2287 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 894.4 / 0.9998 | 949.8 / 0.9998 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 5759.4 / 1.0000 | 5835.3 / 1.0000 | 7062.0 / 1.0000 |
| diskann_vamana | L 200 | 1464.9 / 0.9998 | 1538.9 / 0.9998 | 1497.4 / 0.9998 | 1567.7 / 0.9998 | 1706.2 / 0.9998 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 10074.1 / 1.0000 | 10234.8 / 1.0000 | 11480.5 / 1.0000 |
| diskann_vamana | L 400 |  |  | 2580.7 / 1.0000 | 2657.5 / 1.0000 | 2806.6 / 1.0000 | 2658.2 / 1.0000 | 2709.5 / 1.0000 | 3114.6 / 1.0000 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 4689.9 / 1.0000 | 4693.8 / 1.0000 | 5115.6 / 1.0000 |  |  |  |
| faiss_bin_flat | exhaustive | 1027.0 / 0.9996 | 1085.9 / 0.9996 | 1101.8 / 0.9998 | 1167.6 / 0.9998 | 1298.2 / 0.9998 | 1256.5 / 0.9999 | 1324.3 / 0.9999 | 1717.0 / 0.9999 | 1745.1 / 0.9999 | 1805.6 / 0.9999 | 2960.0 / 0.9999 |
| faiss_bin_hnsw | ef 100 | 301.3 / 0.9991 | 374.2 / 0.9991 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2225.5 / 0.9999 | 2296.8 / 0.9999 | 3579.3 / 0.9999 |
| faiss_bin_hnsw | ef 200 | 465.6 / 0.9996 | 540.7 / 0.9996 | 514.3 / 0.9998 | 580.7 / 0.9998 | 729.1 / 0.9998 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4099.0 / 0.9999 | 4158.0 / 0.9999 | 5484.2 / 0.9999 |
| faiss_bin_hnsw | ef 400 |  |  | 835.1 / 0.9998 | 908.1 / 0.9998 | 1052.0 / 0.9998 | 930.8 / 0.9999 | 1009.7 / 0.9999 | 1431.6 / 0.9999 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1592.3 / 0.9999 | 1642.3 / 0.9999 | 2099.7 / 0.9999 |  |  |  |
| faiss_hnsw_flat | ef 100 | 523.9 / 1.0001 | 579.9 / 1.0001 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3728.6 / 1.0000 | 3839.7 / 1.0000 | 5015.8 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 877.6 / 1.0000 | 932.2 / 1.0000 | 911.3 / 1.0000 | 972.2 / 1.0000 | 1104.5 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 6695.9 / 1.0000 | 6796.1 / 1.0000 | 7983.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1562.0 / 1.0000 | 1619.4 / 1.0000 | 1763.5 / 1.0000 | 1675.7 / 1.0000 | 1711.7 / 1.0000 | 2089.0 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2886.2 / 1.0000 | 2926.8 / 1.0000 | 3309.0 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 5794.3 / 1.0000 | 5892.1 / 1.0000 | 5926.8 / 1.0000 | 5923.6 / 1.0000 | 6044.6 / 1.0000 | 6042.4 / 1.0000 | 6047.8 / 1.0000 | 6484.9 / 1.0000 | 6374.6 / 1.0000 | 6418.9 / 1.0000 | 7597.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 128.4 / 0.7587 | 190.4 / 0.7587 | 157.7 / 0.7587 | 219.5 / 0.7587 | 344.2 / 0.7587 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 529.6 / 0.9873 | 597.5 / 0.9873 | 1737.8 / 0.9873 |
| faiss_rabitq_ivf | nprobe 2 | 143.8 / 0.9018 | 207.0 / 0.9018 | 176.0 / 0.9018 | 238.6 / 0.9018 | 362.1 / 0.9018 | 232.3 / 0.9018 | 295.1 / 0.9018 | 668.1 / 0.9018 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 263.5 / 0.9616 | 327.0 / 0.9616 | 703.4 / 0.9616 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 456.7 / 0.9709 | 521.7 / 0.9709 | 1658.4 / 0.9709 |
| hnswlib_f32 | ef 100 | 528.6 / 0.9998 | 580.0 / 0.9998 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 3815.3 / 1.0000 | 3856.6 / 1.0000 | 5112.0 / 1.0000 |
| hnswlib_f32 | ef 200 | 933.3 / 0.9997 | 973.0 / 0.9997 | 953.1 / 0.9997 | 1008.0 / 0.9997 | 1137.8 / 0.9997 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 6610.5 / 1.0000 | 6619.8 / 1.0000 | 7873.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 1625.1 / 1.0000 | 1718.7 / 1.0000 | 1873.9 / 1.0000 | 1727.0 / 1.0000 | 1798.1 / 1.0000 | 2200.5 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 3037.3 / 1.0000 | 3075.6 / 1.0000 | 3476.6 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 69.6 / 0.9993 | 84.5 / 0.9993 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 291.7 / 0.9999 | 303.4 / 0.9999 | 547.4 / 0.9999 |
| ours_scan | ef 200 |  |  | 98.7 / 0.9998 | 113.7 / 0.9998 | 139.4 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 150.5 / 0.9999 | 164.4 / 0.9999 | 248.3 / 0.9999 |  |  |  |
| ours_walk | ef 100 | 69.6 / 0.9993 | 84.2 / 0.9993 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 293.4 / 0.9999 | 308.3 / 0.9999 | 552.9 / 0.9999 |
| ours_walk | ef 200 | 89.2 / 0.9996 | 103.8 / 0.9996 | 99.2 / 0.9998 | 114.9 / 0.9998 | 138.7 / 0.9998 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 403.5 / 0.9999 | 415.1 / 0.9999 | 677.3 / 0.9999 |
| ours_walk | ef 400 |  |  | 126.8 / 0.9999 | 143.4 / 0.9999 | 173.4 / 0.9999 | 151.7 / 0.9999 | 164.8 / 0.9999 | 245.5 / 0.9999 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 202.0 / 0.9999 | 215.6 / 0.9999 | 311.0 / 0.9999 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 184.0 / 0.7010 | 237.2 / 0.7010 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 259.1 / 0.7010 | 312.2 / 0.7010 | 425.3 / 0.7010 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 920.0 / 0.9755 | 963.0 / 0.9755 | 1945.9 / 0.9755 |
| scann | leaves_to_search 2, reorder 100 | 195.5 / 0.8422 | 251.3 / 0.8422 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 270.7 / 0.8422 | 325.5 / 0.8422 | 436.6 / 0.8422 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 416.8 / 0.8422 | 466.3 / 0.8422 | 797.0 / 0.8422 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 438.0 / 0.9306 | 490.2 / 0.9306 | 822.1 / 0.9306 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 861.7 / 0.9472 | 932.2 / 0.9472 | 1887.4 / 0.9472 |
| usearch_b1_rescore | ef 100 | 276.8 / 0.9983 | 342.0 / 0.9983 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1979.9 / 0.9991 | 2028.5 / 0.9991 | 3200.4 / 0.9991 |
| usearch_b1_rescore | ef 200 | 427.9 / 0.9986 | 492.9 / 0.9986 | 452.8 / 0.9987 | 520.3 / 0.9987 | 650.3 / 0.9987 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 3565.0 / 0.9991 | 3636.7 / 0.9991 | 4872.0 / 0.9991 |
| usearch_b1_rescore | ef 400 |  |  | 772.1 / 0.9990 | 844.2 / 0.9990 | 978.5 / 0.9990 | 820.3 / 0.9991 | 885.3 / 0.9991 | 1276.1 / 0.9991 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1476.2 / 0.9991 | 1543.4 / 0.9991 | 1950.0 / 0.9991 |  |  |  |

### quora / jina-v2-base-code (n_ho = 4000, exact quality 0.7004)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 346.7 | 10 | 0.9867 | yes / yes | 5.16 [4.96, 5.29] | 1755 | 6995 |
| diskann_vamana | 0.99 | 630.4 | 10 | 0.9944 | yes / yes | 7.95 [1.76, 8.19] | 1693 | 6734 |
| diskann_vamana | 0.995 | 1140.7 | 10 | 0.9986 | yes / yes | 7.49 [2.78, 7.71] | 1812 | 7245 |
| faiss_bin_flat | 0.98 | 878.3 | 10 | 0.9923 | yes / yes | 13.06 [12.55, 13.31] | 1604 | 8052 |
| faiss_bin_flat | 0.99 | 918.8 | 10 | 0.9974 | yes / yes | 11.58 [2.55, 11.82] | 1604 | 8074 |
| faiss_bin_flat | 0.995 | 960.6 | 10 | 0.9985 | yes / yes | 6.31 [2.31, 6.40] | 1604 | 8058 |
| faiss_bin_hnsw | 0.98 | 127.3 | 10 | 0.9827 | yes / no | 1.89 [1.81, 1.95] | 1893 | 8910 |
| faiss_bin_hnsw | 0.99 | 255.8 | 10 | 0.9939 | yes / yes | 3.22 [0.71, 3.29] | 1893 | 8911 |
| faiss_bin_hnsw | 0.995 | 560.9 | 10 | 0.9978 | yes / yes | 3.68 [1.35, 3.78] | 1893 | 8923 |
| faiss_exact | 0.98 | 37756.3 | 10 | 1.0000 | yes / yes | 561.51 [517.97, 588.13] | 1572 | 4819 |
| faiss_exact | 0.99 | 37756.3 | 10 | 1.0000 | yes / yes | 475.92 [107.97, 499.54] | 1572 | 4819 |
| faiss_exact | 0.995 | 37756.3 | 10 | 1.0000 | yes / yes | 247.87 [93.42, 259.15] | 1572 | 4819 |
| faiss_hnsw_flat | 0.98 | 169.2 | 10 | 0.9863 | yes / yes | 2.52 [2.40, 2.60] | 1836 | 5616 |
| faiss_hnsw_flat | 0.99 | 297.3 | 10 | 0.9947 | yes / yes | 3.75 [0.83, 3.87] | 1836 | 5611 |
| faiss_hnsw_flat | 0.995 | 537.3 | 10 | 0.9979 | yes / yes | 3.53 [1.29, 3.60] | 1836 | 5624 |
| faiss_hnsw_sq8 | 0.98 | 146.8 | 10 | 0.9865 | yes / yes | 2.18 [2.07, 2.26] | 2245 | 10003 |
| faiss_hnsw_sq8 | 0.99 | 251.1 | 10 | 0.9948 | yes / yes | 3.17 [0.71, 3.28] | 2245 | 9988 |
| faiss_hnsw_sq8 | 0.995 | 450.0 | 10 | 0.9979 | yes / yes | 2.95 [1.09, 3.03] | 2245 | 10003 |
| faiss_ivfpq_fs | 0.98 | 320.4 | 10 | 0.9890 | yes / yes | 4.76 [4.52, 4.91] | 1638 | 8148 |
| faiss_ivfpq_fs | 0.99 | 535.6 | 10 | 0.9935 | yes / yes | 6.75 [1.49, 6.94] | 1638 | 8155 |
| faiss_rabitq_flat | 0.98 | 5631.6 | 10 | 1.0000 | yes / yes | 83.75 [80.55, 85.41] | 1655 | 8146 |
| faiss_rabitq_flat | 0.99 | 5631.6 | 10 | 1.0000 | yes / yes | 70.99 [15.68, 72.47] | 1655 | 8146 |
| faiss_rabitq_flat | 0.995 | 5631.6 | 10 | 1.0000 | yes / yes | 36.97 [13.56, 37.60] | 1655 | 8146 |
| faiss_rabitq_hnsw | 0.98 | 197.5 | 10 | 0.9830 | yes / no | 2.94 [2.79, 3.03] | 1913 | 8965 |
| faiss_rabitq_hnsw | 0.99 | 344.6 | 10 | 0.9905 | yes / no | 4.34 [0.96, 4.46] | 1914 | 8985 |
| faiss_rabitq_hnsw | 0.995 | 673.9 | 10 | 0.9947 | no / no | 4.42 [1.62, 4.50] | 1913 | 8977 |
| faiss_rabitq_ivf | 0.98 | 554.9 | 10 | 0.9889 | yes / yes | 8.25 [7.90, 8.40] | 1637 | 8179 |
| faiss_rabitq_ivf | 0.99 | 977.8 | 10 | 0.9948 | yes / yes | 12.33 [2.72, 12.59] | 1637 | 8184 |
| faiss_rabitq_ivf | 0.995 | 1396.3 | 10 | 0.9965 | yes / no | 9.17 [3.36, 9.31] | 1630 | 8162 |
| hnswlib_f32 | 0.98 | 178.0 | 10 | 0.9857 | yes / yes | 2.65 [2.51, 2.71] | 1885 | 5349 |
| hnswlib_f32 | 0.99 | 317.3 | 10 | 0.9926 | yes / no | 4.00 [0.90, 4.17] | 1694 | 4808 |
| hnswlib_f32 | 0.995 | 574.9 | 10 | 0.9981 | yes / yes | 3.77 [1.39, 3.90] | 1885 | 5362 |
| ours_cascade | 0.98 | 67.2 | 10 | 0.9897 | yes / yes |  | 2002 | 1288 |
| ours_cascade | 0.99 | 79.3 | 10 | 0.9951 | yes / yes |  | 2004 | 1282 |
| ours_cascade | 0.995 | 152.3 | 10 | 0.9987 | yes / yes |  | 2003 | 1439 |
| scann | 0.98 | 874.8 | 10 | 0.9816 | yes / no | 13.01 [12.46, 13.26] | 1735 | 6277 |
| scann | 0.99 | 1430.2 | 10 | 0.9959 | yes / yes | 18.03 [3.99, 18.43] | 1805 | 7411 |
| scann | 0.995 | 1437.4 | 10 | 0.9964 | yes / no | 9.44 [3.47, 9.62] | 1821 | 7441 |
| usearch_b1_rescore | 0.98 | 116.7 | 10 | 0.9823 | yes / no | 1.74 [1.66, 1.79] | 1797 | 8579 |
| usearch_b1_rescore | 0.99 | 325.5 | 10 | 0.9929 | yes / no | 4.10 [0.91, 4.20] | 1733 | 8362 |
| usearch_b1_rescore | 0.995 | 476.4 | 10 | 0.9971 | yes / yes | 3.13 [1.15, 3.19] | 1924 | 8933 |
| usearch_f16 | 0.98 | 394.2 | 10 | 0.9864 | yes / yes | 5.86 [5.55, 6.03] | 932 | 3471 |
| usearch_f16 | 0.99 | 699.6 | 10 | 0.9936 | yes / yes | 8.82 [1.97, 9.19] | 932 | 3473 |
| usearch_f16 | 0.995 | 1300.2 | 10 | 0.9961 | yes / no | 8.54 [3.15, 8.76] | 1125 | 4057 |
| usearch_i8 | 0.98 | 250.6 | 10 | 0.9823 | yes / no | 3.73 [3.57, 3.80] | 613 | 2066 |
| usearch_i8 | 0.99 | 427.5 | 10 | 0.9905 | yes / no | 5.39 [1.20, 5.56] | 613 | 2058 |
| usearch_i8 | 0.995 | 759.3 | 10 | 0.9943 | no / no | 4.98 [1.84, 5.14] | 613 | 2062 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| diskann_vamana | L 100 | 851.1 / 0.9968 | 929.2 / 0.9968 |  |  |  |  |  |  |  |  |  |
| diskann_vamana | L 1000 |  |  |  |  |  |  |  |  | 5458.6 / 1.0001 | 5485.4 / 1.0001 | 6731.4 / 1.0001 |
| diskann_vamana | L 200 | 1413.5 / 0.9987 | 1470.3 / 0.9987 | 1421.1 / 0.9987 | 1496.4 / 0.9987 | 1642.1 / 0.9987 |  |  |  |  |  |  |
| diskann_vamana | L 2000 |  |  |  |  |  |  |  |  | 9304.4 / 1.0001 | 9445.1 / 1.0001 | 10645.5 / 1.0001 |
| diskann_vamana | L 400 |  |  | 2459.7 / 0.9996 | 2547.3 / 0.9996 | 2683.8 / 0.9996 | 2521.0 / 0.9996 | 2618.6 / 0.9996 | 2994.3 / 0.9996 |  |  |  |
| diskann_vamana | L 800 |  |  |  |  |  | 4406.4 / 1.0001 | 4444.8 / 1.0001 | 4886.5 / 1.0001 |  |  |  |
| faiss_bin_flat | exhaustive | 1031.1 / 0.9987 | 1102.4 / 0.9987 | 1101.7 / 0.9988 | 1167.3 / 0.9988 | 1297.1 / 0.9988 | 1264.9 / 0.9997 | 1333.9 / 0.9997 | 1728.4 / 0.9997 | 1766.9 / 1.0000 | 1829.1 / 1.0000 | 2972.5 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 270.0 / 0.9928 | 337.0 / 0.9928 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1902.7 / 0.9995 | 1975.8 / 0.9995 | 3249.0 / 0.9995 |
| faiss_bin_hnsw | ef 200 | 402.8 / 0.9963 | 475.7 / 0.9963 | 442.9 / 0.9965 | 512.8 / 0.9965 | 659.4 / 0.9965 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 3474.7 / 1.0000 | 3560.4 / 1.0000 | 4853.1 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 715.3 / 0.9974 | 794.7 / 0.9974 | 922.3 / 0.9974 | 813.8 / 0.9982 | 880.1 / 0.9982 | 1294.4 / 0.9982 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1357.7 / 0.9992 | 1414.1 / 0.9992 | 1839.5 / 0.9992 |  |  |  |
| faiss_hnsw_flat | ef 100 | 479.0 / 0.9964 | 544.7 / 0.9964 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3416.0 / 1.0001 | 3495.0 / 1.0001 | 4691.3 / 1.0001 |
| faiss_hnsw_flat | ef 200 | 795.9 / 0.9982 | 856.9 / 0.9982 | 829.0 / 0.9982 | 907.4 / 0.9982 | 1034.8 / 0.9982 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 6050.4 / 1.0001 | 6103.9 / 1.0001 | 7291.0 / 1.0001 |
| faiss_hnsw_flat | ef 400 |  |  | 1421.0 / 0.9987 | 1501.4 / 0.9987 | 1621.1 / 0.9987 | 1507.7 / 0.9987 | 1582.4 / 0.9987 | 1963.6 / 0.9987 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2590.8 / 0.9999 | 2689.9 / 0.9999 | 3097.2 / 0.9999 |  |  |  |
| faiss_rabitq_flat | exhaustive | 5800.4 / 1.0001 | 5930.3 / 1.0001 | 5894.1 / 1.0001 | 5932.2 / 1.0001 | 6053.3 / 1.0001 | 6042.6 / 1.0001 | 6060.0 / 1.0001 | 6479.0 / 1.0001 | 6368.5 / 1.0001 | 6411.9 / 1.0001 | 7619.0 / 1.0001 |
| faiss_rabitq_ivf | nprobe 1 | 135.6 / 0.6810 | 197.8 / 0.6810 | 164.3 / 0.6810 | 226.8 / 0.6810 | 353.3 / 0.6810 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 575.2 / 0.9405 | 636.9 / 0.9405 | 1787.2 / 0.9405 |
| faiss_rabitq_ivf | nprobe 2 | 154.2 / 0.8058 | 218.4 / 0.8058 | 186.1 / 0.8058 | 247.0 / 0.8058 | 374.9 / 0.8058 | 246.4 / 0.8058 | 308.8 / 0.8058 | 689.6 / 0.8058 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 282.9 / 0.8847 | 346.2 / 0.8847 | 727.0 / 0.8847 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 488.7 / 0.9003 | 553.5 / 0.9003 | 1703.4 / 0.9003 |
| hnswlib_f32 | ef 100 | 468.8 / 0.9956 | 541.3 / 0.9956 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 3454.7 / 0.9999 | 3526.8 / 0.9999 | 4648.2 / 0.9999 |
| hnswlib_f32 | ef 200 | 803.3 / 0.9981 | 876.6 / 0.9981 | 864.7 / 0.9981 | 919.6 / 0.9981 | 1046.3 / 0.9981 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 5854.2 / 1.0001 | 5904.9 / 1.0001 | 7016.9 / 1.0001 |
| hnswlib_f32 | ef 400 |  |  | 1506.1 / 0.9991 | 1572.5 / 0.9991 | 1702.5 / 0.9991 | 1587.4 / 0.9991 | 1645.5 / 0.9991 | 2053.4 / 0.9991 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 2706.4 / 0.9999 | 2768.4 / 0.9999 | 3195.8 / 0.9999 |  |  |  |
| ours_scan | ef 100 | 67.1 / 0.9951 | 83.0 / 0.9951 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 261.4 / 0.9997 | 276.6 / 0.9997 | 515.6 / 0.9997 |
| ours_scan | ef 200 |  |  | 93.0 / 0.9966 | 109.6 / 0.9966 | 134.6 / 0.9966 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 137.3 / 0.9987 | 154.2 / 0.9987 | 236.2 / 0.9987 |  |  |  |
| ours_walk | ef 100 | 67.6 / 0.9951 | 81.1 / 0.9951 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 261.9 / 0.9997 | 281.5 / 0.9997 | 521.1 / 0.9997 |
| ours_walk | ef 200 | 81.1 / 0.9966 | 97.5 / 0.9966 | 93.8 / 0.9966 | 107.0 / 0.9966 | 134.4 / 0.9966 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 353.0 / 1.0000 | 364.2 / 1.0000 | 612.2 / 1.0000 |
| ours_walk | ef 400 |  |  | 115.9 / 0.9976 | 131.0 / 0.9976 | 163.0 / 0.9976 | 139.0 / 0.9987 | 152.4 / 0.9987 | 234.6 / 0.9987 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 178.8 / 0.9994 | 190.3 / 0.9994 | 281.4 / 0.9994 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 186.3 / 0.5129 | 241.6 / 0.5129 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 258.8 / 0.5129 | 316.1 / 0.5129 | 426.8 / 0.5129 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 950.5 / 0.8596 | 1006.1 / 0.8596 | 1960.6 / 0.8596 |
| scann | leaves_to_search 2, reorder 100 | 201.1 / 0.6487 | 255.9 / 0.6487 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 271.1 / 0.6487 | 334.5 / 0.6487 | 442.3 / 0.6487 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 417.9 / 0.6487 | 476.0 / 0.6487 | 803.4 / 0.6487 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 439.1 / 0.7557 | 499.8 / 0.7557 | 818.3 / 0.7557 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 879.0 / 0.7871 | 929.7 / 0.7871 | 1887.2 / 0.7871 |
| usearch_b1_rescore | ef 100 | 251.2 / 0.9924 | 315.6 / 0.9924 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1754.4 / 0.9995 | 1835.3 / 0.9995 | 3006.7 / 0.9995 |
| usearch_b1_rescore | ef 200 | 390.5 / 0.9951 | 456.3 / 0.9951 | 413.1 / 0.9949 | 480.3 / 0.9949 | 610.2 / 0.9949 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 3119.9 / 0.9995 | 3197.6 / 0.9995 | 4400.6 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 690.2 / 0.9977 | 759.1 / 0.9977 | 891.0 / 0.9977 | 744.7 / 0.9984 | 805.5 / 0.9984 | 1209.8 / 0.9984 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1321.0 / 0.9993 | 1376.0 / 0.9993 | 1786.8 / 0.9993 |  |  |  |

## arm (frozen points from the arm shortlist, R = 6)

### advtest / CodeRankEmbed (n_ho = 1200, exact quality 0.4732)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 94.7 | 6 | 0.9796 | no / no | 0.64 [0.63, 0.65] | 82 | 366 |
| faiss_bin_flat | 0.99 | 225.4 | 6 | 0.9954 | yes / no | 1.38 [1.37, 1.41] | 82 | 368 |
| faiss_bin_flat | 0.995 | 225.4 | 6 | 0.9954 | yes / no | 1.29 [1.27, 1.31] | 82 | 368 |
| faiss_bin_hnsw | 0.98 | 375.6 | 6 | 0.9778 | no / no | 2.54 [2.46, 2.57] | 94 | 403 |
| faiss_bin_hnsw | 0.99 | 587.1 | 6 | 0.9963 | yes / no | 3.60 [3.55, 3.72] | 94 | 402 |
| faiss_bin_hnsw | 0.995 | 847.7 | 6 | 0.9963 | yes / no | 4.85 [4.75, 5.01] | 88 | 384 |
| faiss_exact | 0.98 | 2657.2 | 6 | 1.0000 | yes / yes | 17.98 [17.71, 18.34] | 81 | 215 |
| faiss_exact | 0.99 | 2657.2 | 6 | 1.0000 | yes / yes | 16.30 [16.10, 16.74] | 81 | 215 |
| faiss_exact | 0.995 | 2657.2 | 6 | 1.0000 | yes / yes | 15.21 [14.92, 15.49] | 81 | 215 |
| faiss_hnsw_flat | 0.98 | 607.1 | 6 | 0.9935 | yes / yes | 4.11 [4.06, 4.17] | 85 | 227 |
| faiss_hnsw_flat | 0.99 | 821.2 | 6 | 0.9971 | yes / yes | 5.04 [4.95, 5.19] | 87 | 232 |
| faiss_hnsw_flat | 0.995 | 1488.8 | 6 | 0.9995 | yes / yes | 8.52 [8.36, 8.62] | 87 | 234 |
| faiss_hnsw_sq8 | 0.98 | 802.2 | 6 | 0.9864 | yes / no | 5.43 [5.38, 5.47] | 109 | 455 |
| faiss_hnsw_sq8 | 0.99 | 1206.8 | 6 | 0.9971 | yes / yes | 7.40 [7.38, 7.55] | 104 | 435 |
| faiss_hnsw_sq8 | 0.995 | 2130.3 | 6 | 0.9996 | yes / yes | 12.19 [11.99, 12.26] | 104 | 436 |
| faiss_ivfpq_fs | 0.98 | 302.6 | 6 | 0.9999 | yes / yes | 2.05 [2.03, 2.07] | 86 | 387 |
| faiss_ivfpq_fs | 0.99 | 302.6 | 6 | 0.9999 | yes / yes | 1.86 [1.84, 1.90] | 86 | 387 |
| faiss_ivfpq_fs | 0.995 | 302.6 | 6 | 0.9999 | yes / yes | 1.73 [1.70, 1.74] | 86 | 387 |
| faiss_rabitq_flat | 0.98 | 1051.9 | 6 | 0.9937 | yes / yes | 7.12 [7.05, 7.17] | 83 | 375 |
| faiss_rabitq_flat | 0.99 | 1063.6 | 6 | 0.9986 | yes / yes | 6.53 [6.50, 6.65] | 83 | 371 |
| faiss_rabitq_flat | 0.995 | 1063.6 | 6 | 0.9986 | yes / yes | 6.09 [5.99, 6.11] | 83 | 371 |
| faiss_rabitq_hnsw | 0.98 | 287.4 | 6 | 0.9881 | yes / no | 1.94 [1.87, 2.02] | 95 | 409 |
| faiss_rabitq_hnsw | 0.99 | 469.4 | 6 | 0.9979 | yes / yes | 2.88 [2.85, 2.99] | 95 | 409 |
| faiss_rabitq_hnsw | 0.995 | 616.3 | 6 | 0.9989 | yes / no | 3.53 [3.39, 3.58] | 95 | 406 |
| faiss_rabitq_ivf | 0.98 | 1741.1 | 6 | 1.0000 | yes / yes | 11.78 [11.67, 11.87] | 84 | 385 |
| faiss_rabitq_ivf | 0.99 | 1741.1 | 6 | 1.0000 | yes / yes | 10.68 [10.63, 10.90] | 84 | 385 |
| faiss_rabitq_ivf | 0.995 | 1741.1 | 6 | 1.0000 | yes / yes | 9.96 [9.80, 10.00] | 84 | 385 |
| hnswlib_f32 | 0.98 | 1509.4 | 6 | 0.9854 | yes / no | 10.21 [10.10, 10.29] | 97 | 227 |
| hnswlib_f32 | 0.99 | 2333.6 | 6 | 0.9953 | yes / no | 14.32 [14.23, 14.65] | 91 | 214 |
| hnswlib_f32 | 0.995 | 2657.7 | 6 | 1.0000 | yes / yes | 15.21 [14.95, 15.28] | 97 | 229 |
| ours_cascade | 0.98 | 147.8 | 6 | 0.9832 | yes / no |  | 172 | 163 |
| ours_cascade | 0.99 | 163.0 | 6 | 0.9909 | yes / no |  | 173 | 224 |
| ours_cascade | 0.995 | 174.7 | 6 | 0.9946 | no / no |  | 172 | 280 |
| scann | 0.98 | 334.5 | 6 | 1.0000 | yes / yes | 2.26 [2.24, 2.28] | 125 | 373 |
| scann | 0.99 | 334.5 | 6 | 1.0000 | yes / yes | 2.05 [2.04, 2.09] | 125 | 373 |
| scann | 0.995 | 334.5 | 6 | 1.0000 | yes / yes | 1.91 [1.88, 1.92] | 125 | 373 |
| usearch_b1_rescore | 0.98 | 507.2 | 6 | 0.9914 | yes / yes | 3.43 [3.29, 3.54] | 90 | 396 |
| usearch_b1_rescore | 0.99 | 595.9 | 6 | 0.9902 | yes / no | 3.66 [3.60, 3.75] | 96 | 407 |
| usearch_b1_rescore | 0.995 | 595.9 | 6 | 0.9902 | no / no | 3.41 [3.33, 3.47] | 96 | 407 |
| usearch_f16 | 0.98 | 1259.1 | 6 | 0.9859 | yes / no | 8.52 [8.37, 8.81] | 57 | 167 |
| usearch_f16 | 0.99 | 1442.0 | 6 | 1.0010 | yes / yes | 8.85 [8.72, 9.17] | 63 | 189 |
| usearch_f16 | 0.995 | 2488.8 | 6 | 1.0013 | yes / yes | 14.24 [14.00, 14.54] | 63 | 191 |
| usearch_i8 | 0.98 | 678.8 | 6 | 0.9948 | yes / yes | 4.59 [4.40, 4.75] | 41 | 95 |
| usearch_i8 | 0.99 | 1378.5 | 6 | 0.9973 | yes / no | 8.46 [8.31, 8.76] | 47 | 122 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 139.8 / 0.9818 | 194.3 / 0.9818 | 178.1 / 0.9908 | 232.6 / 0.9906 | 341.0 / 0.9906 | 254.9 / 0.9972 | 307.9 / 0.9972 | 640.5 / 0.9972 | 470.4 / 0.9999 | 526.5 / 0.9999 | 1522.1 / 0.9999 |
| faiss_bin_hnsw | ef 100 | 193.7 / 0.9646 | 251.9 / 0.9646 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1888.3 / 0.9999 | 1944.0 / 0.9999 | 3094.0 / 0.9999 |
| faiss_bin_hnsw | ef 200 | 302.3 / 0.9792 | 359.9 / 0.9792 | 335.5 / 0.9882 | 397.4 / 0.9879 | 517.9 / 0.9879 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4643.2 / 0.9999 | 4720.7 / 0.9999 | 5851.7 / 0.9999 |
| faiss_bin_hnsw | ef 400 |  |  | 585.8 / 0.9923 | 646.7 / 0.9921 | 761.4 / 0.9921 | 653.0 / 0.9958 | 717.3 / 0.9958 | 1085.7 / 0.9958 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1262.6 / 0.9969 | 1332.5 / 0.9969 | 1704.4 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 753.5 / 0.9992 | 830.2 / 0.9991 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4906.3 / 1.0000 | 4961.1 / 1.0000 | 6019.1 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1288.9 / 0.9970 | 1369.3 / 0.9969 | 1327.5 / 0.9970 | 1407.0 / 0.9969 | 1515.3 / 0.9969 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 8871.1 / 1.0000 | 8919.8 / 1.0000 | 9965.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2290.7 / 1.0000 | 2341.7 / 1.0000 | 2454.8 / 1.0000 | 2342.8 / 1.0000 | 2400.3 / 1.0000 | 2763.9 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3984.8 / 1.0000 | 4044.7 / 1.0000 | 4399.2 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1167.8 / 0.9999 | 1223.2 / 0.9999 | 1204.4 / 1.0000 | 1258.2 / 1.0000 | 1366.7 / 1.0000 | 1269.9 / 1.0000 | 1323.9 / 1.0000 | 1651.7 / 1.0000 | 1447.8 / 1.0000 | 1503.2 / 1.0000 | 2493.6 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 232.6 / 0.6766 | 286.8 / 0.6764 | 396.4 / 0.6764 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 377.8 / 0.7543 | 432.7 / 0.7543 | 763.8 / 0.7543 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 562.7 / 0.7675 | 619.7 / 0.7675 | 1622.8 / 0.7675 |
| faiss_rabitq_ivf | nprobe 3 | 129.3 / 0.4830 | 182.1 / 0.4830 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 838.2 / 0.8765 | 895.5 / 0.8769 | 1896.9 / 0.8769 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 172.1 / 0.5606 | 226.5 / 0.5607 | 335.4 / 0.5607 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 162.7 / 0.5815 | 217.2 / 0.5815 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 264.5 / 0.6516 | 319.7 / 0.6515 | 649.3 / 0.6515 |  |  |  |
| hnswlib_f32 | ef 100 | 1991.7 / 0.9938 | 2061.8 / 0.9937 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 10173.9 / 1.0000 | 10239.0 / 1.0000 | 11297.1 / 1.0000 |
| hnswlib_f32 | ef 200 | 3432.6 / 0.9998 | 3497.9 / 0.9996 | 3445.0 / 0.9998 | 3514.5 / 0.9996 | 3633.6 / 0.9996 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 13614.9 / 1.0000 | 13720.0 / 1.0000 | 14724.7 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 5720.2 / 0.9995 | 5783.7 / 0.9995 | 5863.4 / 0.9995 | 5774.0 / 0.9995 | 5816.1 / 0.9995 | 6170.4 / 0.9995 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 8935.7 / 1.0000 | 8962.0 / 1.0000 | 9303.7 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 107.7 / 0.9832 | 128.3 / 0.9832 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 217.1 / 0.9999 | 241.9 / 0.9999 | 688.5 / 0.9999 |
| ours_scan | ef 200 |  |  | 120.1 / 0.9913 | 140.8 / 0.9909 | 181.4 / 0.9909 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 144.9 / 0.9970 | 166.6 / 0.9970 | 310.5 / 0.9970 |  |  |  |
| ours_walk | ef 100 | 140.2 / 0.9821 | 168.5 / 0.9821 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 370.0 / 0.9999 | 393.9 / 0.9999 | 925.4 / 0.9999 |
| ours_walk | ef 200 | 160.8 / 0.9851 | 188.3 / 0.9851 | 176.3 / 0.9936 | 206.0 / 0.9932 | 258.0 / 0.9932 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 426.4 / 0.9999 | 450.2 / 0.9999 | 978.9 / 0.9999 |
| ours_walk | ef 400 |  |  | 206.6 / 0.9917 | 234.9 / 0.9915 | 291.0 / 0.9915 | 243.6 / 0.9968 | 266.0 / 0.9966 | 438.9 / 0.9966 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 281.2 / 0.9969 | 303.7 / 0.9969 | 464.4 / 0.9969 |  |  |  |
| scann | reorder 100 | 437.0 / 1.0000 | 496.5 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 858.7 / 1.0000 | 931.5 / 1.0000 | 1983.0 / 1.0000 |
| scann | reorder 200 |  |  | 490.1 / 1.0000 | 550.0 / 1.0000 | 663.7 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 589.4 / 1.0000 | 645.5 / 1.0000 | 994.7 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 213.7 / 0.9618 | 277.8 / 0.9618 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1309.6 / 0.9940 | 1382.0 / 0.9940 | 2699.1 / 0.9940 |
| usearch_b1_rescore | ef 200 | 329.3 / 0.9748 | 398.1 / 0.9748 | 349.1 / 0.9819 | 411.3 / 0.9819 | 543.5 / 0.9819 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2416.2 / 0.9931 | 2515.5 / 0.9931 | 3908.8 / 0.9931 |
| usearch_b1_rescore | ef 400 |  |  | 560.5 / 0.9862 | 628.3 / 0.9858 | 761.9 / 0.9858 | 593.5 / 0.9904 | 659.4 / 0.9904 | 1045.8 / 0.9904 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1004.7 / 0.9912 | 1062.8 / 0.9912 | 1483.4 / 0.9912 |  |  |  |

### advtest / bge-base-en-v1.5 (n_ho = 1200, exact quality 0.2223)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_exact | 0.98 | 2607.2 | 6 | 1.0000 | yes / yes | 11.91 [11.81, 12.24] | 81 | 217 |
| faiss_exact | 0.99 | 2607.2 | 6 | 1.0000 | yes / yes | 11.91 [11.81, 12.24] | 81 | 217 |
| faiss_exact | 0.995 | 2607.2 | 6 | 1.0000 | yes / yes | 9.93 [9.75, 10.13] | 81 | 217 |
| faiss_hnsw_flat | 0.98 | 889.5 | 6 | 0.9809 | yes / no | 4.06 [4.00, 4.16] | 87 | 235 |
| faiss_hnsw_flat | 0.99 | 1683.6 | 6 | 0.9934 | yes / no | 7.69 [7.58, 7.89] | 87 | 235 |
| faiss_hnsw_flat | 0.995 | 3065.2 | 6 | 0.9963 | yes / no | 11.67 [11.49, 11.80] | 85 | 229 |
| faiss_hnsw_sq8 | 0.98 | 1286.3 | 6 | 0.9810 | yes / no | 5.88 [5.85, 5.98] | 104 | 439 |
| faiss_hnsw_sq8 | 0.99 | 2340.6 | 6 | 0.9971 | yes / yes | 10.69 [10.65, 10.88] | 104 | 438 |
| faiss_hnsw_sq8 | 0.995 | 4380.7 | 6 | 0.9975 | yes / no | 16.68 [16.46, 16.85] | 104 | 443 |
| faiss_ivfpq_fs | 0.98 | 298.8 | 6 | 1.0013 | yes / yes | 1.36 [1.36, 1.39] | 86 | 385 |
| faiss_ivfpq_fs | 0.99 | 298.8 | 6 | 1.0013 | yes / yes | 1.36 [1.36, 1.39] | 86 | 385 |
| faiss_ivfpq_fs | 0.995 | 298.8 | 6 | 1.0013 | yes / yes | 1.14 [1.12, 1.15] | 86 | 385 |
| faiss_rabitq_flat | 0.98 | 1053.3 | 6 | 0.9851 | yes / no | 4.81 [4.80, 4.90] | 84 | 373 |
| faiss_rabitq_flat | 0.99 | 1053.3 | 6 | 0.9851 | no / no | 4.81 [4.80, 4.90] | 84 | 373 |
| faiss_rabitq_flat | 0.995 | 1065.5 | 6 | 1.0021 | yes / yes | 4.06 [4.01, 4.10] | 84 | 375 |
| faiss_rabitq_hnsw | 0.98 | 581.8 | 6 | 0.9878 | yes / no | 2.66 [2.59, 2.72] | 95 | 414 |
| faiss_rabitq_hnsw | 0.99 | 581.8 | 6 | 0.9878 | no / no | 2.66 [2.59, 2.72] | 95 | 414 |
| faiss_rabitq_hnsw | 0.995 | 1127.2 | 6 | 1.0022 | yes / yes | 4.29 [4.21, 4.37] | 95 | 412 |
| faiss_rabitq_ivf | 0.98 | 1734.5 | 6 | 1.0005 | yes / yes | 7.92 [7.89, 8.07] | 84 | 383 |
| faiss_rabitq_ivf | 0.99 | 1734.5 | 6 | 1.0005 | yes / yes | 7.92 [7.89, 8.07] | 84 | 383 |
| faiss_rabitq_ivf | 0.995 | 1734.5 | 6 | 1.0005 | yes / yes | 6.60 [6.51, 6.67] | 84 | 383 |
| hnswlib_f32 | 0.98 | 3279.9 | 6 | 0.9897 | yes / no | 14.98 [14.87, 15.26] | 89 | 213 |
| hnswlib_f32 | 0.99 | 5509.5 | 6 | 0.9884 | no / no | 25.17 [25.02, 25.64] | 89 | 213 |
| hnswlib_f32 | 0.995 | 6226.0 | 6 | 0.9921 | no / no | 23.70 [23.35, 23.96] | 91 | 220 |
| ours_cascade | 0.98 | 218.9 | 6 | 0.9960 | yes / yes |  | 174 | 452 |
| ours_cascade | 0.99 | 218.9 | 6 | 0.9960 | yes / no |  | 174 | 452 |
| ours_cascade | 0.995 | 262.7 | 6 | 0.9964 | yes / no |  | 174 | 621 |
| scann | 0.98 | 334.7 | 6 | 0.9991 | yes / yes | 1.53 [1.52, 1.56] | 125 | 373 |
| scann | 0.99 | 334.7 | 6 | 0.9991 | yes / yes | 1.53 [1.52, 1.56] | 125 | 373 |
| scann | 0.995 | 334.7 | 6 | 0.9991 | yes / yes | 1.27 [1.26, 1.29] | 125 | 373 |
| usearch_f16 | 0.98 | 1898.5 | 6 | 0.9861 | yes / no | 8.67 [8.58, 8.84] | 54 | 158 |
| usearch_f16 | 0.99 | 3882.1 | 6 | 0.9934 | yes / no | 17.73 [17.61, 18.10] | 63 | 194 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 140.0 / 0.9638 | 193.6 / 0.9638 | 176.9 / 0.9837 | 231.5 / 0.9837 | 339.7 / 0.9837 | 252.5 / 0.9978 | 306.6 / 0.9978 | 637.3 / 0.9978 | 465.5 / 0.9960 | 521.8 / 0.9959 | 1514.9 / 0.9959 |
| faiss_bin_hnsw | ef 100 | 180.7 / 0.8978 | 237.1 / 0.8978 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1806.2 / 0.9980 | 1876.6 / 0.9979 | 2968.6 / 0.9979 |
| faiss_bin_hnsw | ef 200 | 272.0 / 0.9375 | 333.3 / 0.9375 | 307.1 / 0.9586 | 365.2 / 0.9586 | 491.7 / 0.9586 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4465.5 / 0.9957 | 4539.8 / 0.9956 | 5644.6 / 0.9956 |
| faiss_bin_hnsw | ef 400 |  |  | 518.5 / 0.9848 | 588.3 / 0.9848 | 709.2 / 0.9848 | 598.2 / 0.9940 | 664.7 / 0.9940 | 1035.5 / 0.9940 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1185.9 / 0.9991 | 1244.7 / 0.9991 | 1638.8 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 100 | 476.0 / 0.9494 | 531.2 / 0.9494 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3614.3 / 0.9941 | 3694.7 / 0.9937 | 4753.6 / 0.9936 |
| faiss_hnsw_flat | ef 200 | 800.6 / 0.9693 | 859.3 / 0.9693 | 828.1 / 0.9693 | 890.1 / 0.9693 | 1007.7 / 0.9693 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 7456.1 / 0.9954 | 7553.5 / 0.9950 | 8581.4 / 0.9950 |
| faiss_hnsw_flat | ef 400 |  |  | 1454.0 / 0.9934 | 1516.5 / 0.9934 | 1654.0 / 0.9934 | 1522.2 / 0.9934 | 1559.8 / 0.9934 | 1933.0 / 0.9934 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2786.5 / 0.9941 | 2838.1 / 0.9937 | 3198.3 / 0.9936 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1168.0 / 1.0003 | 1221.8 / 1.0003 | 1203.8 / 1.0004 | 1257.2 / 0.9999 | 1363.9 / 0.9999 | 1268.1 / 1.0004 | 1321.3 / 0.9999 | 1649.8 / 0.9999 | 1445.0 / 1.0004 | 1500.9 / 0.9999 | 2485.0 / 0.9999 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 208.8 / 0.4793 | 263.1 / 0.4793 | 370.0 / 0.4793 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 333.7 / 0.6648 | 387.5 / 0.6648 | 716.9 / 0.6648 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 494.2 / 0.6955 | 549.0 / 0.6955 | 1547.2 / 0.6955 |
| faiss_rabitq_ivf | nprobe 3 | 119.6 / 0.2970 | 171.6 / 0.2966 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 742.7 / 0.8188 | 797.8 / 0.8188 | 1796.7 / 0.8188 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 155.3 / 0.3626 | 209.7 / 0.3626 | 318.9 / 0.3626 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 150.1 / 0.3899 | 202.8 / 0.3899 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 236.8 / 0.4555 | 290.4 / 0.4555 | 616.7 / 0.4555 |  |  |  |
| hnswlib_f32 | ef 100 | 1125.5 / 0.9497 | 1179.9 / 0.9497 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 6386.2 / 0.9921 | 6451.8 / 0.9921 | 7521.2 / 0.9920 |
| hnswlib_f32 | ef 200 | 1908.3 / 0.9783 | 1972.8 / 0.9782 | 1929.4 / 0.9783 | 1990.5 / 0.9782 | 2105.6 / 0.9782 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 9748.7 / 1.0005 | 9834.2 / 1.0001 | 10853.6 / 1.0001 |
| hnswlib_f32 | ef 400 |  |  | 3237.6 / 0.9906 | 3295.4 / 0.9906 | 3408.7 / 0.9906 | 3287.4 / 0.9906 | 3346.3 / 0.9906 | 3691.8 / 0.9906 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 5389.2 / 0.9924 | 5431.3 / 0.9924 | 5800.6 / 0.9923 |  |  |  |
| ours_scan | ef 100 | 105.8 / 0.9592 | 127.4 / 0.9592 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 209.2 / 0.9965 | 234.7 / 0.9964 | 670.7 / 0.9964 |
| ours_scan | ef 200 |  |  | 117.5 / 0.9841 | 140.0 / 0.9841 | 177.1 / 0.9841 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 142.5 / 0.9985 | 163.8 / 0.9985 | 299.6 / 0.9985 |  |  |  |
| ours_walk | ef 100 | 124.3 / 0.9332 | 151.6 / 0.9332 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 332.9 / 0.9951 | 370.3 / 0.9951 | 853.5 / 0.9951 |
| ours_walk | ef 200 | 139.8 / 0.9504 | 168.7 / 0.9504 | 152.0 / 0.9716 | 181.5 / 0.9716 | 237.4 / 0.9716 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 391.0 / 0.9956 | 429.5 / 0.9956 | 909.8 / 0.9956 |
| ours_walk | ef 400 |  |  | 185.6 / 0.9819 | 212.8 / 0.9819 | 269.3 / 0.9819 | 213.9 / 0.9924 | 243.7 / 0.9924 | 406.5 / 0.9924 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 246.4 / 0.9964 | 275.5 / 0.9964 | 437.4 / 0.9964 |  |  |  |
| scann | reorder 100 | 433.1 / 0.9994 | 490.8 / 0.9994 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 835.9 / 1.0004 | 903.5 / 0.9999 | 1950.6 / 0.9999 |
| scann | reorder 200 |  |  | 483.5 / 1.0004 | 541.3 / 0.9999 | 654.1 / 0.9999 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 575.4 / 1.0004 | 632.0 / 0.9999 | 980.3 / 0.9999 |  |  |  |
| usearch_b1_rescore | ef 100 | 185.6 / 0.8882 | 248.3 / 0.8882 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1108.5 / 0.9958 | 1195.9 / 0.9957 | 2441.9 / 0.9957 |
| usearch_b1_rescore | ef 200 | 270.2 / 0.9450 | 338.3 / 0.9450 | 289.9 / 0.9646 | 351.5 / 0.9646 | 483.2 / 0.9646 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2119.3 / 0.9963 | 2193.3 / 0.9962 | 3515.7 / 0.9962 |
| usearch_b1_rescore | ef 400 |  |  | 467.4 / 0.9936 | 538.1 / 0.9936 | 655.3 / 0.9936 | 495.3 / 0.9979 | 558.3 / 0.9979 | 951.7 / 0.9979 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 836.6 / 0.9981 | 908.6 / 0.9981 | 1326.0 / 0.9981 |  |  |  |

### advtest / jina-v2-base-code (n_ho = 1200, exact quality 0.3577)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 94.6 | 6 | 1.0013 | yes / yes | 0.72 [0.71, 0.74] | 82 | 363 |
| faiss_bin_flat | 0.99 | 94.6 | 6 | 1.0013 | yes / yes | 0.72 [0.71, 0.74] | 82 | 363 |
| faiss_bin_flat | 0.995 | 94.6 | 6 | 1.0013 | yes / yes | 0.63 [0.62, 0.64] | 82 | 363 |
| faiss_bin_hnsw | 0.98 | 111.7 | 6 | 0.9950 | yes / yes | 0.85 [0.82, 0.87] | 88 | 383 |
| faiss_bin_hnsw | 0.99 | 157.3 | 6 | 0.9987 | yes / yes | 1.20 [1.18, 1.26] | 88 | 382 |
| faiss_bin_hnsw | 0.995 | 265.5 | 6 | 0.9987 | yes / no | 1.76 [1.73, 1.82] | 88 | 384 |
| faiss_exact | 0.98 | 2684.2 | 6 | 1.0000 | yes / yes | 20.51 [20.25, 20.87] | 81 | 216 |
| faiss_exact | 0.99 | 2684.2 | 6 | 1.0000 | yes / yes | 20.51 [20.25, 20.87] | 81 | 216 |
| faiss_exact | 0.995 | 2684.2 | 6 | 1.0000 | yes / yes | 17.81 [17.59, 18.16] | 81 | 216 |
| faiss_hnsw_flat | 0.98 | 212.4 | 6 | 0.9951 | yes / yes | 1.62 [1.60, 1.64] | 93 | 249 |
| faiss_hnsw_flat | 0.99 | 289.5 | 6 | 0.9880 | no / no | 2.21 [2.17, 2.26] | 93 | 252 |
| faiss_hnsw_flat | 0.995 | 362.6 | 6 | 0.9956 | yes / no | 2.41 [2.36, 2.46] | 93 | 248 |
| faiss_hnsw_sq8 | 0.98 | 301.3 | 6 | 0.9889 | yes / no | 2.30 [2.28, 2.33] | 104 | 437 |
| faiss_hnsw_sq8 | 0.99 | 432.9 | 6 | 0.9892 | no / no | 3.31 [3.28, 3.35] | 109 | 455 |
| faiss_hnsw_sq8 | 0.995 | 696.7 | 6 | 0.9977 | yes / no | 4.62 [4.58, 4.69] | 101 | 428 |
| faiss_ivfpq_fs | 0.98 | 177.0 | 6 | 0.9970 | yes / yes | 1.35 [1.33, 1.37] | 86 | 386 |
| faiss_ivfpq_fs | 0.99 | 177.0 | 6 | 0.9970 | yes / yes | 1.35 [1.33, 1.37] | 86 | 386 |
| faiss_ivfpq_fs | 0.995 | 194.0 | 6 | 0.9970 | yes / no | 1.29 [1.27, 1.31] | 86 | 386 |
| faiss_rabitq_flat | 0.98 | 1052.3 | 6 | 0.9971 | yes / yes | 8.04 [7.96, 8.14] | 83 | 374 |
| faiss_rabitq_flat | 0.99 | 1052.3 | 6 | 0.9971 | yes / yes | 8.04 [7.96, 8.14] | 83 | 374 |
| faiss_rabitq_flat | 0.995 | 1052.3 | 6 | 0.9971 | yes / no | 6.98 [6.92, 7.09] | 83 | 374 |
| faiss_rabitq_hnsw | 0.98 | 235.7 | 6 | 0.9937 | yes / yes | 1.80 [1.67, 1.85] | 95 | 411 |
| faiss_rabitq_hnsw | 0.99 | 363.1 | 6 | 0.9986 | yes / yes | 2.77 [2.69, 2.82] | 95 | 411 |
| faiss_rabitq_hnsw | 0.995 | 589.7 | 6 | 0.9998 | yes / yes | 3.91 [3.84, 4.01] | 95 | 412 |
| faiss_rabitq_ivf | 0.98 | 788.3 | 6 | 0.9970 | yes / yes | 6.02 [5.96, 6.10] | 84 | 382 |
| faiss_rabitq_ivf | 0.99 | 788.3 | 6 | 0.9970 | yes / yes | 6.02 [5.96, 6.10] | 84 | 382 |
| faiss_rabitq_ivf | 0.995 | 1742.0 | 6 | 1.0000 | yes / yes | 11.56 [11.45, 11.74] | 84 | 381 |
| hnswlib_f32 | 0.98 | 563.4 | 6 | 0.9848 | yes / no | 4.31 [4.27, 4.36] | 91 | 215 |
| hnswlib_f32 | 0.99 | 997.2 | 6 | 0.9971 | yes / yes | 7.62 [7.56, 7.73] | 97 | 232 |
| hnswlib_f32 | 0.995 | 1099.1 | 6 | 0.9960 | yes / no | 7.29 [7.23, 7.41] | 89 | 208 |
| ours_cascade | 0.98 | 130.9 | 6 | 0.9987 | yes / yes |  | 172 | 112 |
| ours_cascade | 0.99 | 130.9 | 6 | 0.9987 | yes / yes |  | 172 | 112 |
| ours_cascade | 0.995 | 150.7 | 6 | 1.0008 | yes / yes |  | 172 | 171 |
| scann | 0.98 | 333.5 | 6 | 1.0000 | yes / yes | 2.55 [2.52, 2.58] | 125 | 372 |
| scann | 0.99 | 333.5 | 6 | 1.0000 | yes / yes | 2.55 [2.52, 2.58] | 125 | 372 |
| scann | 0.995 | 333.5 | 6 | 1.0000 | yes / yes | 2.21 [2.19, 2.25] | 125 | 372 |
| usearch_b1_rescore | 0.98 | 122.2 | 6 | 0.9884 | yes / no | 0.93 [0.92, 0.95] | 90 | 388 |
| usearch_b1_rescore | 0.99 | 165.5 | 6 | 0.9967 | yes / no | 1.26 [1.24, 1.29] | 90 | 390 |
| usearch_b1_rescore | 0.995 | 437.2 | 6 | 0.9955 | yes / no | 2.90 [2.85, 2.98] | 90 | 391 |
| usearch_f16 | 0.98 | 405.0 | 6 | 0.9882 | yes / no | 3.10 [3.05, 3.14] | 54 | 154 |
| usearch_f16 | 0.99 | 515.0 | 6 | 0.9914 | yes / no | 3.94 [3.89, 4.01] | 57 | 168 |
| usearch_f16 | 0.995 | 713.5 | 6 | 0.9937 | no / no | 4.73 [4.63, 4.84] | 54 | 157 |
| usearch_i8 | 0.98 | 276.7 | 6 | 0.9942 | yes / no | 2.11 [2.08, 2.16] | 41 | 98 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 140.5 / 1.0005 | 194.4 / 1.0005 | 178.1 / 0.9999 | 232.1 / 0.9999 | 340.5 / 0.9999 | 252.9 / 0.9997 | 307.1 / 0.9997 | 640.9 / 0.9997 | 468.5 / 1.0000 | 522.3 / 1.0000 | 1517.8 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 183.0 / 0.9964 | 242.4 / 0.9964 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1805.6 / 1.0000 | 1870.5 / 1.0000 | 2951.3 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 270.0 / 0.9996 | 334.1 / 0.9996 | 304.1 / 0.9993 | 370.7 / 0.9993 | 492.3 / 0.9993 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4492.2 / 1.0000 | 4549.6 / 1.0000 | 5659.7 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 528.2 / 0.9981 | 589.8 / 0.9981 | 720.1 / 0.9981 | 602.0 / 0.9974 | 665.4 / 0.9974 | 1032.7 / 0.9974 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1195.3 / 0.9997 | 1261.2 / 0.9997 | 1636.4 / 0.9997 |  |  |  |
| faiss_hnsw_flat | ef 100 | 580.4 / 0.9999 | 639.6 / 0.9999 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4004.8 / 1.0000 | 4063.5 / 1.0000 | 5122.3 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 980.2 / 1.0001 | 1038.2 / 1.0001 | 1001.9 / 1.0001 | 1066.7 / 1.0001 | 1181.5 / 1.0001 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 7941.9 / 1.0000 | 7987.5 / 1.0000 | 9036.7 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1715.0 / 1.0000 | 1777.6 / 1.0000 | 1896.6 / 1.0000 | 1775.1 / 1.0000 | 1838.7 / 1.0000 | 2191.4 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3151.3 / 1.0000 | 3198.2 / 1.0000 | 3565.6 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1167.6 / 1.0000 | 1221.7 / 1.0000 | 1204.0 / 1.0000 | 1256.8 / 1.0000 | 1364.6 / 1.0000 | 1266.2 / 1.0000 | 1321.7 / 1.0000 | 1648.1 / 1.0000 | 1446.3 / 1.0000 | 1499.2 / 1.0000 | 2486.5 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 235.3 / 0.8566 | 289.5 / 0.8566 | 398.5 / 0.8566 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 379.4 / 0.9088 | 432.8 / 0.9088 | 762.2 / 0.9088 |  |  |  |
| faiss_rabitq_ivf | nprobe 21 |  |  |  |  |  |  |  |  | 563.0 / 0.9190 | 617.8 / 0.9190 | 1614.0 / 0.9190 |
| faiss_rabitq_ivf | nprobe 3 | 129.5 / 0.6559 | 182.4 / 0.6559 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 42 |  |  |  |  |  |  |  |  | 828.5 / 0.9747 | 881.0 / 0.9747 | 1878.2 / 0.9747 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 173.7 / 0.7737 | 228.1 / 0.7737 | 336.7 / 0.7737 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 164.9 / 0.7887 | 218.6 / 0.7887 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 267.9 / 0.8431 | 321.4 / 0.8431 | 649.3 / 0.8431 |  |  |  |
| hnswlib_f32 | ef 100 | 1449.3 / 0.9983 | 1501.9 / 0.9983 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 7653.4 / 1.0000 | 7685.9 / 1.0000 | 8736.0 / 1.0000 |
| hnswlib_f32 | ef 200 | 2435.4 / 1.0000 | 2492.2 / 1.0000 | 2459.5 / 1.0000 | 2516.7 / 1.0000 | 2625.8 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 11100.5 / 1.0000 | 11127.1 / 1.0000 | 12174.5 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 4049.1 / 1.0000 | 4124.4 / 1.0000 | 4244.4 / 1.0000 | 4097.2 / 1.0000 | 4163.2 / 1.0000 | 4514.0 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 6526.0 / 1.0000 | 6572.3 / 1.0000 | 6916.3 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 106.8 / 1.0008 | 127.1 / 1.0008 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 215.1 / 1.0000 | 240.3 / 1.0000 | 693.7 / 1.0000 |
| ours_scan | ef 200 |  |  | 120.3 / 1.0004 | 140.5 / 1.0004 | 180.5 / 1.0004 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 143.0 / 0.9997 | 165.7 / 0.9997 | 306.1 / 0.9997 |  |  |  |
| ours_walk | ef 100 | 112.5 / 1.0006 | 140.5 / 1.0006 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 333.8 / 1.0000 | 362.7 / 1.0000 | 857.7 / 1.0000 |
| ours_walk | ef 200 | 131.2 / 1.0013 | 156.5 / 1.0013 | 147.7 / 1.0005 | 173.9 / 1.0005 | 228.3 / 1.0005 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 398.8 / 1.0000 | 418.8 / 1.0000 | 936.7 / 1.0000 |
| ours_walk | ef 400 |  |  | 166.8 / 1.0005 | 200.3 / 1.0005 | 245.7 / 1.0005 | 198.1 / 0.9997 | 228.8 / 0.9997 | 391.5 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 232.6 / 0.9997 | 261.6 / 0.9997 | 428.5 / 0.9997 |  |  |  |
| scann | reorder 100 | 436.5 / 1.0000 | 494.0 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 857.6 / 1.0000 | 914.4 / 1.0000 | 1978.0 / 1.0000 |
| scann | reorder 200 |  |  | 488.2 / 1.0000 | 545.8 / 1.0000 | 658.7 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 583.7 / 1.0000 | 641.6 / 1.0000 | 988.6 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 182.4 / 0.9920 | 248.3 / 0.9920 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1084.1 / 0.9946 | 1155.5 / 0.9946 | 2429.1 / 0.9946 |
| usearch_b1_rescore | ef 200 | 269.7 / 0.9960 | 337.1 / 0.9960 | 285.4 / 0.9962 | 351.8 / 0.9962 | 481.9 / 0.9962 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1998.6 / 0.9946 | 2078.0 / 0.9946 | 3424.8 / 0.9946 |
| usearch_b1_rescore | ef 400 |  |  | 456.2 / 0.9957 | 520.2 / 0.9957 | 659.0 / 0.9957 | 490.2 / 0.9955 | 561.8 / 0.9955 | 952.7 / 0.9955 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 800.1 / 0.9943 | 876.0 / 0.9943 | 1274.9 / 0.9943 |  |  |  |

### csn1m / CodeRankEmbed (n_ho = 2400, exact quality 0.5497)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 2732.4 | 6 | 0.9914 | yes / yes | 5.45 [4.60, 6.29] | 3063 | 16181 |
| faiss_bin_flat | 0.99 | 2900.4 | 6 | 0.9942 | yes / no | 3.87 [3.30, 4.49] | 3063 | 16160 |
| faiss_bin_flat | 0.995 | 3096.1 | 6 | 0.9969 | yes / no | 3.22 [2.72, 3.75] | 3063 | 16162 |
| faiss_bin_hnsw | 0.98 | 1224.3 | 6 | 0.9935 | yes / yes | 2.44 [2.11, 2.66] | 3558 | 17810 |
| faiss_bin_hnsw | 0.99 | 1977.8 | 6 | 0.9946 | yes / no | 2.64 [2.31, 3.00] | 3558 | 17818 |
| faiss_bin_hnsw | 0.995 | 4885.5 | 6 | 0.9971 | yes / no | 5.08 [4.42, 5.72] | 3558 | 17862 |
| faiss_exact | 0.98 | 117849.1 | 6 | 1.0000 | yes / yes | 235.06 [198.99, 268.99] | 2970 | 9249 |
| faiss_exact | 0.99 | 117849.1 | 6 | 1.0000 | yes / yes | 157.07 [136.97, 184.01] | 2970 | 9249 |
| faiss_exact | 0.995 | 117849.1 | 6 | 1.0000 | yes / yes | 122.58 [104.99, 142.73] | 2970 | 9249 |
| faiss_hnsw_flat | 0.98 | 1535.8 | 6 | 0.9930 | yes / yes | 3.06 [2.60, 3.38] | 3478 | 10784 |
| faiss_hnsw_flat | 0.99 | 2224.1 | 6 | 0.9965 | yes / yes | 2.96 [2.60, 3.37] | 3478 | 10750 |
| faiss_hnsw_flat | 0.995 | 2881.3 | 6 | 0.9969 | yes / no | 3.00 [2.57, 3.37] | 3478 | 10767 |
| faiss_hnsw_sq8 | 0.98 | 1756.6 | 6 | 0.9905 | yes / yes | 3.50 [3.05, 3.82] | 3988 | 19040 |
| faiss_hnsw_sq8 | 0.99 | 3206.1 | 6 | 0.9974 | yes / yes | 4.27 [3.77, 4.81] | 4233 | 19835 |
| faiss_hnsw_sq8 | 0.995 | 5950.5 | 6 | 0.9986 | yes / yes | 6.19 [5.42, 6.91] | 4233 | 19889 |
| faiss_ivfpq_fs | 0.98 | 4011.0 | 6 | 0.9909 | yes / yes | 8.00 [6.60, 9.14] | 3106 | 16298 |
| faiss_ivfpq_fs | 0.99 | 4789.4 | 6 | 0.9940 | yes / no | 6.38 [5.55, 7.28] | 3087 | 16244 |
| faiss_ivfpq_fs | 0.995 | 7177.9 | 6 | 0.9963 | yes / no | 7.47 [6.21, 8.61] | 3106 | 16273 |
| faiss_rabitq_flat | 0.98 | 47775.4 | 6 | 0.9965 | yes / yes | 95.29 [82.95, 103.76] | 3102 | 16308 |
| faiss_rabitq_flat | 0.99 | 47775.4 | 6 | 0.9965 | yes / yes | 63.68 [56.78, 72.42] | 3102 | 16308 |
| faiss_rabitq_flat | 0.995 | 47791.0 | 6 | 1.0001 | yes / yes | 49.71 [43.86, 55.92] | 3102 | 16318 |
| faiss_rabitq_hnsw | 0.98 | 1275.1 | 6 | 0.9873 | yes / no | 2.54 [2.19, 2.77] | 3597 | 17860 |
| faiss_rabitq_hnsw | 0.99 | 2359.4 | 6 | 0.9942 | yes / no | 3.14 [2.78, 3.57] | 3597 | 17867 |
| faiss_rabitq_hnsw | 0.995 | 4489.2 | 6 | 0.9973 | yes / no | 4.67 [4.05, 5.23] | 3597 | 17899 |
| faiss_rabitq_ivf | 0.98 | 17935.5 | 6 | 0.9908 | yes / yes | 35.77 [31.14, 38.86] | 3091 | 16329 |
| faiss_rabitq_ivf | 0.99 | 26548.5 | 6 | 0.9938 | yes / no | 35.38 [31.56, 40.22] | 3081 | 16309 |
| faiss_rabitq_ivf | 0.995 | 34517.3 | 6 | 0.9962 | yes / no | 35.90 [31.71, 40.36] | 3091 | 16324 |
| hnswlib_f32 | 0.98 | 3556.5 | 6 | 0.9932 | yes / yes | 7.09 [6.15, 7.72] | 3334 | 9717 |
| hnswlib_f32 | 0.99 | 6522.2 | 6 | 0.9957 | yes / yes | 8.69 [7.75, 9.86] | 3334 | 9706 |
| hnswlib_f32 | 0.995 | 8459.0 | 6 | 0.9987 | yes / yes | 8.80 [7.74, 9.88] | 3579 | 10412 |
| ours_cascade | 0.98 | 501.4 | 6 | 0.9899 | yes / yes |  | 3902 | 3271 |
| ours_cascade | 0.99 | 750.3 | 6 | 0.9957 | yes / yes |  | 3905 | 3398 |
| ours_cascade | 0.995 | 961.4 | 6 | 0.9976 | yes / no |  | 3914 | 3529 |
| scann | 0.98 | 2696.5 | 6 | 0.9904 | yes / yes | 5.38 [4.70, 5.86] | 3390 | 15405 |
| scann | 0.99 | 6919.3 | 6 | 0.9926 | yes / no | 9.22 [8.24, 10.41] | 3215 | 12396 |
| scann | 0.995 | 7412.3 | 6 | 0.9962 | yes / no | 7.71 [6.82, 8.67] | 3236 | 12455 |
| usearch_b1_rescore | 0.98 | 1945.0 | 6 | 0.9834 | yes / no | 3.88 [3.18, 4.27] | 3405 | 17110 |
| usearch_b1_rescore | 0.99 | 4347.5 | 6 | 0.9959 | yes / yes | 5.79 [4.76, 6.59] | 3650 | 17895 |
| usearch_f16 | 0.98 | 2640.2 | 6 | 0.9912 | yes / yes | 5.27 [4.38, 5.81] | 1865 | 7091 |
| usearch_f16 | 0.99 | 4951.6 | 6 | 0.9945 | yes / no | 6.60 [5.48, 7.51] | 1865 | 7072 |
| usearch_f16 | 0.995 | 9466.5 | 6 | 0.9995 | yes / yes | 9.85 [7.96, 11.08] | 2110 | 7827 |
| usearch_i8 | 0.98 | 1830.6 | 6 | 0.9873 | yes / no | 3.65 [2.95, 4.02] | 1374 | 4729 |
| usearch_i8 | 0.99 | 3383.4 | 6 | 0.9936 | yes / no | 4.51 [3.66, 5.13] | 1129 | 3976 |
| usearch_i8 | 0.995 | 11759.8 | 6 | 0.9958 | yes / no | 12.23 [10.30, 13.81] | 1129 | 3987 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 2896.4 / 0.9913 | 2928.0 / 0.9913 | 2872.0 / 0.9943 | 3030.2 / 0.9943 | 3131.8 / 0.9943 | 3032.0 / 0.9977 | 3151.5 / 0.9977 | 3509.3 / 0.9977 | 3393.1 / 0.9999 | 3480.9 / 0.9998 | 4584.1 / 0.9998 |
| faiss_bin_hnsw | ef 100 | 388.7 / 0.9540 | 452.5 / 0.9540 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3536.0 / 0.9946 | 3584.3 / 0.9946 | 4735.7 / 0.9946 |
| faiss_bin_hnsw | ef 200 | 660.1 / 0.9718 | 723.0 / 0.9718 | 697.4 / 0.9743 | 755.2 / 0.9743 | 883.7 / 0.9743 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 7907.9 / 0.9995 | 7976.4 / 0.9995 | 9087.0 / 0.9995 |
| faiss_bin_hnsw | ef 400 |  |  | 1255.4 / 0.9833 | 1316.2 / 0.9833 | 1441.2 / 0.9833 | 1354.3 / 0.9872 | 1417.6 / 0.9871 | 1765.0 / 0.9871 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2604.8 / 0.9928 | 2658.3 / 0.9927 | 3021.3 / 0.9927 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1345.2 / 0.9892 | 1404.7 / 0.9892 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 10955.1 / 1.0000 | 11085.3 / 1.0000 | 12099.6 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 2432.7 / 0.9951 | 2456.5 / 0.9951 | 2475.1 / 0.9952 | 2496.0 / 0.9951 | 2680.6 / 0.9951 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 21578.4 / 1.0000 | 21608.0 / 1.0000 | 22599.7 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 4588.9 / 0.9991 | 4609.6 / 0.9991 | 4700.7 / 0.9991 | 4705.3 / 0.9991 | 4741.3 / 0.9991 | 5021.4 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 8704.4 / 1.0000 | 8727.4 / 1.0000 | 9014.1 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 49219.7 / 0.9999 | 49279.8 / 1.0000 | 49270.8 / 1.0000 | 49330.9 / 1.0000 | 49449.8 / 1.0000 | 49362.7 / 1.0000 | 49421.8 / 1.0000 | 49789.8 / 1.0000 | 49686.2 / 1.0000 | 49751.9 / 1.0000 | 50819.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 233.0 / 0.4390 | 294.0 / 0.4390 | 262.8 / 0.4390 | 325.5 / 0.4390 | 447.3 / 0.4390 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 296.2 / 0.5791 | 357.6 / 0.5790 | 329.5 / 0.5790 | 392.2 / 0.5790 | 514.6 / 0.5790 | 392.2 / 0.5790 | 453.6 / 0.5790 | 842.4 / 0.5790 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 652.0 / 0.6485 | 707.6 / 0.6485 | 1830.3 / 0.6485 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 519.2 / 0.7009 | 584.1 / 0.7009 | 970.0 / 0.7009 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 856.8 / 0.7542 | 913.4 / 0.7542 | 2029.9 / 0.7542 |
| hnswlib_f32 | ef 100 | 3374.2 / 0.9903 | 3442.9 / 0.9903 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 25901.8 / 0.9996 | 26070.7 / 0.9996 | 27125.9 / 0.9996 |
| hnswlib_f32 | ef 200 | 6222.6 / 0.9950 | 6208.0 / 0.9950 | 6192.5 / 0.9949 | 6212.1 / 0.9949 | 6389.6 / 0.9950 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 47582.6 / 1.0000 | 47565.0 / 1.0000 | 48924.8 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 11420.2 / 0.9979 | 11478.1 / 0.9980 | 11652.7 / 0.9980 | 11492.9 / 0.9980 | 11496.1 / 0.9980 | 11833.5 / 0.9980 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 21142.0 / 0.9986 | 21238.3 / 0.9986 | 21630.0 / 0.9986 |  |  |  |
| ours_scan | ef 100 | 297.3 / 0.9781 | 334.5 / 0.9781 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 1260.5 / 0.9980 | 1301.1 / 0.9980 | 1830.3 / 0.9980 |
| ours_scan | ef 200 |  |  | 432.4 / 0.9900 | 464.8 / 0.9899 | 513.4 / 0.9899 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 665.9 / 0.9958 | 675.3 / 0.9957 | 869.8 / 0.9957 |  |  |  |
| ours_walk | ef 100 | 301.1 / 0.9781 | 331.3 / 0.9781 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 1265.3 / 0.9980 | 1296.5 / 0.9980 | 1823.5 / 0.9980 |
| ours_walk | ef 200 | 411.6 / 0.9861 | 441.0 / 0.9861 | 428.5 / 0.9900 | 451.6 / 0.9899 | 510.9 / 0.9899 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 1978.7 / 0.9997 | 2031.7 / 0.9996 | 2539.6 / 0.9996 |
| ours_walk | ef 400 |  |  | 625.7 / 0.9924 | 649.7 / 0.9923 | 707.9 / 0.9923 | 659.2 / 0.9958 | 674.2 / 0.9957 | 878.3 / 0.9957 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 1018.3 / 0.9958 | 1025.0 / 0.9957 | 1223.9 / 0.9957 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 242.5 / 0.4356 | 306.2 / 0.4356 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 297.4 / 0.4356 | 361.3 / 0.4356 | 487.5 / 0.4356 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 266.7 / 0.5741 | 327.1 / 0.5740 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 323.1 / 0.5740 | 385.4 / 0.5740 | 514.5 / 0.5740 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 432.3 / 0.5740 | 492.4 / 0.5740 | 877.3 / 0.5740 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 782.5 / 0.6568 | 834.7 / 0.6568 | 1977.0 / 0.6568 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 467.0 / 0.6948 | 531.2 / 0.6948 | 919.4 / 0.6948 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 850.1 / 0.7508 | 900.5 / 0.7508 | 2029.3 / 0.7508 |
| usearch_b1_rescore | ef 100 | 607.7 / 0.9492 | 668.7 / 0.9492 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 4903.5 / 0.9987 | 5038.0 / 0.9987 | 6192.6 / 0.9987 |
| usearch_b1_rescore | ef 200 | 1079.6 / 0.9721 | 1138.8 / 0.9721 | 1100.9 / 0.9744 | 1145.0 / 0.9744 | 1284.5 / 0.9744 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 9811.2 / 1.0001 | 9824.1 / 1.0001 | 10893.1 / 1.0001 |
| usearch_b1_rescore | ef 400 |  |  | 2024.0 / 0.9856 | 2090.5 / 0.9856 | 2223.3 / 0.9856 | 2071.8 / 0.9904 | 2089.5 / 0.9903 | 2492.6 / 0.9903 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 3916.2 / 0.9956 | 3936.6 / 0.9955 | 4352.0 / 0.9955 |  |  |  |

### csn1m / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.2580)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 2899.3 | 6 | 0.9873 | yes / no | 2.47 [2.21, 2.98] | 3063 | 16220 |
| faiss_bin_hnsw | 0.98 | 4394.2 | 6 | 0.9821 | yes / no | 3.75 [3.34, 4.14] | 3558 | 17840 |
| faiss_exact | 0.98 | 120178.5 | 6 | 1.0000 | yes / yes | 102.43 [89.42, 117.03] | 2970 | 9236 |
| faiss_exact | 0.99 | 120178.5 | 6 | 1.0000 | yes / yes | 63.15 [54.71, 73.31] | 2970 | 9236 |
| faiss_exact | 0.995 | 120178.5 | 6 | 1.0000 | yes / yes |  | 2970 | 9236 |
| faiss_hnsw_flat | 0.98 | 1875.7 | 6 | 0.9895 | yes / yes | 1.60 [1.43, 1.81] | 3477 | 10773 |
| faiss_hnsw_flat | 0.99 | 3514.7 | 6 | 0.9970 | yes / yes | 1.85 [1.63, 2.13] | 3477 | 10756 |
| faiss_hnsw_flat | 0.995 | 12619.2 | 6 | 0.9984 | yes / no |  | 3477 | 10818 |
| faiss_hnsw_sq8 | 0.98 | 2710.3 | 6 | 0.9896 | yes / yes | 2.31 [2.08, 2.55] | 4232 | 19903 |
| faiss_hnsw_sq8 | 0.99 | 4981.9 | 6 | 0.9970 | yes / yes | 2.62 [2.34, 2.96] | 4232 | 19907 |
| faiss_hnsw_sq8 | 0.995 | 9158.9 | 6 | 0.9984 | yes / no |  | 4232 | 19936 |
| faiss_ivfpq_fs | 0.98 | 9079.9 | 6 | 1.0020 | yes / yes | 7.74 [6.91, 8.62] | 3086 | 16314 |
| faiss_ivfpq_fs | 0.99 | 9079.9 | 6 | 1.0020 | yes / yes | 4.77 [4.22, 5.45] | 3086 | 16314 |
| faiss_ivfpq_fs | 0.995 | 9079.9 | 6 | 1.0020 | yes / yes |  | 3086 | 16314 |
| faiss_rabitq_flat | 0.98 | 47788.7 | 6 | 0.9979 | yes / yes | 40.73 [36.67, 44.90] | 3101 | 16362 |
| faiss_rabitq_flat | 0.99 | 47788.7 | 6 | 0.9979 | yes / yes | 25.11 [22.45, 28.39] | 3101 | 16362 |
| faiss_rabitq_flat | 0.995 | 47824.8 | 6 | 1.0006 | yes / yes |  | 3101 | 16375 |
| faiss_rabitq_hnsw | 0.98 | 7713.6 | 6 | 0.9845 | yes / no | 6.57 [5.84, 7.28] | 3596 | 17992 |
| faiss_rabitq_ivf | 0.98 | 52683.3 | 6 | 0.9998 | yes / yes | 44.90 [40.43, 49.49] | 3080 | 16404 |
| faiss_rabitq_ivf | 0.99 | 52683.3 | 6 | 0.9998 | yes / yes | 27.68 [24.75, 31.30] | 3080 | 16404 |
| faiss_rabitq_ivf | 0.995 | 52683.3 | 6 | 0.9998 | yes / yes |  | 3080 | 16404 |
| hnswlib_f32 | 0.98 | 5828.8 | 6 | 0.9907 | yes / yes | 4.97 [4.45, 5.50] | 3334 | 9736 |
| hnswlib_f32 | 0.99 | 10383.1 | 6 | 0.9951 | yes / no | 5.46 [4.85, 6.17] | 3579 | 10452 |
| hnswlib_f32 | 0.995 | 19039.5 | 6 | 0.9981 | yes / no |  | 3579 | 10430 |
| ours_cascade | 0.98 | 1173.3 | 6 | 0.9909 | yes / yes |  | 3900 | 3803 |
| ours_cascade | 0.99 | 1903.1 | 6 | 0.9945 | yes / no |  | 3900 | 4424 |
| scann | 0.98 | 6874.4 | 6 | 0.9999 | yes / yes | 5.86 [5.27, 6.46] | 3214 | 12305 |
| scann | 0.99 | 7520.4 | 6 | 0.9961 | yes / yes | 3.95 [3.53, 4.47] | 3385 | 15117 |
| scann | 0.995 | 12418.2 | 6 | 1.0000 | yes / yes |  | 3385 | 15096 |
| usearch_f16 | 0.98 | 4200.2 | 6 | 0.9924 | yes / yes | 3.58 [2.96, 4.00] | 2111 | 7867 |
| usearch_f16 | 0.99 | 7706.7 | 6 | 0.9966 | yes / yes | 4.05 [3.38, 4.61] | 2111 | 7881 |
| usearch_f16 | 0.995 | 14996.9 | 6 | 0.9980 | yes / no |  | 1865 | 7123 |
| usearch_i8 | 0.98 | 9614.3 | 6 | 0.9849 | yes / no | 8.19 [6.53, 9.20] | 1375 | 4747 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 2886.6 / 0.9719 | 2900.7 / 0.9719 | 2920.2 / 0.9827 | 2923.0 / 0.9827 | 3099.6 / 0.9827 | 2952.9 / 0.9893 | 3062.5 / 0.9895 | 3365.8 / 0.9895 | 3307.8 / 0.9957 | 3396.3 / 0.9956 | 4538.1 / 0.9956 |
| faiss_bin_hnsw | ef 100 | 383.8 / 0.8970 | 446.5 / 0.8970 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3451.4 / 0.9937 | 3524.2 / 0.9936 | 4631.7 / 0.9935 |
| faiss_bin_hnsw | ef 200 | 641.3 / 0.9357 | 701.6 / 0.9357 | 674.1 / 0.9454 | 745.3 / 0.9452 | 862.2 / 0.9452 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 7614.3 / 0.9952 | 7736.9 / 0.9951 | 8785.8 / 0.9951 |
| faiss_bin_hnsw | ef 400 |  |  | 1222.7 / 0.9707 | 1296.5 / 0.9707 | 1413.9 / 0.9707 | 1294.7 / 0.9762 | 1358.8 / 0.9764 | 1729.9 / 0.9764 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2508.1 / 0.9862 | 2579.3 / 0.9864 | 2929.9 / 0.9864 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1210.9 / 0.9840 | 1248.7 / 0.9842 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 9772.9 / 0.9984 | 9768.9 / 0.9980 | 10860.6 / 0.9982 |
| faiss_hnsw_flat | ef 200 | 2141.6 / 0.9915 | 2194.9 / 0.9917 | 2187.3 / 0.9918 | 2243.0 / 0.9917 | 2362.7 / 0.9917 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 18913.1 / 0.9985 | 19205.8 / 0.9981 | 20175.1 / 0.9983 |
| faiss_hnsw_flat | ef 400 |  |  | 4065.1 / 0.9970 | 4108.9 / 0.9969 | 4196.0 / 0.9969 | 4043.5 / 0.9970 | 4126.5 / 0.9967 | 4474.6 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 7606.9 / 0.9979 | 7697.6 / 0.9975 | 8002.4 / 0.9977 |  |  |  |
| faiss_rabitq_flat | exhaustive | 49224.4 / 1.0000 | 49262.4 / 0.9999 | 49244.0 / 0.9999 | 49309.4 / 0.9997 | 49441.1 / 0.9997 | 49339.0 / 1.0001 | 49401.0 / 1.0000 | 49775.4 / 0.9999 | 49647.7 / 1.0001 | 49717.7 / 0.9998 | 50802.8 / 0.9999 |
| faiss_rabitq_ivf | nprobe 1 | 234.8 / 0.2257 | 291.5 / 0.2257 | 261.7 / 0.2257 | 322.7 / 0.2257 | 445.7 / 0.2257 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 296.8 / 0.3084 | 354.4 / 0.3084 | 327.1 / 0.3084 | 386.5 / 0.3084 | 512.1 / 0.3084 | 387.2 / 0.3084 | 449.4 / 0.3084 | 814.1 / 0.3084 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 632.0 / 0.3582 | 708.6 / 0.3582 | 1827.5 / 0.3582 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 519.0 / 0.3896 | 581.3 / 0.3896 | 949.6 / 0.3896 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 845.8 / 0.4355 | 920.5 / 0.4354 | 2038.1 / 0.4354 |
| hnswlib_f32 | ef 100 | 3120.1 / 0.9793 | 3170.6 / 0.9793 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 23314.4 / 0.9974 | 23452.9 / 0.9971 | 24501.9 / 0.9973 |
| hnswlib_f32 | ef 200 | 5699.8 / 0.9911 | 5711.8 / 0.9913 | 5682.6 / 0.9914 | 5762.0 / 0.9913 | 5858.3 / 0.9913 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 41509.7 / 0.9982 | 42245.8 / 0.9979 | 43001.0 / 0.9981 |
| hnswlib_f32 | ef 400 |  |  | 10430.6 / 0.9966 | 10484.4 / 0.9965 | 10636.1 / 0.9965 | 10414.4 / 0.9966 | 10485.2 / 0.9963 | 10870.6 / 0.9965 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 19024.7 / 0.9974 | 19068.8 / 0.9971 | 19344.1 / 0.9973 |  |  |  |
| ours_scan | ef 100 | 275.3 / 0.9327 | 299.4 / 0.9327 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 1088.1 / 0.9911 | 1116.2 / 0.9909 | 1663.6 / 0.9909 |
| ours_scan | ef 200 |  |  | 375.9 / 0.9583 | 409.2 / 0.9582 | 454.6 / 0.9582 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 567.7 / 0.9710 | 594.9 / 0.9712 | 765.7 / 0.9712 |  |  |  |
| ours_walk | ef 100 | 277.9 / 0.9327 | 303.4 / 0.9327 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 1165.6 / 0.9911 | 1134.9 / 0.9909 | 1684.0 / 0.9909 |
| ours_walk | ef 200 | 368.6 / 0.9462 | 392.8 / 0.9462 | 382.0 / 0.9583 | 417.5 / 0.9582 | 516.2 / 0.9582 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 1726.1 / 0.9935 | 1623.2 / 0.9933 | 2167.9 / 0.9933 |
| ours_walk | ef 400 |  |  | 535.7 / 0.9657 | 649.1 / 0.9657 | 798.9 / 0.9657 | 594.1 / 0.9710 | 598.4 / 0.9712 | 1090.6 / 0.9712 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 889.1 / 0.9800 | 909.3 / 0.9802 | 1428.9 / 0.9802 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 245.2 / 0.2315 | 305.1 / 0.2315 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 298.9 / 0.2315 | 360.8 / 0.2315 | 485.2 / 0.2315 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 268.6 / 0.3199 | 328.4 / 0.3199 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 325.4 / 0.3199 | 384.1 / 0.3199 | 512.0 / 0.3199 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 430.1 / 0.3199 | 491.8 / 0.3199 | 865.8 / 0.3199 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 777.0 / 0.3646 | 833.3 / 0.3646 | 1972.4 / 0.3646 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 471.3 / 0.3945 | 531.6 / 0.3945 | 906.2 / 0.3945 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 839.1 / 0.4493 | 902.5 / 0.4493 | 2039.0 / 0.4493 |
| usearch_b1_rescore | ef 100 | 596.3 / 0.8977 | 660.2 / 0.8977 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 4840.1 / 0.9851 | 4978.5 / 0.9849 | 6038.9 / 0.9849 |
| usearch_b1_rescore | ef 200 | 1081.9 / 0.9332 | 1128.4 / 0.9332 | 1080.7 / 0.9447 | 1155.3 / 0.9447 | 1273.4 / 0.9447 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 9373.7 / 0.9861 | 9561.2 / 0.9861 | 10563.1 / 0.9860 |
| usearch_b1_rescore | ef 400 |  |  | 2022.7 / 0.9579 | 2069.3 / 0.9579 | 2207.3 / 0.9579 | 2015.6 / 0.9642 | 2086.1 / 0.9644 | 2474.5 / 0.9644 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 3803.6 / 0.9755 | 3870.2 / 0.9757 | 4195.9 / 0.9757 |  |  |  |

### csn1m / jina-v2-base-code (n_ho = 2400, exact quality 0.4412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 2690.5 | 6 | 0.9907 | yes / yes | 10.23 [0.21, 12.53] | 3063 | 16408 |
| faiss_bin_flat | 0.99 | 2753.2 | 6 | 0.9976 | yes / yes | 8.96 [0.23, 10.80] | 3063 | 16398 |
| faiss_bin_flat | 0.995 | 2753.2 | 6 | 0.9976 | yes / no | 6.46 [0.28, 7.88] | 3063 | 16398 |
| faiss_bin_hnsw | 0.98 | 309.5 | 6 | 0.9930 | yes / yes | 1.18 [0.02, 1.35] | 3558 | 18001 |
| faiss_bin_hnsw | 0.99 | 510.5 | 6 | 0.9952 | yes / yes | 1.66 [0.04, 1.88] | 3558 | 18063 |
| faiss_bin_hnsw | 0.995 | 714.8 | 6 | 0.9977 | yes / yes | 1.68 [0.08, 1.94] | 3558 | 17988 |
| faiss_exact | 0.98 | 116376.2 | 6 | 1.0000 | yes / yes | 442.49 [9.06, 545.66] | 2970 | 9317 |
| faiss_exact | 0.99 | 116376.2 | 6 | 1.0000 | yes / yes | 378.62 [9.94, 463.39] | 2970 | 9317 |
| faiss_exact | 0.995 | 116376.2 | 6 | 1.0000 | yes / yes | 272.88 [12.21, 339.05] | 2970 | 9317 |
| faiss_hnsw_flat | 0.98 | 409.8 | 6 | 0.9819 | yes / no | 1.56 [0.03, 1.82] | 3232 | 10050 |
| faiss_hnsw_flat | 0.99 | 723.0 | 6 | 0.9932 | yes / no | 2.35 [0.06, 2.74] | 3232 | 10052 |
| faiss_hnsw_flat | 0.995 | 969.5 | 6 | 0.9955 | yes / no | 2.27 [0.10, 2.67] | 3477 | 10855 |
| faiss_hnsw_sq8 | 0.98 | 639.4 | 6 | 0.9819 | yes / no | 2.43 [0.05, 2.67] | 3865 | 18988 |
| faiss_hnsw_sq8 | 0.99 | 1006.9 | 6 | 0.9919 | yes / no | 3.28 [0.09, 3.62] | 4233 | 20162 |
| faiss_hnsw_sq8 | 0.995 | 1414.5 | 6 | 0.9955 | yes / no | 3.32 [0.15, 3.68] | 4233 | 20128 |
| faiss_ivfpq_fs | 0.98 | 2008.4 | 6 | 0.9966 | yes / yes | 7.64 [0.16, 9.19] | 3106 | 16610 |
| faiss_ivfpq_fs | 0.99 | 2513.4 | 6 | 0.9982 | yes / yes | 8.18 [0.22, 9.68] | 3087 | 16479 |
| faiss_ivfpq_fs | 0.995 | 2513.4 | 6 | 0.9982 | yes / no | 5.89 [0.27, 7.08] | 3087 | 16479 |
| faiss_rabitq_flat | 0.98 | 47778.2 | 6 | 0.9978 | yes / yes | 181.66 [3.77, 199.42] | 3101 | 16543 |
| faiss_rabitq_flat | 0.99 | 47778.2 | 6 | 0.9978 | yes / yes | 155.44 [4.14, 171.63] | 3101 | 16543 |
| faiss_rabitq_flat | 0.995 | 47778.2 | 6 | 0.9978 | yes / yes | 112.03 [5.08, 124.20] | 3101 | 16543 |
| faiss_rabitq_hnsw | 0.98 | 587.5 | 6 | 0.9913 | yes / yes | 2.23 [0.05, 2.56] | 3596 | 18141 |
| faiss_rabitq_hnsw | 0.99 | 1023.5 | 6 | 0.9977 | yes / yes | 3.33 [0.09, 3.78] | 3596 | 18107 |
| faiss_rabitq_hnsw | 0.995 | 1106.6 | 6 | 0.9983 | yes / no | 2.59 [0.12, 3.00] | 3596 | 18137 |
| faiss_rabitq_ivf | 0.98 | 9126.5 | 6 | 0.9964 | yes / yes | 34.70 [0.72, 38.04] | 3090 | 16523 |
| faiss_rabitq_ivf | 0.99 | 13643.4 | 6 | 0.9982 | yes / yes | 44.39 [1.18, 48.98] | 3081 | 16564 |
| faiss_rabitq_ivf | 0.995 | 13643.4 | 6 | 0.9982 | yes / no | 31.99 [1.45, 35.45] | 3081 | 16564 |
| hnswlib_f32 | 0.98 | 1240.4 | 6 | 0.9813 | yes / no | 4.72 [0.10, 5.23] | 3580 | 10443 |
| hnswlib_f32 | 0.99 | 2078.1 | 6 | 0.9951 | yes / yes | 6.76 [0.18, 7.53] | 3580 | 10418 |
| hnswlib_f32 | 0.995 | 2963.9 | 6 | 0.9964 | yes / no | 6.95 [0.31, 7.81] | 3580 | 10467 |
| ours_cascade | 0.98 | 263.0 | 6 | 0.9927 | yes / yes |  | 3897 | 3281 |
| ours_cascade | 0.99 | 307.4 | 6 | 0.9954 | yes / yes |  | 3898 | 3315 |
| ours_cascade | 0.995 | 426.5 | 6 | 0.9977 | yes / yes |  | 3898 | 3418 |
| scann | 0.98 | 955.7 | 6 | 0.9888 | yes / yes | 3.63 [0.08, 4.06] | 3386 | 15466 |
| scann | 0.99 | 955.7 | 6 | 0.9888 | no / no | 3.11 [0.08, 3.47] | 3386 | 15466 |
| scann | 0.995 | 2698.3 | 6 | 0.9979 | yes / no | 6.33 [0.29, 7.07] | 3387 | 15362 |
| usearch_b1_rescore | 0.98 | 386.1 | 6 | 0.9810 | yes / no | 1.47 [0.03, 1.69] | 3406 | 17346 |
| usearch_b1_rescore | 0.99 | 589.2 | 6 | 0.9882 | no / no | 1.92 [0.05, 2.21] | 3406 | 17342 |
| usearch_b1_rescore | 0.995 | 1286.2 | 6 | 0.9972 | yes / no | 3.02 [0.13, 3.45] | 3406 | 17359 |
| usearch_f16 | 0.98 | 914.0 | 6 | 0.9859 | yes / yes | 3.48 [0.07, 4.03] | 2111 | 7894 |
| usearch_f16 | 0.99 | 1259.2 | 6 | 0.9877 | no / no | 4.10 [0.11, 4.77] | 2111 | 7914 |
| usearch_f16 | 0.995 | 2597.5 | 6 | 0.9971 | yes / no | 6.09 [0.27, 7.12] | 1865 | 7161 |
| usearch_i8 | 0.98 | 834.8 | 6 | 0.9878 | yes / yes | 3.17 [0.06, 3.69] | 1129 | 4024 |
| usearch_i8 | 0.99 | 1727.1 | 6 | 0.9893 | no / no | 5.62 [0.15, 6.60] | 1129 | 4032 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 2828.2 / 0.9972 | 2852.8 / 0.9972 | 2868.6 / 0.9982 | 2966.3 / 0.9982 | 3052.7 / 0.9982 | 3006.1 / 0.9998 | 2967.6 / 0.9998 | 3512.1 / 0.9998 | 3327.6 / 1.0000 | 3410.8 / 1.0000 | 4535.5 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 366.2 / 0.9883 | 425.4 / 0.9883 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3233.5 / 1.0000 | 3308.8 / 1.0000 | 4402.5 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 609.5 / 0.9926 | 666.0 / 0.9926 | 640.1 / 0.9946 | 698.2 / 0.9946 | 825.1 / 0.9946 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 7279.1 / 1.0000 | 7382.6 / 1.0000 | 8420.4 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 1135.9 / 0.9982 | 1203.7 / 0.9982 | 1325.7 / 0.9982 | 1226.9 / 0.9998 | 1273.9 / 0.9998 | 1645.0 / 0.9998 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2368.6 / 0.9998 | 2408.9 / 0.9998 | 2775.1 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1168.6 / 0.9967 | 1212.2 / 0.9967 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 9040.0 / 1.0000 | 9179.9 / 1.0000 | 10198.9 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 2080.7 / 0.9989 | 2089.6 / 0.9989 | 2074.0 / 0.9989 | 2115.7 / 0.9989 | 2266.8 / 0.9989 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 17842.1 / 1.0000 | 18073.9 / 1.0000 | 18907.5 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 3747.3 / 1.0000 | 3807.7 / 1.0000 | 3948.1 / 1.0000 | 3904.2 / 1.0000 | 3855.8 / 1.0000 | 4232.9 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 7101.9 / 1.0000 | 7145.7 / 1.0000 | 7596.5 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 49214.5 / 1.0000 | 49283.0 / 1.0000 | 49256.8 / 1.0000 | 49322.2 / 1.0000 | 49453.2 / 1.0000 | 49336.4 / 1.0000 | 49408.1 / 1.0000 | 49768.6 / 1.0000 | 49674.9 / 1.0000 | 49732.9 / 1.0000 | 50812.5 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 229.3 / 0.5727 | 292.4 / 0.5727 | 259.8 / 0.5727 | 320.6 / 0.5727 | 443.6 / 0.5727 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 2 | 290.8 / 0.7199 | 352.3 / 0.7199 | 323.7 / 0.7199 | 384.0 / 0.7199 | 508.8 / 0.7199 | 384.6 / 0.7199 | 444.6 / 0.7199 | 833.7 / 0.7199 |  |  |  |
| faiss_rabitq_ivf | nprobe 3 |  |  |  |  |  |  |  |  | 627.5 / 0.7876 | 699.3 / 0.7876 | 1828.7 / 0.7876 |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 508.5 / 0.8236 | 571.8 / 0.8236 | 958.5 / 0.8236 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  |  |  |  |  |  |  | 828.2 / 0.8709 | 901.8 / 0.8708 | 2009.9 / 0.8708 |
| hnswlib_f32 | ef 100 | 2960.5 / 0.9975 | 2984.5 / 0.9975 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 20744.0 / 1.0000 | 20884.5 / 1.0000 | 21894.7 / 1.0000 |
| hnswlib_f32 | ef 200 | 5259.3 / 0.9988 | 5264.3 / 0.9988 | 5262.2 / 0.9988 | 5274.6 / 0.9988 | 5417.0 / 0.9988 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 37060.5 / 1.0000 | 37487.1 / 1.0000 | 38327.2 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 9343.7 / 1.0000 | 9488.9 / 1.0000 | 9548.5 / 1.0000 | 9491.9 / 1.0000 | 9473.2 / 1.0000 | 9837.6 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 16898.1 / 1.0000 | 16917.8 / 1.0000 | 17549.2 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 189.1 / 0.9927 | 217.5 / 0.9927 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 722.5 / 0.9999 | 754.9 / 0.9999 | 1265.3 / 0.9999 |
| ours_scan | ef 200 |  |  | 264.0 / 0.9960 | 293.4 / 0.9960 | 348.8 / 0.9960 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 398.4 / 0.9989 | 417.9 / 0.9989 | 596.3 / 0.9989 |  |  |  |
| ours_walk | ef 100 | 199.9 / 0.9927 | 220.4 / 0.9927 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 787.4 / 0.9999 | 767.4 / 0.9999 | 1316.1 / 0.9999 |
| ours_walk | ef 200 | 267.7 / 0.9946 | 289.0 / 0.9946 | 280.8 / 0.9960 | 378.5 / 0.9960 | 382.4 / 0.9960 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 1114.2 / 0.9999 | 1128.8 / 0.9999 | 1695.1 / 0.9999 |
| ours_walk | ef 400 |  |  | 381.1 / 0.9972 | 923.6 / 0.9972 | 820.6 / 0.9972 | 404.4 / 0.9989 | 428.7 / 0.9989 | 627.6 / 0.9989 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 591.0 / 0.9988 | 614.7 / 0.9988 | 801.1 / 0.9988 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 244.2 / 0.5662 | 306.9 / 0.5662 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 296.7 / 0.5662 | 361.1 / 0.5662 | 485.4 / 0.5662 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 100 | 267.2 / 0.7001 | 329.3 / 0.7001 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 322.7 / 0.7001 | 386.2 / 0.7001 | 511.1 / 0.7001 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 427.7 / 0.7001 | 491.7 / 0.7001 | 878.6 / 0.7001 |  |  |  |
| scann | leaves_to_search 3, reorder 1000 |  |  |  |  |  |  |  |  | 767.6 / 0.7603 | 843.0 / 0.7603 | 1977.8 / 0.7603 |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 466.9 / 0.7999 | 526.0 / 0.7998 | 919.6 / 0.7998 |  |  |  |
| scann | leaves_to_search 6, reorder 1000 |  |  |  |  |  |  |  |  | 829.8 / 0.8455 | 898.0 / 0.8455 | 2036.6 / 0.8455 |
| usearch_b1_rescore | ef 100 | 535.9 / 0.9845 | 590.5 / 0.9845 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 4092.4 / 0.9983 | 4187.1 / 0.9983 | 5243.9 / 0.9983 |
| usearch_b1_rescore | ef 200 | 924.0 / 0.9911 | 972.6 / 0.9911 | 930.5 / 0.9939 | 989.3 / 0.9939 | 1118.2 / 0.9939 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 7919.1 / 0.9981 | 8017.7 / 0.9981 | 9130.0 / 0.9981 |
| usearch_b1_rescore | ef 400 |  |  | 1680.7 / 0.9955 | 1758.1 / 0.9955 | 1875.7 / 0.9955 | 1721.3 / 0.9972 | 1767.1 / 0.9972 | 2146.1 / 0.9972 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 3152.4 / 0.9981 | 3215.6 / 0.9981 | 3695.0 / 0.9981 |  |  |  |

### d20k / CodeRankEmbed (n_ho = 2400, exact quality 0.8271)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 65.4 | 6 | 0.9872 | yes / no | 0.48 [0.48, 0.51] | 117 | 337 |
| faiss_bin_flat | 0.99 | 86.1 | 6 | 0.9927 | yes / no | 0.64 [0.62, 0.67] | 117 | 338 |
| faiss_bin_flat | 0.995 | 86.1 | 6 | 0.9927 | no / no | 0.53 [0.51, 0.55] | 117 | 338 |
| faiss_bin_hnsw | 0.98 | 205.5 | 6 | 0.9829 | yes / no | 1.52 [1.41, 1.63] | 117 | 369 |
| faiss_bin_hnsw | 0.99 | 271.3 | 6 | 0.9937 | yes / no | 2.00 [1.88, 2.16] | 117 | 369 |
| faiss_bin_hnsw | 0.995 | 372.4 | 6 | 0.9962 | yes / no | 2.28 [2.11, 2.40] | 117 | 352 |
| faiss_exact | 0.98 | 2410.5 | 6 | 1.0000 | yes / yes | 17.80 [16.59, 18.98] | 86 | 199 |
| faiss_exact | 0.99 | 2410.5 | 6 | 1.0000 | yes / yes | 17.80 [16.59, 18.98] | 86 | 199 |
| faiss_exact | 0.995 | 2410.5 | 6 | 1.0000 | yes / yes | 14.78 [13.75, 15.69] | 86 | 199 |
| faiss_hnsw_flat | 0.98 | 310.5 | 6 | 0.9892 | yes / yes | 2.29 [2.02, 2.46] | 89 | 208 |
| faiss_hnsw_flat | 0.99 | 566.3 | 6 | 0.9952 | yes / yes | 4.18 [3.71, 4.46] | 89 | 207 |
| faiss_hnsw_flat | 0.995 | 740.8 | 6 | 0.9990 | yes / yes | 4.54 [4.03, 4.84] | 91 | 217 |
| faiss_hnsw_sq8 | 0.98 | 498.9 | 6 | 0.9907 | yes / yes | 3.68 [3.47, 3.90] | 118 | 392 |
| faiss_hnsw_sq8 | 0.99 | 867.9 | 6 | 0.9952 | yes / yes | 6.41 [6.01, 6.77] | 118 | 391 |
| faiss_hnsw_sq8 | 0.995 | 1143.4 | 6 | 0.9990 | yes / yes | 7.01 [6.53, 7.38] | 118 | 399 |
| faiss_ivfpq_fs | 0.98 | 317.8 | 6 | 1.0000 | yes / yes | 2.35 [2.27, 2.49] | 118 | 354 |
| faiss_ivfpq_fs | 0.99 | 317.8 | 6 | 1.0000 | yes / yes | 2.35 [2.27, 2.49] | 118 | 354 |
| faiss_ivfpq_fs | 0.995 | 317.8 | 6 | 1.0000 | yes / yes | 1.95 [1.87, 2.05] | 118 | 354 |
| faiss_rabitq_flat | 0.98 | 982.4 | 6 | 0.9998 | yes / yes | 7.26 [7.22, 7.69] | 117 | 341 |
| faiss_rabitq_flat | 0.99 | 982.4 | 6 | 0.9998 | yes / yes | 7.26 [7.22, 7.69] | 117 | 341 |
| faiss_rabitq_flat | 0.995 | 982.4 | 6 | 0.9998 | yes / yes | 6.02 [5.86, 6.31] | 117 | 341 |
| faiss_rabitq_hnsw | 0.98 | 257.1 | 6 | 0.9917 | yes / yes | 1.90 [1.72, 2.01] | 117 | 376 |
| faiss_rabitq_hnsw | 0.99 | 404.9 | 6 | 0.9981 | yes / yes | 2.99 [2.77, 3.17] | 117 | 376 |
| faiss_rabitq_hnsw | 0.995 | 677.2 | 6 | 0.9991 | yes / yes | 4.15 [3.92, 4.39] | 117 | 376 |
| faiss_rabitq_ivf | 0.98 | 1635.1 | 6 | 0.9912 | yes / yes | 12.08 [11.73, 12.75] | 117 | 353 |
| faiss_rabitq_ivf | 0.99 | 1685.9 | 6 | 1.0000 | yes / yes | 12.45 [12.32, 13.18] | 117 | 351 |
| faiss_rabitq_ivf | 0.995 | 1685.9 | 6 | 1.0000 | yes / yes | 10.34 [10.03, 10.84] | 117 | 351 |
| hnswlib_f32 | 0.98 | 897.6 | 6 | 0.9851 | yes / no | 6.63 [6.38, 7.02] | 92 | 189 |
| hnswlib_f32 | 0.99 | 2302.6 | 6 | 1.0002 | yes / yes | 17.01 [16.43, 17.99] | 95 | 200 |
| hnswlib_f32 | 0.995 | 2760.0 | 6 | 0.9982 | yes / yes | 16.92 [16.31, 17.76] | 92 | 194 |
| ours_cascade | 0.98 | 135.4 | 6 | 0.9902 | yes / yes |  | 194 | 113 |
| ours_cascade | 0.99 | 135.4 | 6 | 0.9902 | yes / no |  | 194 | 113 |
| ours_cascade | 0.995 | 163.1 | 6 | 0.9941 | no / no |  | 186 | 183 |
| scann | 0.98 | 342.4 | 6 | 1.0000 | yes / yes | 2.53 [2.49, 2.68] | 129 | 358 |
| scann | 0.99 | 342.4 | 6 | 1.0000 | yes / yes | 2.53 [2.49, 2.68] | 129 | 358 |
| scann | 0.995 | 342.4 | 6 | 1.0000 | yes / yes | 2.10 [2.03, 2.21] | 129 | 358 |
| usearch_b1_rescore | 0.98 | 236.2 | 6 | 0.9822 | yes / no | 1.74 [1.54, 1.85] | 121 | 347 |
| usearch_b1_rescore | 0.99 | 285.5 | 6 | 0.9919 | yes / no | 2.11 [1.91, 2.24] | 124 | 355 |
| usearch_b1_rescore | 0.995 | 412.6 | 6 | 0.9931 | no / no | 2.53 [2.31, 2.67] | 129 | 375 |
| usearch_f16 | 0.98 | 679.1 | 6 | 0.9894 | yes / yes | 5.02 [4.39, 5.34] | 63 | 153 |
| usearch_f16 | 0.99 | 914.2 | 6 | 0.9902 | yes / no | 6.75 [5.85, 7.18] | 69 | 175 |
| usearch_f16 | 0.995 | 1580.3 | 6 | 0.9955 | yes / no | 9.69 [8.54, 10.22] | 69 | 175 |
| usearch_i8 | 0.98 | 337.4 | 6 | 0.9877 | yes / yes | 2.49 [1.86, 2.70] | 49 | 90 |
| usearch_i8 | 0.99 | 367.4 | 6 | 0.9921 | yes / no | 2.71 [1.99, 2.93] | 54 | 110 |
| usearch_i8 | 0.995 | 1157.6 | 6 | 0.9961 | yes / no | 7.10 [4.98, 7.52] | 54 | 111 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 134.4 / 0.9946 | 188.9 / 0.9946 | 170.1 / 0.9973 | 224.5 / 0.9973 | 333.9 / 0.9973 | 242.5 / 0.9978 | 297.5 / 0.9978 | 626.4 / 0.9978 | 450.9 / 0.9995 | 505.5 / 0.9994 | 1492.0 / 0.9993 |
| faiss_bin_hnsw | ef 100 | 183.7 / 0.9872 | 245.8 / 0.9872 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1771.0 / 0.9995 | 1850.1 / 0.9994 | 2963.0 / 0.9993 |
| faiss_bin_hnsw | ef 200 | 286.9 / 0.9920 | 342.3 / 0.9920 | 321.3 / 0.9945 | 374.7 / 0.9945 | 497.6 / 0.9945 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4463.1 / 0.9995 | 4562.1 / 0.9994 | 5697.0 / 0.9993 |
| faiss_bin_hnsw | ef 400 |  |  | 548.5 / 0.9975 | 608.3 / 0.9975 | 724.0 / 0.9975 | 621.9 / 0.9984 | 675.7 / 0.9983 | 1043.8 / 0.9983 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1209.0 / 0.9978 | 1263.8 / 0.9978 | 1639.7 / 0.9978 |  |  |  |
| faiss_hnsw_flat | ef 100 | 695.9 / 0.9978 | 750.3 / 0.9978 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4361.6 / 1.0001 | 4446.9 / 1.0000 | 5454.1 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1177.7 / 0.9996 | 1214.3 / 0.9995 | 1203.4 / 0.9996 | 1257.6 / 0.9995 | 1379.1 / 0.9995 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 8176.8 / 1.0001 | 8263.2 / 1.0000 | 9252.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2029.2 / 1.0001 | 2093.2 / 1.0000 | 2204.9 / 1.0000 | 2086.1 / 1.0001 | 2138.1 / 1.0000 | 2490.8 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3532.3 / 1.0001 | 3588.8 / 1.0000 | 3921.2 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1078.9 / 0.9999 | 1133.6 / 0.9999 | 1111.8 / 1.0001 | 1167.6 / 1.0000 | 1274.5 / 1.0000 | 1173.4 / 1.0001 | 1227.4 / 1.0000 | 1553.8 / 1.0000 | 1341.9 / 1.0001 | 1397.6 / 1.0000 | 2379.6 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 237.0 / 0.8142 | 291.0 / 0.8142 | 398.7 / 0.8142 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 383.0 / 0.8766 | 441.2 / 0.8766 | 765.4 / 0.8766 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 578.4 / 0.8989 | 637.0 / 0.8989 | 1614.6 / 0.8989 |
| faiss_rabitq_ivf | nprobe 3 | 128.8 / 0.6302 | 181.7 / 0.6302 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 863.2 / 0.9526 | 919.2 / 0.9526 | 1904.0 / 0.9526 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 172.5 / 0.7165 | 226.8 / 0.7165 | 334.2 / 0.7165 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 165.4 / 0.7436 | 218.8 / 0.7436 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 267.7 / 0.7978 | 324.4 / 0.7978 | 646.3 / 0.7978 |  |  |  |
| hnswlib_f32 | ef 100 | 1986.0 / 1.0001 | 2034.8 / 1.0000 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 8875.3 / 1.0001 | 8988.9 / 1.0000 | 9985.9 / 1.0000 |
| hnswlib_f32 | ef 200 | 3281.1 / 1.0004 | 3330.9 / 1.0003 | 3303.6 / 1.0005 | 3355.7 / 1.0003 | 3474.3 / 1.0003 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 11936.0 / 1.0001 | 11998.4 / 1.0000 | 12998.0 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 5238.8 / 1.0001 | 5303.3 / 1.0000 | 5398.8 / 1.0000 | 5272.3 / 1.0001 | 5346.4 / 1.0000 | 5671.1 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 7833.4 / 1.0001 | 7905.5 / 1.0000 | 8228.2 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 99.9 / 0.9941 | 119.6 / 0.9941 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 204.9 / 0.9989 | 229.3 / 0.9989 | 656.1 / 0.9988 |
| ours_scan | ef 200 |  |  | 112.1 / 0.9973 | 133.7 / 0.9973 | 176.8 / 0.9973 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 136.1 / 0.9979 | 158.3 / 0.9979 | 294.0 / 0.9979 |  |  |  |
| ours_walk | ef 100 | 118.2 / 0.9920 | 145.5 / 0.9920 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 324.4 / 0.9995 | 354.1 / 0.9994 | 836.4 / 0.9993 |
| ours_walk | ef 200 | 138.9 / 0.9931 | 163.7 / 0.9931 | 152.9 / 0.9967 | 181.0 / 0.9967 | 234.7 / 0.9967 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 378.6 / 0.9995 | 409.7 / 0.9994 | 889.1 / 0.9993 |
| ours_walk | ef 400 |  |  | 180.8 / 0.9973 | 212.3 / 0.9973 | 263.7 / 0.9973 | 208.0 / 0.9978 | 240.7 / 0.9978 | 405.4 / 0.9978 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 238.2 / 0.9978 | 271.4 / 0.9978 | 441.2 / 0.9978 |  |  |  |
| scann | reorder 100 | 402.5 / 1.0001 | 457.3 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 812.2 / 1.0001 | 864.5 / 1.0000 | 1887.7 / 1.0000 |
| scann | reorder 200 |  |  | 452.4 / 1.0001 | 508.1 / 1.0000 | 616.6 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 543.2 / 1.0001 | 598.2 / 1.0000 | 934.5 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 197.3 / 0.9834 | 255.8 / 0.9834 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1175.3 / 0.9972 | 1262.1 / 0.9971 | 2515.3 / 0.9971 |
| usearch_b1_rescore | ef 200 | 303.0 / 0.9901 | 359.5 / 0.9901 | 317.6 / 0.9919 | 379.1 / 0.9919 | 503.4 / 0.9919 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2188.6 / 0.9972 | 2257.8 / 0.9971 | 3519.1 / 0.9971 |
| usearch_b1_rescore | ef 400 |  |  | 507.2 / 0.9950 | 567.3 / 0.9950 | 693.7 / 0.9950 | 538.4 / 0.9956 | 605.0 / 0.9957 | 979.4 / 0.9956 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 910.8 / 0.9961 | 974.9 / 0.9961 | 1345.3 / 0.9961 |  |  |  |

### d20k / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.6987)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 155.5 | 6 | 0.9932 | yes / yes | 0.69 [0.66, 0.74] | 117 | 338 |
| faiss_bin_flat | 0.99 | 306.3 | 6 | 0.9965 | yes / yes | 1.14 [1.08, 1.22] | 117 | 340 |
| faiss_bin_flat | 0.995 | 306.3 | 6 | 0.9965 | yes / no | 0.99 [0.93, 1.05] | 117 | 340 |
| faiss_bin_hnsw | 0.98 | 622.2 | 6 | 0.9893 | yes / yes | 2.76 [2.57, 2.97] | 117 | 356 |
| faiss_bin_hnsw | 0.99 | 822.1 | 6 | 0.9965 | yes / yes | 3.05 [2.85, 3.29] | 117 | 355 |
| faiss_bin_hnsw | 0.995 | 1668.9 | 6 | 0.9963 | yes / no | 5.38 [5.11, 5.72] | 117 | 360 |
| faiss_exact | 0.98 | 2429.5 | 6 | 1.0000 | yes / yes | 10.77 [10.01, 11.68] | 87 | 203 |
| faiss_exact | 0.99 | 2429.5 | 6 | 1.0000 | yes / yes | 9.01 [8.38, 9.82] | 87 | 203 |
| faiss_exact | 0.995 | 2429.5 | 6 | 1.0000 | yes / yes | 7.83 [7.26, 8.41] | 87 | 203 |
| faiss_hnsw_flat | 0.98 | 483.1 | 6 | 0.9873 | yes / yes | 2.14 [1.91, 2.31] | 90 | 209 |
| faiss_hnsw_flat | 0.99 | 900.8 | 6 | 0.9954 | yes / yes | 3.34 [3.03, 3.60] | 90 | 211 |
| faiss_hnsw_flat | 0.995 | 1092.7 | 6 | 0.9978 | yes / yes | 3.52 [3.16, 3.75] | 92 | 218 |
| faiss_hnsw_sq8 | 0.98 | 808.2 | 6 | 0.9867 | yes / no | 3.58 [3.38, 3.85] | 118 | 393 |
| faiss_hnsw_sq8 | 0.99 | 1368.0 | 6 | 0.9953 | yes / yes | 5.07 [4.77, 5.45] | 118 | 393 |
| faiss_hnsw_sq8 | 0.995 | 1368.0 | 6 | 0.9953 | yes / no | 4.41 [4.15, 4.68] | 118 | 393 |
| faiss_ivfpq_fs | 0.98 | 446.8 | 6 | 1.0000 | yes / yes | 1.98 [1.85, 2.13] | 118 | 356 |
| faiss_ivfpq_fs | 0.99 | 446.8 | 6 | 1.0000 | yes / yes | 1.66 [1.55, 1.79] | 118 | 356 |
| faiss_ivfpq_fs | 0.995 | 446.8 | 6 | 1.0000 | yes / yes | 1.44 [1.34, 1.53] | 118 | 356 |
| faiss_rabitq_flat | 0.98 | 1022.5 | 6 | 0.9999 | yes / yes | 4.53 [4.40, 4.87] | 117 | 346 |
| faiss_rabitq_flat | 0.99 | 1022.5 | 6 | 0.9999 | yes / yes | 3.79 [3.68, 4.09] | 117 | 346 |
| faiss_rabitq_flat | 0.995 | 1022.5 | 6 | 0.9999 | yes / yes | 3.30 [3.19, 3.49] | 117 | 346 |
| faiss_rabitq_hnsw | 0.98 | 679.6 | 6 | 0.9899 | yes / yes | 3.01 [2.80, 3.26] | 117 | 378 |
| faiss_rabitq_hnsw | 0.99 | 1175.1 | 6 | 0.9977 | yes / yes | 4.36 [4.02, 4.70] | 117 | 381 |
| faiss_rabitq_hnsw | 0.995 | 1175.1 | 6 | 0.9977 | yes / yes | 3.79 [3.49, 4.04] | 117 | 381 |
| faiss_rabitq_ivf | 0.98 | 1814.7 | 6 | 0.9881 | yes / no | 8.05 [7.70, 8.65] | 117 | 359 |
| faiss_rabitq_ivf | 0.99 | 1846.4 | 6 | 1.0000 | yes / yes | 6.85 [6.62, 7.38] | 117 | 354 |
| faiss_rabitq_ivf | 0.995 | 1846.4 | 6 | 1.0000 | yes / yes | 5.95 [5.74, 6.31] | 117 | 354 |
| hnswlib_f32 | 0.98 | 1599.2 | 6 | 0.9928 | yes / yes | 7.09 [6.78, 7.63] | 96 | 202 |
| hnswlib_f32 | 0.99 | 2269.8 | 6 | 0.9954 | yes / yes | 8.42 [8.11, 9.07] | 94 | 196 |
| hnswlib_f32 | 0.995 | 2737.3 | 6 | 0.9982 | yes / yes | 8.83 [8.48, 9.36] | 96 | 202 |
| ours_cascade | 0.98 | 225.5 | 6 | 0.9885 | yes / yes |  | 203 | 244 |
| ours_cascade | 0.99 | 269.6 | 6 | 0.9934 | yes / no |  | 195 | 362 |
| ours_cascade | 0.995 | 310.1 | 6 | 0.9980 | yes / no |  | 187 | 524 |
| scann | 0.98 | 431.0 | 6 | 1.0000 | yes / yes | 1.91 [1.84, 2.07] | 129 | 357 |
| scann | 0.99 | 431.0 | 6 | 1.0000 | yes / yes | 1.60 [1.54, 1.72] | 129 | 357 |
| scann | 0.995 | 431.0 | 6 | 1.0000 | yes / yes | 1.39 [1.34, 1.48] | 129 | 357 |
| usearch_b1_rescore | 0.98 | 589.5 | 6 | 0.9888 | yes / yes | 2.61 [2.31, 2.86] | 121 | 351 |
| usearch_b1_rescore | 0.99 | 669.3 | 6 | 0.9921 | yes / no | 2.48 [2.23, 2.69] | 124 | 360 |
| usearch_b1_rescore | 0.995 | 2550.8 | 6 | 0.9987 | yes / yes | 8.23 [6.92, 8.72] | 124 | 361 |
| usearch_f16 | 0.98 | 878.9 | 6 | 0.9935 | yes / yes | 3.90 [3.56, 4.19] | 65 | 157 |
| usearch_f16 | 0.99 | 1532.0 | 6 | 0.9954 | yes / yes | 5.68 [5.19, 6.14] | 65 | 157 |
| usearch_f16 | 0.995 | 2599.5 | 6 | 0.9991 | yes / yes | 8.38 [7.57, 8.93] | 65 | 159 |
| usearch_i8 | 0.98 | 478.9 | 6 | 0.9852 | yes / no | 2.12 [1.58, 2.29] | 55 | 112 |
| usearch_i8 | 0.99 | 858.3 | 6 | 0.9935 | yes / no | 3.18 [2.41, 3.46] | 55 | 112 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 133.9 / 0.9842 | 188.5 / 0.9842 | 168.3 / 0.9932 | 223.1 / 0.9932 | 331.5 / 0.9932 | 238.5 / 0.9960 | 292.3 / 0.9962 | 619.8 / 0.9962 | 438.6 / 0.9990 | 492.7 / 0.9993 | 1485.5 / 0.9993 |
| faiss_bin_hnsw | ef 100 | 175.5 / 0.9524 | 236.6 / 0.9525 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1714.9 / 0.9985 | 1759.3 / 0.9988 | 2848.1 / 0.9988 |
| faiss_bin_hnsw | ef 200 | 268.2 / 0.9745 | 324.6 / 0.9746 | 300.5 / 0.9806 | 358.0 / 0.9806 | 476.4 / 0.9806 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4376.8 / 0.9984 | 4401.6 / 0.9987 | 5506.5 / 0.9987 |
| faiss_bin_hnsw | ef 400 |  |  | 512.6 / 0.9901 | 571.9 / 0.9901 | 687.8 / 0.9901 | 580.3 / 0.9925 | 637.5 / 0.9928 | 997.9 / 0.9928 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1139.5 / 0.9958 | 1199.4 / 0.9960 | 1558.9 / 0.9960 |  |  |  |
| faiss_hnsw_flat | ef 100 | 561.4 / 0.9904 | 618.4 / 0.9906 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3906.4 / 0.9998 | 3928.6 / 0.9998 | 4913.4 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 959.2 / 0.9973 | 1007.8 / 0.9975 | 978.2 / 0.9973 | 1027.7 / 0.9975 | 1154.5 / 0.9975 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 7636.9 / 0.9998 | 7663.1 / 0.9998 | 8731.0 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1682.3 / 0.9986 | 1748.9 / 0.9988 | 1857.2 / 0.9988 | 1747.1 / 0.9986 | 1804.6 / 0.9986 | 2142.8 / 0.9988 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3056.8 / 0.9992 | 3114.6 / 0.9992 | 3453.8 / 0.9994 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1079.2 / 0.9997 | 1132.6 / 0.9999 | 1109.7 / 0.9998 | 1164.0 / 1.0000 | 1272.5 / 1.0000 | 1168.5 / 0.9998 | 1222.4 / 1.0000 | 1548.2 / 1.0000 | 1332.4 / 0.9998 | 1386.1 / 0.9999 | 2369.5 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 231.4 / 0.6233 | 285.9 / 0.6232 | 393.8 / 0.6232 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 380.7 / 0.7293 | 433.8 / 0.7293 | 762.8 / 0.7293 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 574.1 / 0.7688 | 626.6 / 0.7687 | 1607.5 / 0.7687 |
| faiss_rabitq_ivf | nprobe 3 | 123.8 / 0.4051 | 176.6 / 0.4050 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 861.3 / 0.8904 | 914.8 / 0.8902 | 1900.4 / 0.8902 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 167.0 / 0.4866 | 220.7 / 0.4866 | 328.4 / 0.4866 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 161.4 / 0.5113 | 213.7 / 0.5113 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 260.3 / 0.6011 | 314.1 / 0.6011 | 642.7 / 0.6011 |  |  |  |
| hnswlib_f32 | ef 100 | 1383.5 / 0.9867 | 1439.0 / 0.9868 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 7171.5 / 0.9998 | 7213.1 / 0.9998 | 8240.0 / 1.0000 |
| hnswlib_f32 | ef 200 | 2337.3 / 0.9970 | 2386.0 / 0.9973 | 2363.2 / 0.9970 | 2406.1 / 0.9973 | 2518.6 / 0.9973 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 10213.7 / 0.9998 | 10285.2 / 0.9998 | 11313.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 3894.4 / 0.9989 | 3951.6 / 0.9991 | 4065.8 / 0.9991 | 3931.9 / 0.9989 | 3995.2 / 0.9989 | 4323.4 / 0.9991 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 6171.2 / 0.9992 | 6233.3 / 0.9992 | 6557.4 / 0.9994 |  |  |  |
| ours_scan | ef 100 | 99.6 / 0.9816 | 119.4 / 0.9817 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 202.9 / 0.9990 | 224.9 / 0.9993 | 666.3 / 0.9993 |
| ours_scan | ef 200 |  |  | 111.8 / 0.9916 | 133.6 / 0.9916 | 177.2 / 0.9916 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 135.4 / 0.9954 | 158.6 / 0.9957 | 293.5 / 0.9957 |  |  |  |
| ours_walk | ef 100 | 113.6 / 0.9678 | 138.4 / 0.9678 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 310.8 / 0.9976 | 333.4 / 0.9978 | 838.1 / 0.9978 |
| ours_walk | ef 200 | 128.9 / 0.9759 | 157.9 / 0.9760 | 142.1 / 0.9858 | 166.9 / 0.9858 | 226.0 / 0.9858 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 364.6 / 0.9989 | 393.4 / 0.9992 | 907.6 / 0.9992 |
| ours_walk | ef 400 |  |  | 168.0 / 0.9885 | 197.7 / 0.9885 | 251.8 / 0.9885 | 195.3 / 0.9912 | 221.7 / 0.9915 | 392.5 / 0.9915 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 225.0 / 0.9940 | 256.1 / 0.9943 | 419.4 / 0.9943 |  |  |  |
| scann | reorder 100 | 400.7 / 0.9998 | 454.4 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 794.5 / 0.9998 | 853.1 / 0.9998 | 1880.0 / 1.0000 |
| scann | reorder 200 |  |  | 449.5 / 0.9997 | 505.0 / 1.0000 | 614.2 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 537.9 / 0.9998 | 595.0 / 1.0000 | 927.9 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 186.2 / 0.9459 | 246.8 / 0.9459 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1132.3 / 0.9978 | 1181.8 / 0.9980 | 2385.0 / 0.9980 |
| usearch_b1_rescore | ef 200 | 278.1 / 0.9674 | 334.1 / 0.9674 | 295.1 / 0.9749 | 352.0 / 0.9749 | 478.9 / 0.9749 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 2038.9 / 0.9978 | 2125.8 / 0.9981 | 3395.3 / 0.9981 |
| usearch_b1_rescore | ef 400 |  |  | 465.2 / 0.9880 | 528.3 / 0.9880 | 651.6 / 0.9880 | 498.0 / 0.9898 | 562.3 / 0.9901 | 952.2 / 0.9901 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 842.5 / 0.9937 | 899.7 / 0.9940 | 1281.3 / 0.9940 |  |  |  |

### d20k / jina-v2-base-code (n_ho = 2400, exact quality 0.8010)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 62.7 | 6 | 0.9986 | yes / yes | 0.48 [0.47, 0.48] | 117 | 339 |
| faiss_bin_flat | 0.99 | 62.7 | 6 | 0.9986 | yes / yes | 0.48 [0.47, 0.48] | 117 | 339 |
| faiss_bin_flat | 0.995 | 62.7 | 6 | 0.9986 | yes / yes | 0.48 [0.47, 0.48] | 117 | 339 |
| faiss_bin_hnsw | 0.98 | 127.1 | 6 | 0.9881 | yes / yes | 0.96 [0.89, 1.00] | 117 | 354 |
| faiss_bin_hnsw | 0.99 | 141.5 | 6 | 0.9921 | yes / no | 1.07 [0.99, 1.11] | 117 | 371 |
| faiss_bin_hnsw | 0.995 | 156.4 | 6 | 0.9975 | yes / no | 1.19 [1.09, 1.23] | 117 | 357 |
| faiss_exact | 0.98 | 2435.1 | 6 | 1.0000 | yes / yes | 18.49 [17.23, 19.16] | 85 | 201 |
| faiss_exact | 0.99 | 2435.1 | 6 | 1.0000 | yes / yes | 18.49 [17.23, 19.16] | 85 | 201 |
| faiss_exact | 0.995 | 2435.1 | 6 | 1.0000 | yes / yes | 18.49 [17.23, 19.16] | 85 | 201 |
| faiss_hnsw_flat | 0.98 | 140.5 | 6 | 0.9852 | yes / no | 1.07 [0.94, 1.12] | 89 | 209 |
| faiss_hnsw_flat | 0.99 | 216.2 | 6 | 0.9970 | yes / yes | 1.64 [1.48, 1.72] | 91 | 218 |
| faiss_hnsw_flat | 0.995 | 245.2 | 6 | 0.9973 | yes / no | 1.86 [1.66, 1.96] | 96 | 235 |
| faiss_hnsw_sq8 | 0.98 | 235.2 | 6 | 0.9822 | yes / no | 1.79 [1.70, 1.82] | 118 | 405 |
| faiss_hnsw_sq8 | 0.99 | 359.8 | 6 | 0.9969 | yes / yes | 2.73 [2.61, 2.79] | 118 | 402 |
| faiss_hnsw_sq8 | 0.995 | 404.8 | 6 | 0.9972 | yes / no | 3.07 [2.91, 3.15] | 118 | 422 |
| faiss_ivfpq_fs | 0.98 | 204.9 | 6 | 0.9876 | yes / yes | 1.56 [1.47, 1.59] | 118 | 359 |
| faiss_ivfpq_fs | 0.99 | 318.2 | 6 | 0.9999 | yes / yes | 2.42 [2.34, 2.47] | 118 | 353 |
| faiss_ivfpq_fs | 0.995 | 318.2 | 6 | 0.9999 | yes / yes | 2.42 [2.34, 2.47] | 118 | 353 |
| faiss_rabitq_flat | 0.98 | 980.3 | 6 | 1.0000 | yes / yes | 7.44 [7.28, 7.57] | 117 | 348 |
| faiss_rabitq_flat | 0.99 | 980.3 | 6 | 1.0000 | yes / yes | 7.44 [7.28, 7.57] | 117 | 348 |
| faiss_rabitq_flat | 0.995 | 980.3 | 6 | 1.0000 | yes / yes | 7.44 [7.28, 7.57] | 117 | 348 |
| faiss_rabitq_hnsw | 0.98 | 119.8 | 6 | 0.9893 | yes / yes | 0.91 [0.85, 0.95] | 117 | 376 |
| faiss_rabitq_hnsw | 0.99 | 149.2 | 6 | 0.9940 | yes / no | 1.13 [1.06, 1.19] | 117 | 378 |
| faiss_rabitq_hnsw | 0.995 | 214.7 | 6 | 0.9982 | yes / yes | 1.63 [1.51, 1.72] | 117 | 378 |
| faiss_rabitq_ivf | 0.98 | 816.5 | 6 | 0.9877 | yes / yes | 6.20 [6.06, 6.32] | 117 | 357 |
| faiss_rabitq_ivf | 0.99 | 1607.6 | 6 | 0.9964 | yes / yes | 12.21 [11.87, 12.45] | 117 | 356 |
| faiss_rabitq_ivf | 0.995 | 1607.6 | 6 | 0.9964 | yes / no | 12.21 [11.87, 12.45] | 117 | 356 |
| hnswlib_f32 | 0.98 | 467.2 | 6 | 0.9865 | yes / yes | 3.55 [3.43, 3.62] | 92 | 191 |
| hnswlib_f32 | 0.99 | 700.1 | 6 | 0.9946 | yes / yes | 5.32 [5.14, 5.43] | 95 | 200 |
| hnswlib_f32 | 0.995 | 771.3 | 6 | 0.9967 | yes / no | 5.86 [5.66, 5.98] | 100 | 215 |
| ours_cascade | 0.98 | 131.7 | 6 | 0.9988 | yes / yes |  | 193 | 106 |
| ours_cascade | 0.99 | 131.7 | 6 | 0.9988 | yes / yes |  | 193 | 106 |
| ours_cascade | 0.995 | 131.7 | 6 | 0.9988 | yes / yes |  | 193 | 106 |
| scann | 0.98 | 335.9 | 6 | 1.0000 | yes / yes | 2.55 [2.49, 2.60] | 129 | 357 |
| scann | 0.99 | 335.9 | 6 | 1.0000 | yes / yes | 2.55 [2.49, 2.60] | 129 | 357 |
| scann | 0.995 | 335.9 | 6 | 1.0000 | yes / yes | 2.55 [2.49, 2.60] | 129 | 357 |
| usearch_b1_rescore | 0.98 | 186.2 | 6 | 0.9948 | yes / yes | 1.41 [1.24, 1.48] | 121 | 351 |
| usearch_b1_rescore | 0.99 | 186.2 | 6 | 0.9948 | yes / yes | 1.41 [1.24, 1.48] | 121 | 351 |
| usearch_b1_rescore | 0.995 | 188.6 | 6 | 0.9969 | yes / no | 1.43 [1.27, 1.53] | 121 | 350 |
| usearch_f16 | 0.98 | 238.9 | 6 | 0.9892 | yes / yes | 1.81 [1.63, 1.88] | 61 | 145 |
| usearch_f16 | 0.99 | 342.8 | 6 | 0.9943 | yes / yes | 2.60 [2.38, 2.70] | 63 | 154 |
| usearch_f16 | 0.995 | 579.3 | 6 | 0.9970 | yes / no | 4.40 [3.98, 4.53] | 63 | 155 |
| usearch_i8 | 0.98 | 132.8 | 6 | 0.9902 | yes / yes | 1.01 [0.81, 1.08] | 54 | 113 |
| usearch_i8 | 0.99 | 212.1 | 6 | 0.9963 | yes / yes | 1.61 [1.24, 1.70] | 46 | 81 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 134.5 / 0.9999 | 188.0 / 0.9999 | 169.7 / 0.9998 | 224.3 / 0.9998 | 333.1 / 0.9998 | 241.6 / 0.9998 | 296.3 / 0.9998 | 624.2 / 0.9998 | 446.6 / 0.9998 | 501.3 / 0.9998 | 1486.2 / 0.9998 |
| faiss_bin_hnsw | ef 100 | 173.2 / 0.9997 | 233.7 / 0.9997 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1714.9 / 0.9998 | 1770.7 / 0.9998 | 2852.4 / 0.9998 |
| faiss_bin_hnsw | ef 200 | 265.3 / 0.9996 | 319.3 / 0.9996 | 297.2 / 0.9995 | 354.7 / 0.9995 | 470.2 / 0.9995 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 4405.5 / 0.9998 | 4448.2 / 0.9998 | 5521.1 / 0.9998 |
| faiss_bin_hnsw | ef 400 |  |  | 505.6 / 0.9998 | 564.7 / 0.9998 | 683.7 / 0.9998 | 572.5 / 0.9998 | 640.9 / 0.9998 | 990.0 / 0.9998 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1134.5 / 0.9998 | 1198.0 / 0.9998 | 1574.7 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 100 | 618.3 / 0.9995 | 676.3 / 0.9995 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4050.1 / 1.0000 | 4098.9 / 1.0000 | 5129.6 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1026.7 / 1.0000 | 1076.6 / 1.0000 | 1056.0 / 1.0000 | 1109.8 / 1.0000 | 1231.1 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 7894.4 / 1.0000 | 7938.6 / 1.0000 | 8975.0 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1790.3 / 1.0000 | 1848.8 / 1.0000 | 1990.5 / 1.0000 | 1843.3 / 1.0000 | 1936.4 / 1.0000 | 2259.5 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3212.3 / 1.0000 | 3260.7 / 1.0000 | 3646.4 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 1080.1 / 1.0000 | 1133.4 / 1.0000 | 1110.4 / 1.0000 | 1165.1 / 1.0000 | 1272.7 / 1.0000 | 1171.8 / 1.0000 | 1226.1 / 1.0000 | 1550.2 / 1.0000 | 1336.2 / 1.0000 | 1391.8 / 1.0000 | 2371.2 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  | 227.1 / 0.8846 | 280.1 / 0.8846 | 388.1 / 0.8847 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  | 369.5 / 0.9353 | 423.6 / 0.9353 | 753.5 / 0.9353 |  |  |  |
| faiss_rabitq_ivf | nprobe 22 |  |  |  |  |  |  |  |  | 560.4 / 0.9475 | 615.8 / 0.9475 | 1595.7 / 0.9475 |
| faiss_rabitq_ivf | nprobe 3 | 123.8 / 0.7322 | 175.8 / 0.7322 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 44 |  |  |  |  |  |  |  |  | 841.9 / 0.9780 | 899.1 / 0.9780 | 1878.9 / 0.9780 |
| faiss_rabitq_ivf | nprobe 5 |  |  | 166.5 / 0.8079 | 219.6 / 0.8079 | 326.8 / 0.8079 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 6 | 160.1 / 0.8284 | 210.7 / 0.8284 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  | 255.4 / 0.8711 | 309.5 / 0.8711 | 635.9 / 0.8711 |  |  |  |
| hnswlib_f32 | ef 100 | 1732.2 / 0.9994 | 1785.8 / 0.9994 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 8009.9 / 1.0000 | 8059.8 / 1.0000 | 9087.4 / 1.0000 |
| hnswlib_f32 | ef 200 | 2845.1 / 1.0000 | 2903.0 / 1.0000 | 2867.1 / 1.0000 | 2931.2 / 1.0000 | 3039.9 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 11091.3 / 1.0000 | 11141.0 / 1.0000 | 12196.3 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 4564.5 / 1.0000 | 4620.0 / 1.0000 | 4750.7 / 1.0000 | 4605.4 / 1.0000 | 4667.2 / 1.0000 | 5004.4 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 6988.4 / 1.0000 | 7041.4 / 1.0000 | 7390.0 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 99.3 / 0.9999 | 118.4 / 0.9999 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 205.5 / 0.9998 | 228.9 / 0.9998 | 664.2 / 0.9998 |
| ours_scan | ef 200 |  |  | 111.5 / 0.9998 | 132.3 / 0.9998 | 177.7 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 135.8 / 0.9998 | 158.2 / 0.9998 | 295.1 / 0.9998 |  |  |  |
| ours_walk | ef 100 | 103.8 / 0.9990 | 128.8 / 0.9990 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 306.6 / 0.9998 | 342.4 / 0.9998 | 825.4 / 0.9998 |
| ours_walk | ef 200 | 122.4 / 0.9993 | 147.0 / 0.9993 | 134.3 / 0.9993 | 164.0 / 0.9993 | 216.3 / 0.9993 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 362.4 / 0.9998 | 395.1 / 0.9998 | 906.8 / 0.9998 |
| ours_walk | ef 400 |  |  | 159.1 / 0.9993 | 185.5 / 0.9993 | 245.2 / 0.9993 | 185.1 / 0.9993 | 220.1 / 0.9993 | 381.9 / 0.9993 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 217.8 / 0.9993 | 247.3 / 0.9993 | 410.3 / 0.9993 |  |  |  |
| scann | reorder 100 | 401.6 / 1.0000 | 456.8 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 802.1 / 1.0000 | 864.9 / 1.0000 | 1881.9 / 1.0000 |
| scann | reorder 200 |  |  | 451.1 / 1.0000 | 505.0 / 1.0000 | 616.0 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 541.3 / 1.0000 | 598.1 / 1.0000 | 930.6 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 179.1 / 0.9968 | 238.5 / 0.9968 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1077.1 / 0.9973 | 1126.6 / 0.9973 | 2364.2 / 0.9973 |
| usearch_b1_rescore | ef 200 | 264.2 / 0.9971 | 324.8 / 0.9971 | 280.5 / 0.9971 | 341.7 / 0.9971 | 462.3 / 0.9971 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1988.5 / 0.9973 | 2075.6 / 0.9973 | 3359.1 / 0.9973 |
| usearch_b1_rescore | ef 400 |  |  | 460.4 / 0.9974 | 523.6 / 0.9974 | 646.6 / 0.9974 | 489.7 / 0.9973 | 557.4 / 0.9973 | 938.2 / 0.9973 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 804.5 / 0.9973 | 868.1 / 0.9973 | 1261.7 / 0.9973 |  |  |  |

### dall / CodeRankEmbed (n_ho = 2400, exact quality 0.7906)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 339.5 | 6 | 0.9868 | yes / no | 0.88 [0.72, 1.01] | 470 | 2278 |
| faiss_bin_flat | 0.99 | 395.9 | 6 | 0.9944 | yes / no | 0.87 [0.73, 1.07] | 470 | 2283 |
| faiss_bin_flat | 0.995 | 495.4 | 6 | 0.9973 | yes / no | 1.03 [0.86, 1.32] | 470 | 2289 |
| faiss_bin_hnsw | 0.98 | 716.1 | 6 | 0.9828 | yes / no | 1.85 [1.41, 2.19] | 539 | 2514 |
| faiss_bin_hnsw | 0.99 | 1396.1 | 6 | 0.9918 | yes / no | 3.08 [2.45, 3.68] | 505 | 2412 |
| faiss_bin_hnsw | 0.995 | 2786.5 | 6 | 0.9965 | yes / no | 5.82 [4.79, 7.06] | 505 | 2403 |
| faiss_exact | 0.98 | 17455.9 | 6 | 1.0000 | yes / yes | 45.16 [38.12, 52.30] | 438 | 1310 |
| faiss_exact | 0.99 | 17455.9 | 6 | 1.0000 | yes / yes | 38.47 [32.66, 45.76] | 438 | 1310 |
| faiss_exact | 0.995 | 17455.9 | 6 | 1.0000 | yes / yes | 36.45 [31.15, 44.71] | 438 | 1310 |
| faiss_hnsw_flat | 0.98 | 1371.6 | 6 | 0.9906 | yes / yes | 3.55 [3.06, 4.08] | 458 | 1369 |
| faiss_hnsw_flat | 0.99 | 1838.7 | 6 | 0.9937 | yes / no | 4.05 [3.45, 4.80] | 475 | 1418 |
| faiss_hnsw_flat | 0.995 | 3495.1 | 6 | 0.9993 | yes / yes | 7.30 [6.33, 8.85] | 475 | 1426 |
| faiss_hnsw_sq8 | 0.98 | 1893.2 | 6 | 0.9891 | yes / yes | 4.90 [4.32, 5.59] | 573 | 2655 |
| faiss_hnsw_sq8 | 0.99 | 2545.7 | 6 | 0.9943 | yes / no | 5.61 [4.90, 6.59] | 608 | 2709 |
| faiss_hnsw_sq8 | 0.995 | 4728.8 | 6 | 0.9991 | yes / yes | 9.87 [8.79, 11.92] | 608 | 2707 |
| faiss_ivfpq_fs | 0.98 | 1443.8 | 6 | 0.9938 | yes / yes | 3.74 [3.12, 4.40] | 471 | 2327 |
| faiss_ivfpq_fs | 0.99 | 1571.4 | 6 | 0.9998 | yes / yes | 3.46 [2.87, 4.25] | 471 | 2316 |
| faiss_ivfpq_fs | 0.995 | 1571.4 | 6 | 0.9998 | yes / yes | 3.28 [2.73, 4.15] | 471 | 2316 |
| faiss_rabitq_flat | 0.98 | 6700.4 | 6 | 0.9988 | yes / yes | 17.34 [15.58, 19.88] | 470 | 2305 |
| faiss_rabitq_flat | 0.99 | 6700.4 | 6 | 0.9988 | yes / yes | 14.76 [13.19, 17.44] | 470 | 2305 |
| faiss_rabitq_flat | 0.995 | 6700.4 | 6 | 0.9988 | yes / yes | 13.99 [12.72, 16.98] | 470 | 2305 |
| faiss_rabitq_hnsw | 0.98 | 931.0 | 6 | 0.9843 | yes / no | 2.41 [1.84, 2.76] | 539 | 2534 |
| faiss_rabitq_hnsw | 0.99 | 1555.3 | 6 | 0.9931 | yes / no | 3.43 [2.54, 4.04] | 539 | 2535 |
| faiss_rabitq_hnsw | 0.995 | 2717.2 | 6 | 0.9990 | yes / yes | 5.67 [4.22, 6.89] | 539 | 2527 |
| faiss_rabitq_ivf | 0.98 | 7038.3 | 6 | 0.9938 | yes / yes | 18.21 [16.28, 20.87] | 470 | 2330 |
| faiss_rabitq_ivf | 0.99 | 8534.2 | 6 | 1.0000 | yes / yes | 18.81 [16.80, 22.21] | 470 | 2318 |
| faiss_rabitq_ivf | 0.995 | 8534.2 | 6 | 1.0000 | yes / yes | 17.82 [16.20, 21.62] | 470 | 2318 |
| hnswlib_f32 | 0.98 | 3381.7 | 6 | 0.9902 | yes / yes | 8.75 [7.75, 10.04] | 525 | 1467 |
| hnswlib_f32 | 0.99 | 5145.4 | 6 | 0.9980 | yes / yes | 11.34 [9.95, 13.39] | 491 | 1372 |
| hnswlib_f32 | 0.995 | 9206.1 | 6 | 0.9986 | yes / yes | 19.22 [17.13, 23.36] | 491 | 1379 |
| ours_cascade | 0.98 | 386.5 | 6 | 0.9852 | yes / no |  | 548 | 265 |
| ours_cascade | 0.99 | 453.8 | 6 | 0.9952 | yes / yes |  | 549 | 347 |
| ours_cascade | 0.995 | 479.0 | 6 | 0.9971 | yes / no |  | 549 | 409 |
| scann | 0.98 | 2190.0 | 6 | 1.0000 | yes / yes | 5.67 [5.05, 6.51] | 506 | 1824 |
| scann | 0.99 | 2190.0 | 6 | 1.0000 | yes / yes | 4.83 [4.31, 5.70] | 506 | 1824 |
| scann | 0.995 | 2190.0 | 6 | 1.0000 | yes / yes | 4.57 [4.08, 5.56] | 506 | 1824 |
| usearch_b1_rescore | 0.98 | 1674.2 | 6 | 0.9838 | yes / no | 4.33 [2.93, 5.26] | 521 | 2453 |
| usearch_b1_rescore | 0.99 | 2310.0 | 6 | 0.9893 | no / no | 5.09 [3.46, 6.44] | 555 | 2595 |
| usearch_b1_rescore | 0.995 | 3414.6 | 6 | 0.9940 | no / no | 7.13 [5.03, 9.11] | 521 | 2459 |
| usearch_f16 | 0.98 | 3407.3 | 6 | 0.9910 | yes / yes | 8.82 [7.14, 10.70] | 283 | 1044 |
| usearch_f16 | 0.99 | 4445.9 | 6 | 0.9935 | yes / no | 9.80 [7.90, 12.09] | 265 | 976 |
| usearch_f16 | 0.995 | 6912.0 | 6 | 0.9971 | yes / no | 14.43 [11.36, 18.42] | 318 | 1197 |
| usearch_i8 | 0.98 | 1929.1 | 6 | 0.9917 | yes / yes | 4.99 [3.87, 6.18] | 180 | 561 |
| usearch_i8 | 0.99 | 1929.1 | 6 | 0.9917 | yes / no | 4.25 [3.29, 5.41] | 180 | 561 |
| usearch_i8 | 0.995 | 3577.2 | 6 | 0.9937 | no / no | 7.47 [5.86, 9.81] | 180 | 567 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 409.2 / 0.9934 | 466.0 / 0.9934 | 454.0 / 0.9958 | 509.2 / 0.9958 | 633.0 / 0.9958 | 559.5 / 0.9982 | 617.1 / 0.9982 | 976.2 / 0.9981 | 861.4 / 0.9995 | 942.0 / 0.9994 | 1946.4 / 0.9994 |
| faiss_bin_hnsw | ef 100 | 297.1 / 0.9456 | 353.2 / 0.9456 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2778.6 / 0.9985 | 2848.8 / 0.9984 | 3875.4 / 0.9984 |
| faiss_bin_hnsw | ef 200 | 492.0 / 0.9707 | 546.9 / 0.9707 | 518.9 / 0.9734 | 575.0 / 0.9734 | 695.2 / 0.9734 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 6361.8 / 0.9992 | 6503.4 / 0.9992 | 7452.4 / 0.9991 |
| faiss_bin_hnsw | ef 400 |  |  | 939.8 / 0.9849 | 996.9 / 0.9849 | 1116.6 / 0.9849 | 1016.5 / 0.9876 | 1079.4 / 0.9876 | 1430.0 / 0.9876 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1989.6 / 0.9969 | 2046.1 / 0.9969 | 2404.1 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 868.0 / 0.9828 | 923.8 / 0.9828 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 6796.4 / 0.9992 | 6896.7 / 0.9995 | 8003.5 / 0.9995 |
| faiss_hnsw_flat | ef 200 | 1523.5 / 0.9914 | 1591.5 / 0.9913 | 1551.7 / 0.9914 | 1610.0 / 0.9913 | 1721.1 / 0.9913 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 13332.3 / 0.9997 | 13629.3 / 1.0001 | 14499.9 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2825.6 / 0.9979 | 2888.8 / 0.9978 | 2993.3 / 0.9978 | 2898.4 / 0.9978 | 2947.7 / 0.9979 | 3326.3 / 0.9978 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 5356.0 / 0.9991 | 5427.7 / 0.9994 | 5815.8 / 0.9993 |  |  |  |
| faiss_rabitq_flat | exhaustive | 6972.2 / 1.0001 | 7026.1 / 1.0001 | 7012.4 / 1.0001 | 7068.6 / 1.0001 | 7173.9 / 1.0001 | 7093.7 / 1.0000 | 7148.8 / 1.0001 | 7476.3 / 1.0000 | 7320.3 / 0.9997 | 7377.4 / 1.0001 | 8361.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 128.0 / 0.3543 | 181.3 / 0.3543 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 778.8 / 0.7749 | 841.9 / 0.7749 | 1828.6 / 0.7749 |
| faiss_rabitq_ivf | nprobe 2 | 154.5 / 0.4667 | 205.9 / 0.4667 | 172.8 / 0.4667 | 227.8 / 0.4667 | 334.9 / 0.4667 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 221.3 / 0.5694 | 276.9 / 0.5694 | 384.2 / 0.5694 | 262.5 / 0.5694 | 318.7 / 0.5694 | 648.3 / 0.5694 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 366.9 / 0.6688 | 422.1 / 0.6689 | 751.5 / 0.6689 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 539.1 / 0.6870 | 597.6 / 0.6870 | 1583.1 / 0.6870 |
| hnswlib_f32 | ef 100 | 2416.7 / 0.9824 | 2479.9 / 0.9824 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 16122.5 / 0.9992 | 16332.3 / 0.9996 | 17317.0 / 0.9995 |
| hnswlib_f32 | ef 200 | 4254.0 / 0.9959 | 4306.0 / 0.9958 | 4273.1 / 0.9959 | 4318.6 / 0.9958 | 4426.9 / 0.9958 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 27224.2 / 0.9991 | 27500.4 / 0.9995 | 28315.4 / 0.9995 |
| hnswlib_f32 | ef 400 |  |  | 7607.3 / 0.9986 | 7684.2 / 0.9986 | 7749.6 / 0.9985 | 7635.7 / 0.9985 | 7674.2 / 0.9986 | 8061.5 / 0.9985 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 13400.1 / 0.9992 | 13503.8 / 0.9993 | 13885.2 / 0.9992 |  |  |  |
| ours_scan | ef 100 | 341.2 / 0.9932 | 369.1 / 0.9932 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 470.9 / 0.9990 | 535.2 / 0.9989 | 1025.3 / 0.9989 |
| ours_scan | ef 200 |  |  | 348.3 / 0.9952 | 381.1 / 0.9952 | 437.6 / 0.9952 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 381.1 / 0.9981 | 413.0 / 0.9981 | 593.0 / 0.9981 |  |  |  |
| ours_walk | ef 100 | 270.0 / 0.9769 | 292.9 / 0.9769 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 975.8 / 0.9966 | 1012.7 / 0.9965 | 1497.1 / 0.9964 |
| ours_walk | ef 200 | 358.1 / 0.9823 | 389.2 / 0.9823 | 366.1 / 0.9846 | 391.2 / 0.9846 | 451.2 / 0.9846 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 1275.3 / 0.9992 | 1320.4 / 0.9991 | 1830.9 / 0.9991 |
| ours_walk | ef 400 |  |  | 509.2 / 0.9896 | 537.4 / 0.9896 | 593.5 / 0.9896 | 534.3 / 0.9927 | 578.1 / 0.9927 | 750.2 / 0.9927 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 769.4 / 0.9948 | 817.4 / 0.9948 | 992.1 / 0.9948 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 163.9 / 0.1222 | 218.3 / 0.1222 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 665.3 / 0.3873 | 735.0 / 0.3873 | 1744.5 / 0.3873 |
| scann | leaves_to_search 2, reorder 100 | 178.1 / 0.1680 | 231.5 / 0.1680 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 214.3 / 0.1680 | 270.4 / 0.1680 | 379.4 / 0.1680 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 236.0 / 0.2342 | 293.7 / 0.2342 | 403.1 / 0.2342 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 313.2 / 0.2342 | 371.2 / 0.2342 | 703.4 / 0.2342 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 585.6 / 0.3020 | 655.9 / 0.3020 | 1656.1 / 0.3020 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 347.2 / 0.3020 | 407.6 / 0.3020 | 744.7 / 0.3020 |  |  |  |
| usearch_b1_rescore | ef 100 | 425.9 / 0.9338 | 484.5 / 0.9338 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 3336.6 / 0.9957 | 3491.2 / 0.9956 | 4583.1 / 0.9956 |
| usearch_b1_rescore | ef 200 | 728.0 / 0.9664 | 810.2 / 0.9664 | 756.8 / 0.9677 | 810.3 / 0.9677 | 944.5 / 0.9677 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 6370.0 / 0.9981 | 6570.6 / 0.9979 | 7617.5 / 0.9979 |
| usearch_b1_rescore | ef 400 |  |  | 1363.4 / 0.9821 | 1433.3 / 0.9821 | 1558.5 / 0.9821 | 1390.6 / 0.9842 | 1467.8 / 0.9842 | 1857.0 / 0.9842 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2591.2 / 0.9944 | 2680.7 / 0.9944 | 3058.9 / 0.9944 |  |  |  |

### dall / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.6332)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 753.3 | 6 | 0.9900 | yes / yes | 1.52 [1.28, 1.75] | 470 | 2286 |
| faiss_exact | 0.98 | 16722.3 | 6 | 1.0000 | yes / yes | 33.70 [29.78, 39.57] | 438 | 1316 |
| faiss_exact | 0.99 | 16722.3 | 6 | 1.0000 | yes / yes | 27.77 [24.48, 33.11] | 438 | 1316 |
| faiss_exact | 0.995 | 16722.3 | 6 | 1.0000 | yes / yes | 21.73 [19.27, 26.36] | 438 | 1316 |
| faiss_hnsw_flat | 0.98 | 2530.1 | 6 | 0.9909 | yes / yes | 5.10 [4.56, 5.88] | 475 | 1422 |
| faiss_hnsw_flat | 0.99 | 2785.7 | 6 | 0.9907 | yes / no | 4.63 [4.11, 5.43] | 510 | 1533 |
| faiss_hnsw_sq8 | 0.98 | 3500.7 | 6 | 0.9926 | yes / yes | 7.06 [6.37, 8.04] | 608 | 2713 |
| faiss_hnsw_sq8 | 0.99 | 3864.3 | 6 | 0.9907 | yes / no | 6.42 [5.76, 7.48] | 642 | 2822 |
| faiss_hnsw_sq8 | 0.995 | 7236.9 | 6 | 0.9988 | yes / yes | 9.40 [8.56, 11.22] | 642 | 2833 |
| faiss_ivfpq_fs | 0.98 | 1522.2 | 6 | 0.9980 | yes / yes | 3.07 [2.59, 3.64] | 471 | 2327 |
| faiss_ivfpq_fs | 0.99 | 1522.2 | 6 | 0.9980 | yes / yes | 2.53 [2.17, 3.04] | 471 | 2327 |
| faiss_ivfpq_fs | 0.995 | 1765.9 | 6 | 0.9992 | yes / yes | 2.29 [1.97, 2.82] | 471 | 2315 |
| faiss_rabitq_flat | 0.98 | 6702.1 | 6 | 0.9969 | yes / yes | 13.51 [12.41, 15.47] | 470 | 2316 |
| faiss_rabitq_flat | 0.99 | 6702.1 | 6 | 0.9969 | yes / yes | 11.13 [10.18, 13.02] | 470 | 2316 |
| faiss_rabitq_flat | 0.995 | 6725.3 | 6 | 0.9981 | yes / yes | 8.74 [8.05, 10.44] | 470 | 2304 |
| faiss_rabitq_hnsw | 0.98 | 3943.0 | 6 | 0.9923 | yes / yes | 7.95 [6.21, 9.12] | 539 | 2545 |
| faiss_rabitq_ivf | 0.98 | 7063.3 | 6 | 0.9887 | yes / yes | 14.24 [12.99, 16.28] | 470 | 2338 |
| faiss_rabitq_ivf | 0.99 | 8541.5 | 6 | 1.0000 | yes / yes | 14.18 [12.98, 16.58] | 470 | 2331 |
| faiss_rabitq_ivf | 0.995 | 8541.5 | 6 | 1.0000 | yes / yes | 11.10 [10.21, 13.25] | 470 | 2331 |
| hnswlib_f32 | 0.98 | 6240.9 | 6 | 0.9857 | yes / no | 12.58 [11.43, 14.40] | 491 | 1363 |
| hnswlib_f32 | 0.99 | 10955.4 | 6 | 0.9968 | yes / yes | 18.19 [16.39, 21.22] | 491 | 1373 |
| hnswlib_f32 | 0.995 | 11624.1 | 6 | 0.9966 | yes / no | 15.10 [13.72, 18.01] | 525 | 1477 |
| ours_cascade | 0.98 | 496.1 | 6 | 0.9817 | yes / no |  | 551 | 530 |
| ours_cascade | 0.99 | 602.2 | 6 | 0.9948 | yes / no |  | 551 | 901 |
| ours_cascade | 0.995 | 769.6 | 6 | 0.9950 | no / no |  | 552 | 1494 |
| scann | 0.98 | 2190.0 | 6 | 1.0000 | yes / yes | 4.41 [4.00, 5.06] | 506 | 1839 |
| scann | 0.99 | 2190.0 | 6 | 1.0000 | yes / yes | 3.64 [3.32, 4.25] | 506 | 1839 |
| scann | 0.995 | 2190.0 | 6 | 1.0000 | yes / yes | 2.85 [2.58, 3.40] | 506 | 1839 |
| usearch_f16 | 0.98 | 6342.7 | 6 | 0.9939 | yes / yes | 12.78 [10.78, 15.09] | 265 | 978 |
| usearch_f16 | 0.99 | 8276.7 | 6 | 0.9968 | yes / yes | 13.74 [11.21, 16.28] | 318 | 1194 |
| usearch_i8 | 0.98 | 4691.3 | 6 | 0.9879 | yes / yes | 9.46 [7.66, 11.31] | 180 | 570 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 410.6 / 0.9586 | 462.4 / 0.9586 | 448.6 / 0.9716 | 508.9 / 0.9717 | 624.7 / 0.9717 | 553.5 / 0.9855 | 610.0 / 0.9855 | 956.8 / 0.9855 | 856.5 / 0.9946 | 911.7 / 0.9948 | 1936.7 / 0.9948 |
| faiss_bin_hnsw | ef 100 | 258.1 / 0.8086 | 314.8 / 0.8087 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2424.1 / 0.9835 | 2476.9 / 0.9838 | 3486.1 / 0.9837 |
| faiss_bin_hnsw | ef 200 | 416.7 / 0.8824 | 475.9 / 0.8824 | 455.4 / 0.8919 | 502.9 / 0.8919 | 621.2 / 0.8919 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5692.1 / 0.9886 | 5733.4 / 0.9889 | 6744.2 / 0.9888 |
| faiss_bin_hnsw | ef 400 |  |  | 808.6 / 0.9362 | 861.1 / 0.9363 | 972.8 / 0.9363 | 871.8 / 0.9464 | 930.3 / 0.9462 | 1264.9 / 0.9463 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1712.8 / 0.9701 | 1782.9 / 0.9700 | 2102.8 / 0.9701 |  |  |  |
| faiss_hnsw_flat | ef 100 | 666.5 / 0.9282 | 729.3 / 0.9284 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 5272.9 / 0.9987 | 5267.7 / 0.9988 | 6266.3 / 0.9987 |
| faiss_hnsw_flat | ef 200 | 1144.9 / 0.9634 | 1210.8 / 0.9634 | 1179.7 / 0.9633 | 1241.5 / 0.9635 | 1350.2 / 0.9634 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 10672.0 / 0.9987 | 10683.5 / 0.9988 | 11692.2 / 0.9987 |
| faiss_hnsw_flat | ef 400 |  |  | 2144.1 / 0.9866 | 2195.7 / 0.9867 | 2295.7 / 0.9867 | 2179.5 / 0.9864 | 2248.6 / 0.9867 | 2562.0 / 0.9867 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4081.6 / 0.9965 | 4142.3 / 0.9967 | 4408.5 / 0.9966 |  |  |  |
| faiss_rabitq_flat | exhaustive | 6973.6 / 0.9996 | 7023.1 / 0.9996 | 7011.3 / 1.0001 | 7066.1 / 1.0001 | 7172.2 / 1.0000 | 7090.4 / 1.0001 | 7143.1 / 1.0000 | 7468.5 / 1.0000 | 7308.5 / 1.0000 | 7363.7 / 1.0001 | 8348.1 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 128.3 / 0.1445 | 183.2 / 0.1445 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 769.3 / 0.4763 | 818.4 / 0.4766 | 1816.4 / 0.4765 |
| faiss_rabitq_ivf | nprobe 2 | 153.5 / 0.1944 | 206.7 / 0.1944 | 173.6 / 0.1944 | 226.6 / 0.1944 | 335.3 / 0.1944 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 224.2 / 0.2562 | 276.8 / 0.2562 | 386.2 / 0.2562 | 264.4 / 0.2562 | 318.2 / 0.2562 | 644.9 / 0.2562 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 365.1 / 0.3462 | 420.7 / 0.3464 | 746.4 / 0.3464 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 532.5 / 0.3616 | 586.9 / 0.3617 | 1567.4 / 0.3617 |
| hnswlib_f32 | ef 100 | 1711.0 / 0.9036 | 1769.0 / 0.9038 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 11080.8 / 0.9968 | 11062.0 / 0.9969 | 12081.3 / 0.9968 |
| hnswlib_f32 | ef 200 | 2950.3 / 0.9490 | 3003.8 / 0.9491 | 2988.5 / 0.9490 | 3038.2 / 0.9491 | 3144.6 / 0.9491 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 18792.0 / 0.9981 | 18850.1 / 0.9981 | 19907.0 / 0.9980 |
| hnswlib_f32 | ef 400 |  |  | 5209.9 / 0.9790 | 5297.6 / 0.9793 | 5381.2 / 0.9793 | 5242.5 / 0.9790 | 5328.7 / 0.9793 | 5614.2 / 0.9793 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 9113.7 / 0.9946 | 9195.8 / 0.9948 | 9505.9 / 0.9947 |  |  |  |
| ours_scan | ef 100 | 331.9 / 0.9537 | 358.0 / 0.9537 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 470.3 / 0.9946 | 501.9 / 0.9949 | 1014.5 / 0.9948 |
| ours_scan | ef 200 |  |  | 343.6 / 0.9680 | 372.4 / 0.9681 | 430.9 / 0.9681 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 376.4 / 0.9817 | 398.0 / 0.9817 | 586.2 / 0.9817 |  |  |  |
| ours_walk | ef 100 | 222.5 / 0.8783 | 258.6 / 0.8783 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 749.3 / 0.9806 | 787.8 / 0.9808 | 1285.3 / 0.9807 |
| ours_walk | ef 200 | 283.0 / 0.9126 | 317.2 / 0.9126 | 301.6 / 0.9251 | 326.5 / 0.9252 | 388.9 / 0.9252 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 973.1 / 0.9889 | 1010.4 / 0.9893 | 1524.7 / 0.9892 |
| ours_walk | ef 400 |  |  | 407.6 / 0.9412 | 441.1 / 0.9413 | 508.9 / 0.9413 | 435.0 / 0.9517 | 461.2 / 0.9517 | 638.0 / 0.9518 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 607.2 / 0.9690 | 612.5 / 0.9690 | 814.1 / 0.9690 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 162.3 / 0.0704 | 216.4 / 0.0704 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 647.0 / 0.2078 | 701.4 / 0.2077 | 1723.0 / 0.2077 |
| scann | leaves_to_search 2, reorder 100 | 174.9 / 0.0930 | 230.5 / 0.0930 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 214.0 / 0.0930 | 267.9 / 0.0930 | 376.5 / 0.0930 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 235.8 / 0.1126 | 290.2 / 0.1126 | 401.2 / 0.1126 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 305.9 / 0.1126 | 361.9 / 0.1126 | 692.8 / 0.1126 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 568.9 / 0.1481 | 622.7 / 0.1481 | 1628.9 / 0.1481 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 341.4 / 0.1481 | 398.2 / 0.1481 | 733.2 / 0.1481 |  |  |  |
| usearch_b1_rescore | ef 100 | 368.9 / 0.8132 | 435.1 / 0.8132 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2842.6 / 0.9787 | 2846.9 / 0.9790 | 3957.9 / 0.9790 |
| usearch_b1_rescore | ef 200 | 621.6 / 0.8768 | 690.6 / 0.8768 | 656.8 / 0.8899 | 712.0 / 0.8900 | 835.8 / 0.8900 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 5375.9 / 0.9901 | 5414.9 / 0.9904 | 6645.1 / 0.9904 |
| usearch_b1_rescore | ef 400 |  |  | 1154.0 / 0.9306 | 1217.5 / 0.9307 | 1336.3 / 0.9307 | 1180.7 / 0.9427 | 1245.1 / 0.9426 | 1606.5 / 0.9427 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2138.5 / 0.9628 | 2234.2 / 0.9628 | 2629.7 / 0.9628 |  |  |  |

### dall / jina-v2-base-code (n_ho = 2400, exact quality 0.7576)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 287.7 | 6 | 0.9893 | yes / yes | 0.83 [0.77, 0.89] | 470 | 2274 |
| faiss_bin_flat | 0.99 | 300.0 | 6 | 0.9968 | yes / yes | 0.86 [0.80, 0.93] | 470 | 2269 |
| faiss_bin_flat | 0.995 | 300.0 | 6 | 0.9968 | yes / no | 0.80 [0.75, 0.86] | 470 | 2269 |
| faiss_bin_hnsw | 0.98 | 189.6 | 6 | 0.9850 | yes / no | 0.54 [0.46, 0.57] | 539 | 2506 |
| faiss_bin_hnsw | 0.99 | 363.2 | 6 | 0.9929 | yes / no | 1.04 [0.87, 1.09] | 470 | 2341 |
| faiss_bin_hnsw | 0.995 | 437.5 | 6 | 0.9954 | yes / no | 1.17 [0.98, 1.25] | 505 | 2392 |
| faiss_exact | 0.98 | 16201.5 | 6 | 1.0000 | yes / yes | 46.56 [42.24, 49.49] | 438 | 1315 |
| faiss_exact | 0.99 | 16201.5 | 6 | 1.0000 | yes / yes | 46.56 [42.24, 49.49] | 438 | 1315 |
| faiss_exact | 0.995 | 16201.5 | 6 | 1.0000 | yes / yes | 43.43 [39.47, 46.12] | 438 | 1315 |
| faiss_hnsw_flat | 0.98 | 315.6 | 6 | 0.9877 | yes / yes | 0.91 [0.82, 0.96] | 458 | 1357 |
| faiss_hnsw_flat | 0.99 | 407.8 | 6 | 0.9879 | no / no | 1.17 [1.08, 1.25] | 475 | 1416 |
| faiss_hnsw_flat | 0.995 | 848.6 | 6 | 0.9979 | yes / yes | 2.27 [2.08, 2.40] | 509 | 1527 |
| faiss_hnsw_sq8 | 0.98 | 474.4 | 6 | 0.9884 | yes / yes | 1.36 [1.25, 1.42] | 573 | 2636 |
| faiss_hnsw_sq8 | 0.99 | 616.6 | 6 | 0.9872 | no / no | 1.77 [1.64, 1.84] | 608 | 2690 |
| faiss_hnsw_sq8 | 0.995 | 1083.1 | 6 | 0.9975 | yes / no | 2.90 [2.67, 3.01] | 608 | 2691 |
| faiss_ivfpq_fs | 0.98 | 753.3 | 6 | 0.9907 | yes / yes | 2.16 [1.98, 2.33] | 471 | 2310 |
| faiss_ivfpq_fs | 0.99 | 753.3 | 6 | 0.9907 | yes / no | 2.16 [1.98, 2.33] | 471 | 2310 |
| faiss_ivfpq_fs | 0.995 | 1491.9 | 6 | 0.9958 | yes / no | 4.00 [3.58, 4.32] | 471 | 2319 |
| faiss_rabitq_flat | 0.98 | 6695.5 | 6 | 0.9997 | yes / yes | 19.24 [17.88, 19.98] | 470 | 2297 |
| faiss_rabitq_flat | 0.99 | 6695.5 | 6 | 0.9997 | yes / yes | 19.24 [17.88, 19.98] | 470 | 2297 |
| faiss_rabitq_flat | 0.995 | 6695.5 | 6 | 0.9997 | yes / yes | 17.95 [16.68, 18.59] | 470 | 2297 |
| faiss_rabitq_hnsw | 0.98 | 292.0 | 6 | 0.9922 | yes / yes | 0.84 [0.69, 0.90] | 540 | 2524 |
| faiss_rabitq_hnsw | 0.99 | 506.8 | 6 | 0.9968 | yes / yes | 1.46 [1.18, 1.56] | 540 | 2521 |
| faiss_rabitq_hnsw | 0.995 | 921.6 | 6 | 0.9985 | yes / yes | 2.47 [1.98, 2.63] | 540 | 2526 |
| faiss_rabitq_ivf | 0.98 | 4319.5 | 6 | 0.9905 | yes / yes | 12.41 [11.53, 12.88] | 470 | 2313 |
| faiss_rabitq_ivf | 0.99 | 4319.5 | 6 | 0.9905 | yes / no | 12.41 [11.53, 12.88] | 470 | 2313 |
| faiss_rabitq_ivf | 0.995 | 6968.4 | 6 | 0.9957 | yes / no | 18.68 [17.36, 19.35] | 470 | 2319 |
| hnswlib_f32 | 0.98 | 1279.7 | 6 | 0.9909 | yes / yes | 3.68 [3.42, 3.83] | 491 | 1365 |
| hnswlib_f32 | 0.99 | 1560.8 | 6 | 0.9950 | yes / yes | 4.49 [4.16, 4.66] | 474 | 1317 |
| hnswlib_f32 | 0.995 | 2218.6 | 6 | 0.9964 | yes / no | 5.95 [5.51, 6.16] | 491 | 1373 |
| ours_cascade | 0.98 | 348.0 | 6 | 0.9979 | yes / yes |  | 548 | 228 |
| ours_cascade | 0.99 | 348.0 | 6 | 0.9979 | yes / yes |  | 548 | 228 |
| ours_cascade | 0.995 | 373.1 | 6 | 0.9975 | yes / no |  | 548 | 274 |
| scann | 0.98 | 1128.1 | 6 | 0.9908 | yes / yes | 3.24 [3.02, 3.36] | 524 | 2126 |
| scann | 0.99 | 1210.1 | 6 | 0.9987 | yes / yes | 3.48 [3.23, 3.61] | 532 | 2145 |
| scann | 0.995 | 1776.4 | 6 | 0.9997 | yes / yes | 4.76 [4.43, 4.93] | 524 | 2125 |
| usearch_b1_rescore | 0.98 | 308.3 | 6 | 0.9885 | yes / yes | 0.89 [0.65, 0.97] | 521 | 2440 |
| usearch_b1_rescore | 0.99 | 392.8 | 6 | 0.9890 | no / no | 1.13 [0.82, 1.25] | 555 | 2590 |
| usearch_b1_rescore | 0.995 | 672.4 | 6 | 0.9949 | no / no | 1.80 [1.34, 2.01] | 555 | 2587 |
| usearch_f16 | 0.98 | 763.2 | 6 | 0.9894 | yes / yes | 2.19 [1.87, 2.35] | 283 | 1044 |
| usearch_f16 | 0.99 | 1420.9 | 6 | 0.9899 | no / no | 4.08 [3.58, 4.42] | 265 | 968 |
| usearch_f16 | 0.995 | 2560.1 | 6 | 0.9949 | no / no | 6.86 [6.10, 7.57] | 265 | 969 |
| usearch_i8 | 0.98 | 407.9 | 6 | 0.9878 | yes / yes | 1.17 [1.00, 1.30] | 180 | 565 |
| usearch_i8 | 0.99 | 724.8 | 6 | 0.9947 | yes / yes | 2.08 [1.80, 2.32] | 180 | 562 |
| usearch_i8 | 0.995 | 1319.2 | 6 | 0.9970 | yes / no | 3.54 [3.06, 3.98] | 180 | 564 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 378.2 / 0.9979 | 426.8 / 0.9979 | 425.0 / 0.9982 | 495.4 / 0.9982 | 604.8 / 0.9982 | 518.8 / 1.0001 | 597.8 / 1.0001 | 943.0 / 1.0001 | 845.0 / 1.0000 | 903.9 / 1.0000 | 1896.6 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 225.7 / 0.9850 | 288.6 / 0.9850 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2237.3 / 1.0000 | 2281.0 / 1.0000 | 3313.8 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 361.2 / 0.9946 | 429.1 / 0.9946 | 399.6 / 0.9949 | 468.2 / 0.9949 | 576.3 / 0.9949 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5431.3 / 1.0000 | 5449.4 / 1.0000 | 6512.2 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 721.3 / 0.9971 | 790.7 / 0.9971 | 899.6 / 0.9971 | 772.3 / 0.9990 | 845.9 / 0.9990 | 1186.3 / 0.9990 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1548.5 / 1.0001 | 1640.0 / 1.0001 | 1979.9 / 1.0001 |  |  |  |
| faiss_hnsw_flat | ef 100 | 673.6 / 0.9943 | 727.7 / 0.9943 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 5297.5 / 0.9999 | 5250.4 / 1.0000 | 6339.1 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1160.2 / 0.9996 | 1228.0 / 0.9996 | 1201.9 / 0.9995 | 1268.2 / 0.9996 | 1383.8 / 0.9996 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 10747.5 / 0.9999 | 10663.2 / 1.0000 | 11855.1 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2160.6 / 0.9999 | 2234.7 / 1.0000 | 2334.8 / 1.0000 | 2203.5 / 0.9999 | 2268.8 / 1.0000 | 2628.4 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4076.5 / 0.9999 | 4216.1 / 1.0000 | 4523.3 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 6971.2 / 1.0000 | 7020.9 / 1.0000 | 7008.4 / 1.0000 | 7065.7 / 1.0000 | 7171.3 / 1.0000 | 7086.5 / 0.9999 | 7140.0 / 1.0000 | 7465.2 / 1.0000 | 7306.1 / 0.9999 | 7359.1 / 1.0000 | 8337.5 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 125.5 / 0.4295 | 178.2 / 0.4295 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 18 |  |  |  |  |  |  |  |  | 749.6 / 0.8460 | 806.8 / 0.8460 | 1793.6 / 0.8460 |
| faiss_rabitq_ivf | nprobe 2 | 147.8 / 0.5657 | 201.1 / 0.5657 | 167.4 / 0.5657 | 223.8 / 0.5657 | 328.0 / 0.5657 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  | 215.6 / 0.6840 | 269.4 / 0.6840 | 375.4 / 0.6840 | 254.0 / 0.6840 | 310.1 / 0.6840 | 631.8 / 0.6840 |  |  |  |
| faiss_rabitq_ivf | nprobe 8 |  |  |  |  |  | 352.3 / 0.7644 | 408.0 / 0.7644 | 732.8 / 0.7644 |  |  |  |
| faiss_rabitq_ivf | nprobe 9 |  |  |  |  |  |  |  |  | 517.7 / 0.7785 | 571.4 / 0.7785 | 1550.3 / 0.7785 |
| hnswlib_f32 | ef 100 | 1878.7 / 0.9948 | 1940.7 / 0.9948 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 11749.5 / 0.9999 | 11675.6 / 1.0000 | 12816.4 / 1.0000 |
| hnswlib_f32 | ef 200 | 3220.3 / 0.9987 | 3283.5 / 0.9987 | 3263.0 / 0.9987 | 3324.3 / 0.9987 | 3450.7 / 0.9987 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 19816.2 / 0.9999 | 19849.4 / 1.0000 | 21067.6 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 5630.1 / 1.0000 | 5728.7 / 1.0000 | 5798.9 / 1.0000 | 5645.5 / 1.0000 | 5727.7 / 1.0000 | 6077.5 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 9748.2 / 0.9999 | 9848.7 / 1.0000 | 10121.6 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 309.5 / 0.9975 | 333.9 / 0.9975 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 440.9 / 1.0000 | 453.2 / 1.0000 | 948.3 / 1.0000 |
| ours_scan | ef 200 |  |  | 322.4 / 0.9982 | 350.2 / 0.9982 | 397.1 / 0.9982 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 344.2 / 1.0001 | 376.0 / 1.0001 | 537.0 / 1.0001 |  |  |  |
| ours_walk | ef 100 | 168.1 / 0.9949 | 189.6 / 0.9949 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 579.5 / 1.0000 | 611.0 / 1.0000 | 1105.0 / 1.0000 |
| ours_walk | ef 200 | 210.7 / 0.9962 | 233.7 / 0.9962 | 230.7 / 0.9969 | 260.3 / 0.9969 | 311.7 / 0.9969 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 799.5 / 1.0000 | 823.5 / 1.0000 | 1311.9 / 1.0000 |
| ours_walk | ef 400 |  |  | 307.3 / 0.9971 | 335.7 / 0.9971 | 396.7 / 0.9971 | 315.4 / 0.9990 | 367.7 / 0.9990 | 529.0 / 0.9990 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 410.9 / 1.0001 | 492.2 / 1.0001 | 642.1 / 1.0001 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 161.7 / 0.2233 | 216.8 / 0.2233 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 16, reorder 1000 |  |  |  |  |  |  |  |  | 642.5 / 0.6013 | 697.8 / 0.6013 | 1697.4 / 0.6013 |
| scann | leaves_to_search 2, reorder 100 | 175.1 / 0.3165 | 230.0 / 0.3165 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 212.2 / 0.3165 | 269.6 / 0.3165 | 376.5 / 0.3165 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 200 |  |  | 235.5 / 0.3992 | 290.6 / 0.3992 | 399.4 / 0.3992 |  |  |  |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 304.8 / 0.3992 | 365.4 / 0.3992 | 694.5 / 0.3992 |  |  |  |
| scann | leaves_to_search 8, reorder 1000 |  |  |  |  |  |  |  |  | 571.2 / 0.4833 | 625.3 / 0.4833 | 1617.9 / 0.4833 |
| scann | leaves_to_search 8, reorder 400 |  |  |  |  |  | 338.5 / 0.4833 | 398.8 / 0.4833 | 730.2 / 0.4833 |  |  |  |
| usearch_b1_rescore | ef 100 | 303.6 / 0.9884 | 375.6 / 0.9884 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2306.7 / 0.9995 | 2344.3 / 0.9995 | 3507.9 / 0.9995 |
| usearch_b1_rescore | ef 200 | 494.1 / 0.9930 | 568.3 / 0.9930 | 537.7 / 0.9929 | 609.6 / 0.9929 | 737.1 / 0.9929 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 4499.4 / 0.9995 | 4469.7 / 0.9995 | 5758.0 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 974.8 / 0.9972 | 1029.7 / 0.9972 | 1123.2 / 0.9972 | 948.6 / 0.9991 | 1037.1 / 0.9991 | 1430.6 / 0.9991 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1708.9 / 0.9990 | 1868.5 / 0.9990 | 2222.0 / 0.9990 |  |  |  |

### fiqa / CodeRankEmbed (n_ho = 259, exact quality 0.2924)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_exact | 0.98 | 7004.3 | 6 | 1.0000 | yes / yes | 21.80 [19.43, 23.93] | 179 | 547 |
| faiss_exact | 0.99 | 7004.3 | 6 | 1.0000 | yes / yes |  | 179 | 547 |
| faiss_exact | 0.995 | 7004.3 | 6 | 1.0000 | yes / yes |  | 179 | 547 |
| faiss_hnsw_flat | 0.98 | 889.7 | 6 | 0.9507 | no / no | 2.77 [2.52, 3.04] | 195 | 594 |
| faiss_hnsw_flat | 0.99 | 889.7 | 6 | 0.9507 | no / no |  | 195 | 594 |
| faiss_hnsw_flat | 0.995 | 1054.1 | 6 | 0.9552 | no / no |  | 209 | 640 |
| faiss_hnsw_sq8 | 0.98 | 1438.9 | 6 | 0.9552 | no / no | 4.48 [4.10, 4.81] | 251 | 1189 |
| faiss_hnsw_sq8 | 0.99 | 1438.9 | 6 | 0.9552 | no / no |  | 251 | 1189 |
| faiss_hnsw_sq8 | 0.995 | 1438.9 | 6 | 0.9552 | no / no |  | 251 | 1189 |
| faiss_ivfpq_fs | 0.98 | 239.6 | 6 | 0.9440 | no / no | 0.75 [0.68, 0.80] | 188 | 984 |
| faiss_ivfpq_fs | 0.99 | 239.6 | 6 | 0.9440 | no / no |  | 188 | 984 |
| faiss_ivfpq_fs | 0.995 | 389.7 | 6 | 0.9775 | no / no |  | 188 | 980 |
| faiss_rabitq_flat | 0.98 | 2784.4 | 6 | 0.9984 | yes / yes | 8.67 [7.97, 9.29] | 185 | 972 |
| faiss_rabitq_flat | 0.99 | 2784.4 | 6 | 0.9984 | yes / yes |  | 185 | 972 |
| faiss_rabitq_flat | 0.995 | 2784.4 | 6 | 0.9984 | yes / no |  | 185 | 972 |
| faiss_rabitq_hnsw | 0.98 | 550.7 | 6 | 0.9741 | no / no | 1.71 [1.45, 1.84] | 215 | 1068 |
| faiss_rabitq_hnsw | 0.99 | 982.6 | 6 | 0.9676 | no / no |  | 201 | 1022 |
| faiss_rabitq_hnsw | 0.995 | 982.6 | 6 | 0.9676 | no / no |  | 201 | 1022 |
| faiss_rabitq_ivf | 0.98 | 1148.0 | 6 | 0.9401 | no / no | 3.57 [3.28, 3.83] | 187 | 980 |
| faiss_rabitq_ivf | 0.99 | 2116.9 | 6 | 0.9737 | no / no |  | 187 | 978 |
| faiss_rabitq_ivf | 0.995 | 3987.5 | 6 | 1.0000 | yes / yes |  | 187 | 980 |
| hnswlib_f32 | 0.98 | 9234.1 | 6 | 0.9988 | yes / yes | 28.74 [26.19, 30.88] | 195 | 552 |
| hnswlib_f32 | 0.99 | 9234.1 | 6 | 0.9988 | yes / yes |  | 195 | 552 |
| hnswlib_f32 | 0.995 | 9234.1 | 6 | 0.9988 | yes / yes |  | 195 | 552 |
| ours_cascade | 0.98 | 321.3 | 6 | 0.9888 | yes / no |  | 222 | 710 |
| scann | 0.98 | 780.1 | 6 | 1.0000 | yes / yes | 2.43 [2.23, 2.61] | 243 | 753 |
| scann | 0.99 | 780.1 | 6 | 1.0000 | yes / yes |  | 243 | 753 |
| scann | 0.995 | 780.1 | 6 | 1.0000 | yes / yes |  | 243 | 753 |
| usearch_f16 | 0.98 | 2647.0 | 6 | 0.9848 | yes / no | 8.24 [7.03, 8.99] | 116 | 437 |
| usearch_f16 | 0.99 | 2647.0 | 6 | 0.9848 | no / no |  | 116 | 437 |
| usearch_f16 | 0.995 | 2647.0 | 6 | 0.9848 | no / no |  | 116 | 437 |
| usearch_i8 | 0.98 | 1734.8 | 6 | 1.0021 | yes / yes | 5.40 [4.62, 5.88] | 88 | 312 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 214.1 / 0.9321 | 272.6 / 0.9321 | 257.3 / 0.9663 | 316.6 / 0.9701 | 434.6 / 0.9701 | 348.8 / 0.9794 | 408.2 / 0.9819 | 747.5 / 0.9819 | 612.1 / 0.9888 | 663.6 / 0.9878 | 1689.7 / 0.9916 |
| faiss_bin_hnsw | ef 100 | 265.3 / 0.9337 | 334.8 / 0.9337 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2424.0 / 0.9780 | 2476.1 / 0.9769 | 3528.5 / 0.9807 |
| faiss_bin_hnsw | ef 200 | 431.3 / 0.9694 | 489.0 / 0.9694 | 451.3 / 0.9614 | 535.7 / 0.9651 | 637.7 / 0.9651 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5627.0 / 0.9888 | 5656.5 / 0.9878 | 6713.4 / 0.9916 |
| faiss_bin_hnsw | ef 400 |  |  | 803.5 / 0.9753 | 890.8 / 0.9791 | 995.6 / 0.9791 | 897.3 / 0.9751 | 950.4 / 0.9777 | 1314.9 / 0.9777 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1729.5 / 0.9719 | 1806.6 / 0.9745 | 2145.9 / 0.9745 |  |  |  |
| faiss_hnsw_flat | ef 100 | 803.3 / 0.9470 | 873.9 / 0.9507 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 5813.2 / 0.9963 | 5783.8 / 0.9962 | 6824.3 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1382.0 / 0.9585 | 1449.2 / 0.9623 | 1414.4 / 0.9585 | 1490.4 / 0.9623 | 1601.2 / 0.9623 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 11100.4 / 0.9963 | 11071.3 / 0.9962 | 12060.5 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2457.1 / 0.9907 | 2585.5 / 0.9945 | 2638.6 / 0.9945 | 2533.5 / 0.9907 | 2615.5 / 0.9906 | 2923.0 / 0.9945 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4587.7 / 0.9963 | 4644.0 / 0.9962 | 4983.6 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 2927.8 / 0.9962 | 2983.2 / 1.0000 | 2968.8 / 0.9963 | 3023.4 / 1.0000 | 3135.1 / 1.0000 | 3044.8 / 0.9963 | 3096.2 / 1.0000 | 3429.7 / 1.0000 | 3254.8 / 0.9963 | 3311.3 / 0.9962 | 4305.7 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 362.0 / 0.7869 | 414.4 / 0.7869 | 749.4 / 0.7869 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 570.6 / 0.8328 | 625.9 / 0.8368 | 1640.3 / 0.8368 |
| faiss_rabitq_ivf | nprobe 2 | 136.3 / 0.5123 | 191.6 / 0.5099 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 826.9 / 0.8652 | 886.0 / 0.8691 | 1886.6 / 0.8691 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 176.8 / 0.5948 | 233.7 / 0.5940 | 342.7 / 0.5940 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 174.7 / 0.6368 | 229.4 / 0.6368 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 263.8 / 0.6907 | 317.4 / 0.6907 | 652.0 / 0.6907 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 233.9 / 0.7007 | 290.0 / 0.7007 | 399.6 / 0.7007 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 2077.6 / 0.9367 | 2159.1 / 0.9391 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 12399.0 / 0.9963 | 12396.8 / 0.9962 | 13520.1 / 1.0000 |
| hnswlib_f32 | ef 200 | 3608.8 / 0.9739 | 3665.8 / 0.9776 | 3605.9 / 0.9739 | 3703.4 / 0.9776 | 3786.8 / 0.9776 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 19440.4 / 0.9963 | 19735.0 / 0.9962 | 20620.7 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 6171.9 / 0.9964 | 6240.8 / 1.0002 | 6345.1 / 1.0002 | 6267.1 / 0.9964 | 6296.0 / 0.9964 | 6644.7 / 1.0002 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 10501.7 / 0.9963 | 10536.9 / 0.9962 | 10788.4 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 176.3 / 0.9500 | 199.7 / 0.9500 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 301.4 / 0.9888 | 325.8 / 0.9878 | 798.0 / 0.9916 |
| ours_scan | ef 200 |  |  | 188.7 / 0.9698 | 213.4 / 0.9736 | 267.0 / 0.9736 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 219.0 / 0.9890 | 240.5 / 0.9915 | 408.6 / 0.9915 |  |  |  |
| ours_walk | ef 100 | 202.0 / 0.9421 | 229.1 / 0.9407 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 643.1 / 0.9890 | 666.8 / 0.9879 | 1163.2 / 0.9917 |
| ours_walk | ef 200 | 249.2 / 0.9620 | 275.9 / 0.9606 | 265.8 / 0.9746 | 292.9 / 0.9784 | 359.7 / 0.9784 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 808.1 / 0.9890 | 829.3 / 0.9879 | 1295.5 / 0.9917 |
| ours_walk | ef 400 |  |  | 358.8 / 0.9685 | 362.8 / 0.9723 | 466.8 / 0.9723 | 415.3 / 0.9850 | 406.4 / 0.9875 | 601.9 / 0.9875 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 493.3 / 0.9819 | 514.4 / 0.9857 | 698.9 / 0.9857 |  |  |  |
| scann | reorder 100 | 893.5 / 0.9963 | 951.8 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1379.3 / 0.9963 | 1444.6 / 0.9962 | 2484.7 / 1.0000 |
| scann | reorder 200 |  |  | 953.3 / 0.9963 | 1012.9 / 1.0000 | 1120.8 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 1064.3 / 0.9963 | 1121.1 / 0.9962 | 1460.4 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 329.2 / 0.9259 | 389.5 / 0.9259 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2327.5 / 0.9877 | 2318.6 / 0.9875 | 3581.3 / 0.9914 |
| usearch_b1_rescore | ef 200 | 537.9 / 0.9581 | 625.9 / 0.9581 | 570.0 / 0.9541 | 635.5 / 0.9567 | 754.4 / 0.9567 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 4220.1 / 0.9890 | 4321.2 / 0.9879 | 5485.4 / 0.9917 |
| usearch_b1_rescore | ef 400 |  |  | 960.4 / 0.9766 | 1029.0 / 0.9804 | 1181.0 / 0.9804 | 1030.7 / 0.9876 | 1081.5 / 0.9901 | 1482.6 / 0.9901 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1843.4 / 0.9890 | 1833.8 / 0.9916 | 2281.1 / 0.9916 |  |  |  |

### fiqa / bge-base-en-v1.5 (n_ho = 259, exact quality 0.4175)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_exact | 0.98 | 7186.1 | 6 | 1.0000 | yes / yes | 30.70 [30.08, 31.43] | 179 | 548 |
| faiss_exact | 0.99 | 7186.1 | 6 | 1.0000 | yes / yes | 26.05 [25.21, 26.50] | 179 | 548 |
| faiss_exact | 0.995 | 7186.1 | 6 | 1.0000 | yes / yes |  | 179 | 548 |
| faiss_hnsw_flat | 0.98 | 803.5 | 6 | 1.0001 | yes / yes | 3.43 [3.34, 3.51] | 195 | 598 |
| faiss_hnsw_flat | 0.99 | 803.5 | 6 | 1.0001 | yes / yes | 2.91 [2.81, 2.96] | 195 | 598 |
| faiss_hnsw_flat | 0.995 | 803.5 | 6 | 1.0001 | yes / yes |  | 195 | 598 |
| faiss_hnsw_sq8 | 0.98 | 814.5 | 6 | 0.9961 | yes / yes | 3.48 [3.41, 3.55] | 230 | 1126 |
| faiss_hnsw_sq8 | 0.99 | 1640.6 | 6 | 0.9726 | no / no | 5.95 [5.75, 6.02] | 251 | 1187 |
| faiss_hnsw_sq8 | 0.995 | 2612.7 | 6 | 1.0000 | yes / yes |  | 230 | 1125 |
| faiss_ivfpq_fs | 0.98 | 292.7 | 6 | 0.9935 | yes / yes | 1.25 [1.21, 1.28] | 193 | 1000 |
| faiss_ivfpq_fs | 0.99 | 388.8 | 6 | 0.9947 | yes / no | 1.41 [1.31, 1.45] | 193 | 1001 |
| faiss_ivfpq_fs | 0.995 | 480.8 | 6 | 1.0000 | yes / yes |  | 188 | 987 |
| faiss_rabitq_flat | 0.98 | 2783.5 | 6 | 0.9974 | yes / yes | 11.89 [11.65, 12.14] | 185 | 975 |
| faiss_rabitq_flat | 0.99 | 2783.5 | 6 | 0.9974 | yes / yes | 10.09 [9.76, 10.22] | 185 | 975 |
| faiss_rabitq_flat | 0.995 | 2783.5 | 6 | 0.9974 | yes / no |  | 185 | 975 |
| faiss_rabitq_hnsw | 0.98 | 1126.9 | 6 | 1.0007 | yes / yes | 4.81 [4.71, 4.92] | 194 | 1006 |
| faiss_rabitq_hnsw | 0.99 | 1449.4 | 6 | 1.0039 | yes / yes | 5.25 [5.08, 5.33] | 201 | 1030 |
| faiss_rabitq_hnsw | 0.995 | 1962.2 | 6 | 1.0001 | yes / yes |  | 215 | 1078 |
| faiss_rabitq_ivf | 0.98 | 1097.8 | 6 | 0.9946 | yes / yes | 4.69 [4.59, 4.79] | 189 | 993 |
| faiss_rabitq_ivf | 0.99 | 1097.8 | 6 | 0.9946 | yes / no | 3.98 [3.85, 4.03] | 189 | 993 |
| faiss_rabitq_ivf | 0.995 | 2078.4 | 6 | 1.0003 | yes / yes |  | 189 | 998 |
| hnswlib_f32 | 0.98 | 853.7 | 6 | 0.9879 | yes / no | 3.65 [3.56, 3.74] | 195 | 546 |
| hnswlib_f32 | 0.99 | 1476.0 | 6 | 0.9902 | yes / no | 5.35 [5.16, 5.44] | 195 | 547 |
| hnswlib_f32 | 0.995 | 4329.4 | 6 | 1.0000 | yes / yes |  | 195 | 549 |
| ours_cascade | 0.98 | 234.1 | 6 | 0.9935 | yes / no |  | 223 | 309 |
| ours_cascade | 0.99 | 275.9 | 6 | 0.9959 | yes / no |  | 223 | 486 |
| scann | 0.98 | 780.1 | 6 | 1.0000 | yes / yes | 3.33 [3.27, 3.40] | 243 | 751 |
| scann | 0.99 | 780.1 | 6 | 1.0000 | yes / yes | 2.83 [2.74, 2.86] | 243 | 751 |
| scann | 0.995 | 780.1 | 6 | 1.0000 | yes / yes |  | 243 | 751 |
| usearch_f16 | 0.98 | 1308.4 | 6 | 0.9896 | yes / no | 5.59 [5.39, 5.77] | 116 | 432 |
| usearch_f16 | 0.99 | 1308.4 | 6 | 0.9896 | no / no | 4.74 [4.54, 4.88] | 116 | 432 |
| usearch_f16 | 0.995 | 2226.2 | 6 | 0.9895 | no / no |  | 116 | 433 |
| usearch_i8 | 0.98 | 689.4 | 6 | 0.9973 | yes / no | 2.95 [2.85, 3.09] | 74 | 251 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 216.9 / 0.9852 | 280.4 / 0.9852 | 262.5 / 0.9877 | 326.0 / 0.9877 | 453.0 / 0.9877 | 349.5 / 0.9969 | 424.7 / 0.9969 | 778.7 / 0.9969 | 616.2 / 0.9986 | 674.0 / 0.9986 | 1734.1 / 0.9986 |
| faiss_bin_hnsw | ef 100 | 257.7 / 0.9646 | 319.9 / 0.9646 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2245.1 / 0.9986 | 2309.5 / 0.9959 | 3413.4 / 0.9959 |
| faiss_bin_hnsw | ef 200 | 407.4 / 0.9643 | 464.4 / 0.9643 | 438.3 / 0.9719 | 497.4 / 0.9719 | 621.3 / 0.9719 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5272.9 / 0.9986 | 5317.9 / 0.9959 | 6450.6 / 0.9959 |
| faiss_bin_hnsw | ef 400 |  |  | 768.0 / 0.9790 | 815.0 / 0.9790 | 948.3 / 0.9790 | 833.3 / 0.9876 | 892.1 / 0.9876 | 1268.3 / 0.9876 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1593.0 / 0.9969 | 1650.8 / 0.9969 | 2038.2 / 0.9969 |  |  |  |
| faiss_hnsw_flat | ef 100 | 743.7 / 1.0001 | 805.4 / 1.0001 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4909.0 / 1.0000 | 4984.4 / 1.0000 | 6059.8 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1238.1 / 1.0000 | 1289.9 / 1.0000 | 1285.0 / 1.0000 | 1333.1 / 1.0000 | 1438.1 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 9556.0 / 1.0000 | 9634.6 / 1.0000 | 10705.7 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2141.5 / 1.0000 | 2207.4 / 1.0000 | 2325.4 / 1.0000 | 2218.4 / 1.0000 | 2291.5 / 1.0000 | 2645.3 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3857.8 / 1.0000 | 3961.2 / 1.0000 | 4342.3 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 2936.2 / 1.0001 | 2993.6 / 1.0001 | 2980.5 / 1.0000 | 3038.9 / 1.0000 | 3157.6 / 1.0000 | 3055.1 / 1.0000 | 3116.8 / 1.0000 | 3466.3 / 1.0000 | 3262.3 / 1.0000 | 3321.6 / 1.0000 | 4351.0 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 373.3 / 0.9588 | 433.8 / 0.9588 | 780.7 / 0.9588 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 590.9 / 0.9597 | 650.1 / 0.9597 | 1688.4 / 0.9597 |
| faiss_rabitq_ivf | nprobe 2 | 143.6 / 0.7265 | 199.4 / 0.7265 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 853.3 / 0.9816 | 915.9 / 0.9816 | 1948.5 / 0.9816 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 186.5 / 0.8174 | 243.8 / 0.8174 | 354.9 / 0.8174 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 182.3 / 0.8622 | 238.9 / 0.8622 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 273.2 / 0.8618 | 331.0 / 0.8618 | 674.5 / 0.8618 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 246.8 / 0.8850 | 303.5 / 0.8850 | 415.9 / 0.8850 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 1849.8 / 0.9885 | 1901.8 / 0.9885 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 9639.0 / 1.0000 | 9724.7 / 1.0000 | 10840.0 / 1.0000 |
| hnswlib_f32 | ef 200 | 3073.7 / 1.0000 | 3142.4 / 1.0000 | 3103.8 / 1.0000 | 3174.0 / 1.0000 | 3286.0 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 14986.0 / 1.0000 | 15058.0 / 1.0000 | 16179.5 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 5074.5 / 1.0000 | 5168.3 / 1.0000 | 5258.1 / 1.0000 | 5145.3 / 1.0000 | 5210.5 / 1.0000 | 5560.0 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 8198.5 / 1.0000 | 8244.2 / 1.0000 | 8670.5 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 177.3 / 0.9873 | 204.7 / 0.9873 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 306.1 / 0.9959 | 330.9 / 0.9959 | 860.1 / 0.9959 |
| ours_scan | ef 200 |  |  | 195.7 / 0.9874 | 220.4 / 0.9874 | 278.7 / 0.9874 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 226.7 / 0.9967 | 247.7 / 0.9967 | 426.7 / 0.9967 |  |  |  |
| ours_walk | ef 100 | 169.3 / 0.9774 | 197.6 / 0.9774 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 498.3 / 0.9959 | 529.2 / 0.9959 | 1050.3 / 0.9959 |
| ours_walk | ef 200 | 205.6 / 0.9773 | 241.5 / 0.9773 | 224.9 / 0.9814 | 248.9 / 0.9814 | 311.2 / 0.9814 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 606.0 / 0.9986 | 659.0 / 0.9959 | 1182.4 / 0.9959 |
| ours_walk | ef 400 |  |  | 277.4 / 0.9913 | 302.1 / 0.9913 | 369.3 / 0.9913 | 304.6 / 0.9994 | 335.7 / 0.9994 | 510.7 / 0.9994 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 362.8 / 0.9995 | 411.0 / 0.9995 | 589.6 / 0.9995 |  |  |  |
| scann | reorder 100 | 900.3 / 1.0000 | 962.4 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1397.6 / 1.0000 | 1466.4 / 1.0000 | 2591.0 / 1.0000 |
| scann | reorder 200 |  |  | 965.5 / 1.0000 | 1022.6 / 1.0000 | 1147.2 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 1078.1 / 1.0000 | 1146.1 / 1.0000 | 1513.2 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 305.4 / 0.9720 | 379.3 / 0.9720 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 2030.0 / 0.9986 | 2063.7 / 0.9986 | 3275.7 / 0.9986 |
| usearch_b1_rescore | ef 200 | 499.8 / 0.9782 | 567.1 / 0.9782 | 504.6 / 0.9823 | 578.2 / 0.9823 | 715.2 / 0.9823 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 3578.4 / 0.9986 | 3699.4 / 0.9986 | 4976.8 / 0.9986 |
| usearch_b1_rescore | ef 400 |  |  | 868.9 / 0.9890 | 926.9 / 0.9890 | 1059.0 / 0.9890 | 910.1 / 0.9967 | 997.9 / 0.9967 | 1367.1 / 0.9967 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1546.3 / 0.9950 | 1647.7 / 0.9950 | 2063.5 / 0.9950 |  |  |  |

### fiqa / jina-v2-base-code (n_ho = 259, exact quality 0.1254)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_exact | 0.98 | 7011.5 | 6 | 1.0000 | yes / yes | 21.80 [20.94, 22.06] | 179 | 551 |
| faiss_exact | 0.99 | 7011.5 | 6 | 1.0000 | yes / yes | 21.80 [20.94, 22.06] | 179 | 551 |
| faiss_exact | 0.995 | 7011.5 | 6 | 1.0000 | yes / yes | 21.80 [20.94, 22.06] | 179 | 551 |
| faiss_hnsw_flat | 0.98 | 449.9 | 6 | 0.9553 | no / no | 1.40 [1.33, 1.43] | 195 | 596 |
| faiss_hnsw_flat | 0.99 | 597.9 | 6 | 0.9822 | no / no | 1.86 [1.78, 1.90] | 188 | 572 |
| faiss_hnsw_flat | 0.995 | 597.9 | 6 | 0.9822 | no / no | 1.86 [1.78, 1.90] | 188 | 572 |
| faiss_hnsw_sq8 | 0.98 | 829.6 | 6 | 0.9877 | yes / no | 2.58 [2.48, 2.60] | 230 | 1121 |
| faiss_hnsw_sq8 | 0.99 | 829.6 | 6 | 0.9877 | no / no | 2.58 [2.48, 2.60] | 230 | 1121 |
| faiss_hnsw_sq8 | 0.995 | 829.6 | 6 | 0.9877 | no / no | 2.58 [2.48, 2.60] | 230 | 1121 |
| faiss_rabitq_flat | 0.98 | 2785.0 | 6 | 1.0000 | yes / yes | 8.66 [8.32, 8.72] | 185 | 983 |
| faiss_rabitq_flat | 0.99 | 2785.0 | 6 | 1.0000 | yes / yes | 8.66 [8.32, 8.72] | 185 | 983 |
| faiss_rabitq_flat | 0.995 | 2785.0 | 6 | 1.0000 | yes / yes | 8.66 [8.32, 8.72] | 185 | 983 |
| faiss_rabitq_hnsw | 0.98 | 447.7 | 6 | 0.8741 | no / no | 1.39 [1.33, 1.41] | 215 | 1073 |
| faiss_rabitq_hnsw | 0.99 | 1213.6 | 6 | 0.9559 | no / no | 3.77 [3.62, 3.84] | 215 | 1074 |
| faiss_rabitq_hnsw | 0.995 | 1213.6 | 6 | 0.9559 | no / no | 3.77 [3.62, 3.84] | 215 | 1074 |
| faiss_rabitq_ivf | 0.98 | 1206.3 | 6 | 0.9305 | no / no | 3.75 [3.60, 3.79] | 189 | 990 |
| faiss_rabitq_ivf | 0.99 | 2094.7 | 6 | 0.9633 | no / no | 6.51 [6.26, 6.56] | 187 | 991 |
| faiss_rabitq_ivf | 0.995 | 2094.7 | 6 | 0.9633 | no / no | 6.51 [6.26, 6.56] | 187 | 991 |
| hnswlib_f32 | 0.98 | 794.8 | 6 | 0.9298 | no / no | 2.47 [2.37, 2.51] | 195 | 544 |
| hnswlib_f32 | 0.99 | 857.2 | 6 | 0.9275 | no / no | 2.67 [2.56, 2.70] | 195 | 545 |
| hnswlib_f32 | 0.995 | 857.2 | 6 | 0.9275 | no / no | 2.67 [2.56, 2.70] | 195 | 545 |
| ours_cascade | 0.98 | 321.6 | 6 | 1.0008 | yes / yes |  | 223 | 720 |
| ours_cascade | 0.99 | 321.6 | 6 | 1.0008 | yes / yes |  | 223 | 720 |
| ours_cascade | 0.995 | 321.6 | 6 | 1.0008 | yes / yes |  | 223 | 720 |
| scann | 0.98 | 780.0 | 6 | 1.0000 | yes / yes | 2.43 [2.33, 2.45] | 243 | 744 |
| scann | 0.99 | 780.0 | 6 | 1.0000 | yes / yes | 2.43 [2.33, 2.45] | 243 | 744 |
| scann | 0.995 | 780.0 | 6 | 1.0000 | yes / yes | 2.43 [2.33, 2.45] | 243 | 744 |
| usearch_f16 | 0.98 | 690.2 | 6 | 0.9021 | no / no | 2.15 [2.05, 2.22] | 131 | 494 |
| usearch_f16 | 0.99 | 690.2 | 6 | 0.9021 | no / no | 2.15 [2.05, 2.22] | 131 | 494 |
| usearch_f16 | 0.995 | 690.2 | 6 | 0.9021 | no / no | 2.15 [2.05, 2.22] | 131 | 494 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 218.5 / 0.9879 | 278.1 / 0.9879 | 262.7 / 1.0013 | 323.3 / 1.0013 | 449.2 / 1.0013 | 351.1 / 1.0008 | 413.2 / 1.0004 | 777.6 / 1.0004 | 617.9 / 1.0008 | 668.8 / 1.0000 | 1719.3 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 240.2 / 0.9181 | 302.9 / 0.9181 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2120.5 / 1.0008 | 2189.1 / 1.0000 | 3287.0 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 379.0 / 0.9800 | 440.7 / 0.9800 | 399.7 / 0.9933 | 472.4 / 0.9933 | 597.0 / 0.9933 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 5083.6 / 1.0008 | 5142.4 / 1.0000 | 6262.2 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 701.7 / 1.0073 | 770.7 / 1.0073 | 894.3 / 1.0073 | 769.7 / 1.0008 | 828.8 / 1.0004 | 1208.5 / 1.0004 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1497.3 / 1.0008 | 1565.7 / 1.0004 | 1942.4 / 1.0004 |  |  |  |
| faiss_hnsw_flat | ef 100 | 744.0 / 0.9592 | 812.2 / 0.9588 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 4910.4 / 0.9700 | 5031.9 / 0.9692 | 6125.1 / 0.9692 |
| faiss_hnsw_flat | ef 200 | 1273.7 / 0.9592 | 1331.1 / 0.9588 | 1271.6 / 0.9596 | 1336.1 / 0.9588 | 1468.3 / 0.9588 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 9577.3 / 1.0008 | 9603.9 / 1.0000 | 10688.7 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2184.0 / 0.9706 | 2244.3 / 0.9698 | 2356.9 / 0.9698 | 2256.4 / 0.9706 | 2332.2 / 0.9698 | 2700.8 / 0.9698 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 3940.3 / 0.9700 | 4003.4 / 0.9692 | 4332.2 / 0.9692 |  |  |  |
| faiss_rabitq_flat | exhaustive | 2935.8 / 1.0004 | 2994.3 / 1.0000 | 2979.8 / 1.0008 | 3036.4 / 1.0000 | 3157.0 / 1.0000 | 3054.4 / 1.0008 | 3113.6 / 1.0000 | 3464.8 / 1.0000 | 3259.5 / 1.0008 | 3318.4 / 1.0000 | 4345.3 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  | 371.3 / 0.7087 | 428.5 / 0.7087 | 768.8 / 0.7087 |  |  |  |
| faiss_rabitq_ivf | nprobe 13 |  |  |  |  |  |  |  |  | 583.0 / 0.7539 | 637.8 / 0.7539 | 1670.1 / 0.7539 |
| faiss_rabitq_ivf | nprobe 2 | 142.5 / 0.4532 | 198.6 / 0.4532 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 26 |  |  |  |  |  |  |  |  | 831.4 / 0.8462 | 887.7 / 0.8457 | 1914.0 / 0.8457 |
| faiss_rabitq_ivf | nprobe 3 |  |  | 183.1 / 0.5887 | 240.0 / 0.5887 | 351.7 / 0.5887 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 4 | 183.0 / 0.6217 | 239.1 / 0.6217 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  | 270.1 / 0.6363 | 326.9 / 0.6363 | 665.3 / 0.6363 |  |  |  |
| faiss_rabitq_ivf | nprobe 6 |  |  | 242.8 / 0.6668 | 299.1 / 0.6668 | 412.3 / 0.6668 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 1888.7 / 0.9557 | 1934.7 / 0.9553 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 10027.6 / 1.0008 | 10131.4 / 1.0000 | 11269.5 / 1.0000 |
| hnswlib_f32 | ef 200 | 3189.4 / 1.0009 | 3275.8 / 1.0005 | 3209.2 / 1.0014 | 3270.0 / 1.0005 | 3394.2 / 1.0005 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 15127.2 / 1.0008 | 15130.3 / 1.0000 | 16275.7 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 5300.7 / 1.0014 | 5344.7 / 1.0005 | 5451.3 / 1.0005 | 5346.6 / 1.0014 | 5394.0 / 1.0005 | 5765.8 / 1.0005 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 8549.2 / 1.0008 | 8647.0 / 1.0000 | 8974.4 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 176.4 / 0.9879 | 200.1 / 0.9879 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 301.6 / 1.0008 | 329.8 / 1.0000 | 806.1 / 1.0000 |
| ours_scan | ef 200 |  |  | 188.8 / 1.0073 | 212.5 / 1.0073 | 268.6 / 1.0073 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 216.4 / 1.0008 | 244.1 / 1.0004 | 412.5 / 1.0004 |  |  |  |
| ours_walk | ef 100 | 154.0 / 0.9631 | 182.9 / 0.9631 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 425.2 / 1.0008 | 457.6 / 1.0000 | 929.1 / 1.0000 |
| ours_walk | ef 200 | 174.7 / 0.9631 | 207.2 / 0.9631 | 188.1 / 0.9765 | 221.5 / 0.9765 | 283.8 / 0.9765 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 549.8 / 1.0008 | 567.1 / 1.0000 | 1081.5 / 1.0000 |
| ours_walk | ef 400 |  |  | 230.0 / 0.9765 | 254.9 / 0.9765 | 316.4 / 0.9765 | 256.9 / 0.9700 | 289.8 / 0.9696 | 457.7 / 0.9696 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 318.3 / 1.0008 | 351.9 / 1.0004 | 517.0 / 1.0004 |  |  |  |
| scann | reorder 100 | 899.7 / 1.0004 | 960.0 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 1392.3 / 1.0008 | 1454.8 / 1.0000 | 2566.6 / 1.0000 |
| scann | reorder 200 |  |  | 961.0 / 1.0004 | 1019.2 / 1.0000 | 1144.3 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 1070.8 / 1.0008 | 1134.2 / 1.0000 | 1499.3 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 283.1 / 0.9250 | 343.4 / 0.9250 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 1709.2 / 1.0008 | 1860.9 / 1.0000 | 3059.2 / 1.0000 |
| usearch_b1_rescore | ef 200 | 426.8 / 0.9579 | 512.8 / 0.9579 | 454.9 / 0.9765 | 523.4 / 0.9765 | 651.0 / 0.9765 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 3153.9 / 1.0008 | 3263.8 / 1.0000 | 4508.5 / 1.0000 |
| usearch_b1_rescore | ef 400 |  |  | 766.7 / 1.0127 | 836.3 / 1.0127 | 975.9 / 1.0127 | 811.3 / 1.0008 | 878.0 / 1.0004 | 1259.6 / 1.0004 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 1348.8 / 1.0008 | 1464.3 / 1.0004 | 1847.8 / 1.0004 |  |  |  |

### gcsn / CodeRankEmbed (n_ho = 2400, exact quality 0.8412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 40.7 | 6 | 0.9897 | yes / yes | 0.38 [0.37, 0.41] | 78 | 124 |
| faiss_bin_flat | 0.99 | 40.7 | 6 | 0.9897 | no / no | 0.38 [0.37, 0.41] | 78 | 124 |
| faiss_bin_flat | 0.995 | 62.6 | 6 | 0.9959 | yes / no | 0.45 [0.44, 0.50] | 78 | 123 |
| faiss_bin_hnsw | 0.98 | 158.6 | 6 | 0.9848 | yes / no | 1.49 [1.39, 1.61] | 79 | 137 |
| faiss_bin_hnsw | 0.99 | 184.0 | 6 | 0.9923 | yes / no | 1.73 [1.61, 1.87] | 79 | 136 |
| faiss_bin_hnsw | 0.995 | 201.0 | 6 | 0.9956 | yes / no | 1.46 [1.38, 1.60] | 79 | 136 |
| faiss_exact | 0.98 | 847.8 | 6 | 1.0000 | yes / yes | 7.99 [6.04, 8.59] | 47 | 78 |
| faiss_exact | 0.99 | 847.8 | 6 | 1.0000 | yes / yes | 7.99 [6.04, 8.59] | 47 | 78 |
| faiss_exact | 0.995 | 847.8 | 6 | 1.0000 | yes / yes | 6.16 [4.62, 6.69] | 47 | 78 |
| faiss_hnsw_flat | 0.98 | 289.9 | 6 | 0.9989 | yes / yes | 2.73 [2.01, 2.95] | 49 | 82 |
| faiss_hnsw_flat | 0.99 | 289.9 | 6 | 0.9989 | yes / yes | 2.73 [2.01, 2.95] | 49 | 82 |
| faiss_hnsw_flat | 0.995 | 359.5 | 6 | 0.9969 | yes / no | 2.61 [1.91, 2.86] | 51 | 89 |
| faiss_hnsw_sq8 | 0.98 | 305.5 | 6 | 0.9914 | yes / yes | 2.88 [2.59, 3.09] | 79 | 148 |
| faiss_hnsw_sq8 | 0.99 | 407.5 | 6 | 0.9956 | yes / yes | 3.84 [3.50, 4.14] | 79 | 152 |
| faiss_hnsw_sq8 | 0.995 | 620.9 | 6 | 0.9963 | yes / no | 4.51 [4.13, 4.92] | 79 | 157 |
| faiss_ivfpq_fs | 0.98 | 197.2 | 6 | 1.0000 | yes / yes | 1.86 [1.76, 2.00] | 80 | 136 |
| faiss_ivfpq_fs | 0.99 | 197.2 | 6 | 1.0000 | yes / yes | 1.86 [1.76, 2.00] | 80 | 136 |
| faiss_ivfpq_fs | 0.995 | 197.2 | 6 | 1.0000 | yes / yes | 1.43 [1.36, 1.57] | 80 | 136 |
| faiss_rabitq_flat | 0.98 | 363.3 | 6 | 0.9999 | yes / yes | 3.42 [3.31, 3.69] | 79 | 128 |
| faiss_rabitq_flat | 0.99 | 363.3 | 6 | 0.9999 | yes / yes | 3.42 [3.31, 3.69] | 79 | 128 |
| faiss_rabitq_flat | 0.995 | 363.3 | 6 | 0.9999 | yes / yes | 2.64 [2.60, 2.89] | 79 | 128 |
| faiss_rabitq_hnsw | 0.98 | 154.1 | 6 | 0.9912 | yes / yes | 1.45 [1.39, 1.57] | 79 | 142 |
| faiss_rabitq_hnsw | 0.99 | 163.4 | 6 | 0.9968 | yes / yes | 1.54 [1.46, 1.66] | 79 | 136 |
| faiss_rabitq_hnsw | 0.995 | 218.9 | 6 | 0.9986 | yes / yes | 1.59 [1.55, 1.74] | 79 | 142 |
| faiss_rabitq_ivf | 0.98 | 778.7 | 6 | 0.9961 | yes / yes | 7.34 [7.01, 7.92] | 79 | 135 |
| faiss_rabitq_ivf | 0.99 | 788.3 | 6 | 1.0000 | yes / yes | 7.43 [7.19, 8.02] | 79 | 133 |
| faiss_rabitq_ivf | 0.995 | 788.3 | 6 | 1.0000 | yes / yes | 5.73 [5.64, 6.26] | 79 | 133 |
| hnswlib_f32 | 0.98 | 784.6 | 6 | 0.9976 | yes / yes | 7.39 [6.91, 7.98] | 51 | 72 |
| hnswlib_f32 | 0.99 | 784.6 | 6 | 0.9976 | yes / yes | 7.39 [6.91, 7.98] | 51 | 72 |
| hnswlib_f32 | 0.995 | 1311.7 | 6 | 1.0001 | yes / yes | 9.53 [9.15, 10.41] | 54 | 78 |
| ours_cascade | 0.98 | 106.2 | 6 | 0.9908 | yes / yes |  | 156 | 101 |
| ours_cascade | 0.99 | 106.2 | 6 | 0.9908 | yes / no |  | 156 | 101 |
| ours_cascade | 0.995 | 137.6 | 6 | 0.9959 | yes / no |  | 137 | 163 |
| scann | 0.98 | 508.2 | 6 | 1.0000 | yes / yes | 4.79 [4.56, 5.16] | 77 | 192 |
| scann | 0.99 | 508.2 | 6 | 1.0000 | yes / yes | 4.79 [4.56, 5.16] | 77 | 192 |
| scann | 0.995 | 508.2 | 6 | 1.0000 | yes / yes | 3.69 [3.55, 4.03] | 77 | 192 |
| usearch_b1_rescore | 0.98 | 200.1 | 6 | 0.9925 | yes / yes | 1.88 [1.68, 2.03] | 80 | 125 |
| usearch_b1_rescore | 0.99 | 238.6 | 6 | 0.9943 | yes / no | 2.25 [2.02, 2.43] | 81 | 129 |
| usearch_f16 | 0.98 | 372.7 | 6 | 0.9916 | yes / yes | 3.51 [2.86, 3.81] | 39 | 53 |
| usearch_f16 | 0.99 | 496.4 | 6 | 0.9951 | yes / yes | 4.68 [3.74, 5.05] | 40 | 57 |
| usearch_i8 | 0.98 | 130.6 | 6 | 0.9869 | yes / yes | 1.23 [1.01, 1.38] | 33 | 33 |
| usearch_i8 | 0.99 | 172.7 | 6 | 0.9918 | yes / no | 1.63 [1.38, 1.80] | 37 | 44 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 104.9 / 0.9959 | 158.8 / 0.9959 | 136.2 / 0.9981 | 190.7 / 0.9982 | 299.0 / 0.9982 | 196.0 / 0.9996 | 250.8 / 0.9996 | 579.2 / 0.9996 | 352.8 / 1.0001 | 412.1 / 1.0001 | 1404.6 / 1.0001 |
| faiss_bin_hnsw | ef 100 | 168.7 / 0.9952 | 223.0 / 0.9952 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1490.2 / 1.0001 | 1537.3 / 1.0001 | 2576.9 / 1.0001 |
| faiss_bin_hnsw | ef 200 | 251.8 / 0.9959 | 306.7 / 0.9959 | 281.5 / 0.9981 | 336.2 / 0.9982 | 444.9 / 0.9982 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 3939.0 / 1.0001 | 3996.7 / 1.0001 | 5042.1 / 1.0001 |
| faiss_bin_hnsw | ef 400 |  |  | 458.2 / 0.9981 | 514.4 / 0.9982 | 624.5 / 0.9982 | 519.3 / 0.9996 | 572.4 / 0.9996 | 906.6 / 0.9996 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 996.2 / 0.9996 | 1053.4 / 0.9996 | 1389.7 / 0.9996 |  |  |  |
| faiss_hnsw_flat | ef 100 | 644.5 / 0.9994 | 696.1 / 0.9993 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 3084.2 / 1.0001 | 3145.1 / 1.0000 | 4156.3 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1028.0 / 0.9999 | 1062.3 / 0.9999 | 1046.2 / 0.9999 | 1103.6 / 0.9999 | 1231.3 / 0.9999 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 5863.1 / 1.0001 | 5917.3 / 1.0000 | 6906.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1577.2 / 1.0000 | 1659.2 / 1.0000 | 1766.6 / 1.0000 | 1670.3 / 1.0000 | 1724.7 / 1.0000 | 2066.4 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2516.0 / 1.0000 | 2569.5 / 1.0000 | 2913.1 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 436.0 / 1.0001 | 489.5 / 1.0000 | 464.4 / 1.0000 | 518.5 / 1.0000 | 627.0 / 1.0000 | 517.3 / 1.0000 | 571.6 / 1.0000 | 899.4 / 1.0000 | 651.4 / 1.0000 | 707.2 / 1.0000 | 1694.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 287.4 / 0.9175 | 340.7 / 0.9175 | 671.5 / 0.9175 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 253.2 / 0.9224 | 306.0 / 0.9224 | 415.6 / 0.9224 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 423.1 / 0.9669 | 479.1 / 0.9669 | 810.4 / 0.9669 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 620.3 / 0.9750 | 677.8 / 0.9749 | 1672.3 / 0.9749 |
| faiss_rabitq_ivf | nprobe 4 | 123.8 / 0.7555 | 178.8 / 0.7555 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 945.7 / 0.9989 | 1002.6 / 0.9989 | 2004.0 / 0.9989 |
| faiss_rabitq_ivf | nprobe 8 | 159.7 / 0.8545 | 215.2 / 0.8545 | 180.3 / 0.8545 | 233.0 / 0.8545 | 340.5 / 0.8545 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 1775.4 / 0.9998 | 1818.5 / 0.9998 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 5137.3 / 1.0001 | 5187.6 / 1.0000 | 6196.5 / 1.0000 |
| hnswlib_f32 | ef 200 | 2737.3 / 1.0000 | 2792.2 / 1.0000 | 2759.3 / 1.0000 | 2815.0 / 1.0000 | 2925.2 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 5644.6 / 1.0001 | 5697.3 / 1.0000 | 6722.3 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 3854.5 / 1.0000 | 3922.9 / 1.0000 | 4023.2 / 1.0000 | 3896.9 / 1.0000 | 3955.6 / 1.0000 | 4279.6 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 4799.7 / 1.0000 | 4845.0 / 1.0000 | 5181.4 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 76.9 / 0.9959 | 95.2 / 0.9959 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 149.0 / 1.0001 | 177.7 / 1.0001 | 614.0 / 1.0001 |
| ours_scan | ef 200 |  |  | 89.9 / 0.9982 | 109.2 / 0.9982 | 150.7 / 0.9982 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 106.7 / 0.9997 | 128.6 / 0.9996 | 265.8 / 0.9996 |  |  |  |
| ours_walk | ef 100 | 95.3 / 0.9959 | 116.5 / 0.9959 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 229.5 / 1.0001 | 254.9 / 1.0001 | 708.0 / 1.0001 |
| ours_walk | ef 200 | 105.9 / 0.9959 | 126.0 / 0.9959 | 116.5 / 0.9982 | 138.1 / 0.9982 | 184.0 / 0.9982 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 282.2 / 1.0001 | 310.9 / 1.0001 | 754.2 / 1.0001 |
| ours_walk | ef 400 |  |  | 128.4 / 0.9982 | 148.3 / 0.9982 | 194.2 / 0.9982 | 148.0 / 0.9997 | 171.0 / 0.9997 | 316.3 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 164.0 / 0.9997 | 187.2 / 0.9997 | 331.2 / 0.9997 |  |  |  |
| scann | reorder 100 | 606.3 / 1.0000 | 663.9 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 786.8 / 1.0001 | 844.9 / 1.0000 | 1985.8 / 1.0000 |
| scann | reorder 200 |  |  | 628.0 / 1.0000 | 683.1 / 1.0000 | 800.5 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 673.4 / 1.0000 | 729.7 / 1.0000 | 1084.9 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 158.9 / 0.9911 | 214.2 / 0.9911 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 785.3 / 0.9967 | 844.3 / 0.9967 | 1915.3 / 0.9967 |
| usearch_b1_rescore | ef 200 | 226.5 / 0.9922 | 285.8 / 0.9922 | 241.0 / 0.9943 | 299.3 / 0.9944 | 411.2 / 0.9944 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1322.4 / 0.9967 | 1380.2 / 0.9967 | 2508.8 / 0.9967 |
| usearch_b1_rescore | ef 400 |  |  | 348.7 / 0.9948 | 409.6 / 0.9949 | 525.2 / 0.9949 | 377.2 / 0.9963 | 437.8 / 0.9963 | 778.1 / 0.9963 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 580.4 / 0.9963 | 642.3 / 0.9963 | 992.8 / 0.9963 |  |  |  |

### gcsn / bge-base-en-v1.5 (n_ho = 2400, exact quality 0.7359)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 89.9 | 6 | 0.9929 | yes / yes | 0.57 [0.54, 0.64] | 78 | 126 |
| faiss_bin_flat | 0.99 | 89.9 | 6 | 0.9929 | yes / no | 0.44 [0.42, 0.49] | 78 | 126 |
| faiss_bin_flat | 0.995 | 334.6 | 6 | 1.0001 | yes / yes | 1.28 [1.15, 1.44] | 78 | 124 |
| faiss_bin_hnsw | 0.98 | 495.8 | 6 | 0.9861 | yes / no | 3.15 [2.90, 3.51] | 79 | 128 |
| faiss_bin_hnsw | 0.99 | 523.0 | 6 | 0.9933 | yes / no | 2.57 [2.40, 2.85] | 79 | 131 |
| faiss_bin_hnsw | 0.995 | 671.2 | 6 | 0.9982 | yes / yes | 2.56 [2.42, 2.90] | 79 | 135 |
| faiss_exact | 0.98 | 821.7 | 6 | 1.0000 | yes / yes | 5.22 [4.12, 5.85] | 49 | 84 |
| faiss_exact | 0.99 | 821.7 | 6 | 1.0000 | yes / yes | 4.04 [3.23, 4.47] | 49 | 84 |
| faiss_exact | 0.995 | 821.7 | 6 | 1.0000 | yes / yes | 3.13 [2.51, 3.55] | 49 | 84 |
| faiss_hnsw_flat | 0.98 | 620.8 | 6 | 0.9963 | yes / yes | 3.94 [3.19, 4.41] | 50 | 83 |
| faiss_hnsw_flat | 0.99 | 620.8 | 6 | 0.9963 | yes / yes | 3.05 [2.51, 3.38] | 50 | 83 |
| faiss_hnsw_flat | 0.995 | 672.2 | 6 | 0.9981 | yes / yes | 2.56 [2.13, 2.91] | 51 | 86 |
| faiss_hnsw_sq8 | 0.98 | 499.2 | 6 | 0.9900 | yes / yes | 3.17 [2.97, 3.53] | 79 | 148 |
| faiss_hnsw_sq8 | 0.99 | 580.8 | 6 | 0.9944 | yes / yes | 2.86 [2.64, 3.16] | 79 | 152 |
| faiss_hnsw_sq8 | 0.995 | 884.3 | 6 | 0.9979 | yes / yes | 3.37 [3.10, 3.81] | 79 | 150 |
| faiss_ivfpq_fs | 0.98 | 366.4 | 6 | 1.0000 | yes / yes | 2.33 [2.10, 2.60] | 80 | 139 |
| faiss_ivfpq_fs | 0.99 | 366.4 | 6 | 1.0000 | yes / yes | 1.80 [1.62, 1.99] | 80 | 139 |
| faiss_ivfpq_fs | 0.995 | 366.4 | 6 | 1.0000 | yes / yes | 1.40 [1.26, 1.58] | 80 | 139 |
| faiss_rabitq_flat | 0.98 | 420.9 | 6 | 1.0000 | yes / yes | 2.67 [2.63, 3.00] | 79 | 130 |
| faiss_rabitq_flat | 0.99 | 420.9 | 6 | 1.0000 | yes / yes | 2.07 [2.02, 2.29] | 79 | 130 |
| faiss_rabitq_flat | 0.995 | 420.9 | 6 | 1.0000 | yes / yes | 1.60 [1.56, 1.82] | 79 | 130 |
| faiss_rabitq_hnsw | 0.98 | 401.4 | 6 | 0.9954 | yes / yes | 2.55 [2.43, 2.86] | 79 | 144 |
| faiss_rabitq_hnsw | 0.99 | 401.4 | 6 | 0.9954 | yes / no | 1.97 [1.87, 2.19] | 79 | 144 |
| faiss_rabitq_hnsw | 0.995 | 539.2 | 6 | 0.9977 | yes / no | 2.06 [1.98, 2.33] | 79 | 140 |
| faiss_rabitq_ivf | 0.98 | 997.3 | 6 | 1.0000 | yes / yes | 6.34 [6.19, 7.10] | 79 | 137 |
| faiss_rabitq_ivf | 0.99 | 997.3 | 6 | 1.0000 | yes / yes | 4.90 [4.76, 5.43] | 79 | 137 |
| faiss_rabitq_ivf | 0.995 | 997.3 | 6 | 1.0000 | yes / yes | 3.80 [3.68, 4.31] | 79 | 137 |
| hnswlib_f32 | 0.98 | 1610.3 | 6 | 0.9982 | yes / yes | 10.23 [9.66, 11.43] | 53 | 72 |
| hnswlib_f32 | 0.99 | 1610.3 | 6 | 0.9982 | yes / yes | 7.92 [7.45, 8.74] | 53 | 72 |
| hnswlib_f32 | 0.995 | 1832.8 | 6 | 0.9994 | yes / yes | 6.99 [6.58, 7.92] | 53 | 72 |
| ours_cascade | 0.98 | 157.4 | 6 | 0.9895 | yes / yes |  | 170 | 148 |
| ours_cascade | 0.99 | 203.4 | 6 | 0.9930 | yes / no |  | 154 | 219 |
| ours_cascade | 0.995 | 262.3 | 6 | 0.9989 | yes / yes |  | 154 | 356 |
| scann | 0.98 | 512.4 | 6 | 1.0000 | yes / yes | 3.26 [3.18, 3.65] | 79 | 192 |
| scann | 0.99 | 512.4 | 6 | 1.0000 | yes / yes | 2.52 [2.43, 2.79] | 79 | 192 |
| scann | 0.995 | 512.4 | 6 | 1.0000 | yes / yes | 1.95 [1.88, 2.21] | 79 | 192 |
| usearch_b1_rescore | 0.98 | 565.7 | 6 | 0.9950 | yes / yes | 3.60 [3.30, 4.01] | 80 | 124 |
| usearch_b1_rescore | 0.99 | 581.4 | 6 | 0.9956 | yes / yes | 2.86 [2.59, 3.17] | 80 | 124 |
| usearch_b1_rescore | 0.995 | 622.0 | 6 | 1.0004 | yes / yes | 2.37 [2.14, 2.69] | 82 | 136 |
| usearch_f16 | 0.98 | 791.6 | 6 | 0.9913 | yes / yes | 5.03 [4.09, 5.64] | 40 | 54 |
| usearch_f16 | 0.99 | 888.8 | 6 | 0.9931 | yes / no | 4.37 [3.62, 4.85] | 44 | 65 |
| usearch_f16 | 0.995 | 1083.8 | 6 | 0.9964 | yes / no | 4.13 [3.33, 4.67] | 42 | 58 |
| usearch_i8 | 0.98 | 317.6 | 6 | 0.9897 | yes / yes | 2.02 [1.73, 2.32] | 36 | 35 |
| usearch_i8 | 0.99 | 559.0 | 6 | 0.9943 | yes / no | 2.75 [2.29, 3.14] | 39 | 42 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 102.9 / 0.9903 | 156.3 / 0.9903 | 131.3 / 0.9954 | 185.3 / 0.9954 | 293.2 / 0.9954 | 186.3 / 0.9992 | 240.6 / 0.9991 | 566.1 / 0.9991 | 331.7 / 1.0000 | 391.3 / 1.0000 | 1374.6 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 157.9 / 0.9824 | 212.0 / 0.9824 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1433.3 / 1.0000 | 1490.2 / 1.0000 | 2497.0 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 233.1 / 0.9865 | 288.5 / 0.9865 | 260.4 / 0.9919 | 315.8 / 0.9919 | 424.9 / 0.9919 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 3845.2 / 1.0000 | 3894.6 / 1.0000 | 4930.0 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 429.4 / 0.9955 | 487.0 / 0.9955 | 597.2 / 0.9955 | 486.6 / 0.9993 | 543.1 / 0.9992 | 871.8 / 0.9992 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 957.4 / 0.9992 | 1010.6 / 0.9991 | 1349.6 / 0.9991 |  |  |  |
| faiss_hnsw_flat | ef 100 | 454.7 / 0.9978 | 521.9 / 0.9977 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2791.8 / 1.0000 | 2841.1 / 1.0000 | 3855.5 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 743.8 / 0.9997 | 803.4 / 0.9996 | 770.5 / 0.9996 | 831.6 / 0.9996 | 947.0 / 0.9996 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 5672.7 / 1.0000 | 5726.9 / 1.0000 | 6717.2 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1246.5 / 1.0000 | 1326.7 / 1.0000 | 1410.3 / 1.0000 | 1306.4 / 1.0000 | 1357.7 / 1.0000 | 1701.2 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2201.5 / 1.0000 | 2241.3 / 1.0000 | 2589.0 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 434.3 / 1.0000 | 487.8 / 1.0000 | 458.7 / 1.0000 | 513.1 / 1.0000 | 620.2 / 1.0000 | 505.1 / 1.0000 | 559.0 / 1.0000 | 883.4 / 1.0000 | 629.4 / 1.0000 | 685.6 / 1.0000 | 1665.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 279.1 / 0.8273 | 333.9 / 0.8273 | 657.7 / 0.8273 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 249.4 / 0.8360 | 304.1 / 0.8360 | 410.1 / 0.8360 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 416.9 / 0.9344 | 469.5 / 0.9344 | 797.9 / 0.9344 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 600.7 / 0.9516 | 656.9 / 0.9516 | 1644.0 / 0.9516 |
| faiss_rabitq_ivf | nprobe 4 | 122.0 / 0.6079 | 175.4 / 0.6079 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 915.8 / 0.9990 | 974.9 / 0.9990 | 1964.5 / 0.9990 |
| faiss_rabitq_ivf | nprobe 8 | 159.0 / 0.7314 | 211.9 / 0.7314 | 176.2 / 0.7314 | 230.8 / 0.7314 | 335.6 / 0.7314 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 1121.9 / 0.9972 | 1177.3 / 0.9971 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 4318.7 / 1.0000 | 4378.3 / 1.0000 | 5378.3 / 1.0000 |
| hnswlib_f32 | ef 200 | 1805.9 / 1.0000 | 1861.2 / 0.9999 | 1827.3 / 0.9999 | 1882.2 / 0.9999 | 1989.9 / 0.9999 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 5286.6 / 1.0000 | 5338.4 / 1.0000 | 6353.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 2759.9 / 1.0000 | 2816.6 / 1.0000 | 2922.7 / 1.0000 | 2794.7 / 1.0000 | 2845.6 / 1.0000 | 3173.3 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 3873.2 / 1.0000 | 3924.9 / 1.0000 | 4251.5 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 76.8 / 0.9895 | 94.9 / 0.9895 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 145.0 / 1.0001 | 174.7 / 1.0001 | 607.0 / 1.0001 |
| ours_scan | ef 200 |  |  | 87.2 / 0.9962 | 107.1 / 0.9962 | 146.7 / 0.9962 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 106.8 / 0.9990 | 126.0 / 0.9989 | 257.8 / 0.9989 |  |  |  |
| ours_walk | ef 100 | 91.7 / 0.9860 | 111.2 / 0.9860 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 223.6 / 0.9995 | 247.9 / 0.9995 | 687.8 / 0.9995 |
| ours_walk | ef 200 | 101.7 / 0.9889 | 122.0 / 0.9889 | 111.4 / 0.9942 | 132.8 / 0.9942 | 176.1 / 0.9942 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 278.7 / 1.0000 | 302.5 / 1.0000 | 734.3 / 1.0000 |
| ours_walk | ef 400 |  |  | 123.1 / 0.9941 | 143.7 / 0.9941 | 189.3 / 0.9941 | 143.5 / 0.9984 | 163.3 / 0.9983 | 301.3 / 0.9983 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 161.1 / 0.9990 | 183.1 / 0.9990 | 322.1 / 0.9990 |  |  |  |
| scann | reorder 100 | 602.4 / 1.0001 | 657.0 / 1.0000 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 768.9 / 1.0000 | 828.9 / 1.0000 | 1940.4 / 1.0000 |
| scann | reorder 200 |  |  | 621.4 / 1.0000 | 679.3 / 1.0000 | 792.8 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 665.8 / 1.0000 | 719.4 / 1.0000 | 1067.8 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 144.5 / 0.9773 | 200.7 / 0.9773 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 721.9 / 0.9965 | 776.6 / 0.9964 | 1838.4 / 0.9964 |
| usearch_b1_rescore | ef 200 | 203.9 / 0.9838 | 261.1 / 0.9838 | 216.5 / 0.9895 | 273.5 / 0.9895 | 385.8 / 0.9895 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1214.5 / 0.9965 | 1279.8 / 0.9964 | 2402.0 / 0.9964 |
| usearch_b1_rescore | ef 400 |  |  | 319.8 / 0.9922 | 379.0 / 0.9922 | 490.6 / 0.9922 | 346.4 / 0.9943 | 400.9 / 0.9942 | 744.3 / 0.9942 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 543.1 / 0.9947 | 595.0 / 0.9946 | 943.4 / 0.9946 |  |  |  |

### gcsn / jina-v2-base-code (n_ho = 2400, exact quality 0.8177)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 38.8 | 6 | 0.9994 | yes / yes | 0.37 [0.36, 0.40] | 78 | 125 |
| faiss_bin_flat | 0.99 | 38.8 | 6 | 0.9994 | yes / yes | 0.37 [0.36, 0.40] | 78 | 125 |
| faiss_bin_flat | 0.995 | 38.8 | 6 | 0.9994 | yes / yes | 0.37 [0.36, 0.40] | 78 | 125 |
| faiss_bin_hnsw | 0.98 | 111.9 | 6 | 0.9900 | yes / yes | 1.07 [0.99, 1.15] | 79 | 136 |
| faiss_bin_hnsw | 0.99 | 119.0 | 6 | 0.9916 | yes / no | 1.14 [1.07, 1.23] | 79 | 130 |
| faiss_bin_hnsw | 0.995 | 126.8 | 6 | 0.9962 | yes / no | 1.21 [1.14, 1.31] | 79 | 132 |
| faiss_exact | 0.98 | 798.6 | 6 | 0.9999 | yes / yes | 7.64 [6.04, 8.35] | 47 | 80 |
| faiss_exact | 0.99 | 798.6 | 6 | 0.9999 | yes / yes | 7.64 [6.04, 8.35] | 47 | 80 |
| faiss_exact | 0.995 | 798.6 | 6 | 0.9999 | yes / yes | 7.64 [6.04, 8.35] | 47 | 80 |
| faiss_hnsw_flat | 0.98 | 223.7 | 6 | 0.9997 | yes / yes | 2.14 [1.69, 2.32] | 49 | 81 |
| faiss_hnsw_flat | 0.99 | 223.7 | 6 | 0.9997 | yes / yes | 2.14 [1.69, 2.32] | 49 | 81 |
| faiss_hnsw_flat | 0.995 | 223.7 | 6 | 0.9997 | yes / yes | 2.14 [1.69, 2.32] | 49 | 81 |
| faiss_hnsw_sq8 | 0.98 | 165.9 | 6 | 0.9916 | yes / yes | 1.59 [1.48, 1.71] | 79 | 151 |
| faiss_hnsw_sq8 | 0.99 | 225.2 | 6 | 0.9953 | yes / yes | 2.16 [2.02, 2.31] | 79 | 155 |
| faiss_hnsw_sq8 | 0.995 | 250.8 | 6 | 0.9993 | yes / yes | 2.40 [2.25, 2.58] | 79 | 147 |
| faiss_ivfpq_fs | 0.98 | 133.8 | 6 | 0.9881 | yes / yes | 1.28 [1.19, 1.37] | 80 | 141 |
| faiss_ivfpq_fs | 0.99 | 186.6 | 6 | 0.9999 | yes / yes | 1.79 [1.71, 1.92] | 80 | 137 |
| faiss_ivfpq_fs | 0.995 | 186.6 | 6 | 0.9999 | yes / yes | 1.79 [1.71, 1.92] | 80 | 137 |
| faiss_rabitq_flat | 0.98 | 360.9 | 6 | 0.9999 | yes / yes | 3.45 [3.36, 3.70] | 79 | 128 |
| faiss_rabitq_flat | 0.99 | 360.9 | 6 | 0.9999 | yes / yes | 3.45 [3.36, 3.70] | 79 | 128 |
| faiss_rabitq_flat | 0.995 | 360.9 | 6 | 0.9999 | yes / yes | 3.45 [3.36, 3.70] | 79 | 128 |
| faiss_rabitq_hnsw | 0.98 | 86.4 | 6 | 0.9925 | yes / yes | 0.83 [0.78, 0.89] | 79 | 134 |
| faiss_rabitq_hnsw | 0.99 | 103.1 | 6 | 0.9949 | yes / no | 0.99 [0.94, 1.06] | 79 | 133 |
| faiss_rabitq_hnsw | 0.995 | 133.9 | 6 | 0.9982 | yes / yes | 1.28 [1.23, 1.37] | 79 | 142 |
| faiss_rabitq_ivf | 0.98 | 356.9 | 6 | 0.9881 | yes / yes | 3.42 [3.30, 3.66] | 79 | 133 |
| faiss_rabitq_ivf | 0.99 | 752.4 | 6 | 0.9979 | yes / yes | 7.20 [6.95, 7.73] | 79 | 134 |
| faiss_rabitq_ivf | 0.995 | 770.4 | 6 | 0.9999 | yes / yes | 7.37 [7.18, 7.91] | 79 | 135 |
| hnswlib_f32 | 0.98 | 687.7 | 6 | 0.9986 | yes / yes | 6.58 [6.20, 7.05] | 51 | 71 |
| hnswlib_f32 | 0.99 | 687.7 | 6 | 0.9986 | yes / yes | 6.58 [6.20, 7.05] | 51 | 71 |
| hnswlib_f32 | 0.995 | 687.7 | 6 | 0.9986 | yes / yes | 6.58 [6.20, 7.05] | 51 | 71 |
| ours_cascade | 0.98 | 104.5 | 6 | 0.9995 | yes / yes |  | 137 | 103 |
| ours_cascade | 0.99 | 104.5 | 6 | 0.9995 | yes / yes |  | 137 | 103 |
| ours_cascade | 0.995 | 104.5 | 6 | 0.9995 | yes / yes |  | 137 | 103 |
| scann | 0.98 | 503.4 | 6 | 0.9999 | yes / yes | 4.82 [4.64, 5.17] | 77 | 190 |
| scann | 0.99 | 503.4 | 6 | 0.9999 | yes / yes | 4.82 [4.64, 5.17] | 77 | 190 |
| scann | 0.995 | 503.4 | 6 | 0.9999 | yes / yes | 4.82 [4.64, 5.17] | 77 | 190 |
| usearch_b1_rescore | 0.98 | 164.3 | 6 | 0.9962 | yes / yes | 1.57 [1.43, 1.69] | 80 | 122 |
| usearch_b1_rescore | 0.99 | 164.3 | 6 | 0.9962 | yes / yes | 1.57 [1.43, 1.69] | 80 | 122 |
| usearch_b1_rescore | 0.995 | 189.2 | 6 | 0.9975 | yes / yes | 1.81 [1.64, 1.95] | 81 | 127 |
| usearch_f16 | 0.98 | 338.1 | 6 | 0.9932 | yes / yes | 3.24 [2.58, 3.50] | 39 | 54 |
| usearch_f16 | 0.99 | 347.9 | 6 | 0.9941 | yes / yes | 3.33 [2.74, 3.62] | 39 | 55 |
| usearch_f16 | 0.995 | 429.5 | 6 | 0.9979 | yes / yes | 4.11 [3.46, 4.46] | 42 | 66 |
| usearch_i8 | 0.98 | 111.1 | 6 | 0.9918 | yes / yes | 1.06 [0.93, 1.23] | 33 | 32 |
| usearch_i8 | 0.99 | 163.1 | 6 | 0.9928 | yes / no | 1.56 [1.38, 1.72] | 34 | 35 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 104.6 / 0.9995 | 158.2 / 0.9996 | 135.1 / 0.9997 | 189.4 / 0.9997 | 296.6 / 0.9998 | 193.1 / 0.9997 | 249.0 / 0.9997 | 573.8 / 0.9997 | 347.0 / 0.9999 | 404.8 / 0.9999 | 1387.5 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 158.0 / 0.9995 | 212.4 / 0.9996 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 1452.4 / 0.9999 | 1514.3 / 0.9999 | 2515.0 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 235.0 / 0.9995 | 290.0 / 0.9996 | 262.4 / 0.9997 | 316.9 / 0.9997 | 426.5 / 0.9998 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 3911.5 / 0.9999 | 3956.2 / 0.9999 | 4997.5 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 436.2 / 0.9997 | 492.5 / 0.9997 | 603.2 / 0.9998 | 490.2 / 0.9997 | 545.7 / 0.9997 | 874.2 / 0.9997 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 971.6 / 0.9997 | 1027.9 / 0.9997 | 1359.9 / 0.9997 |  |  |  |
| faiss_hnsw_flat | ef 100 | 542.2 / 0.9999 | 601.9 / 0.9999 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 2972.5 / 0.9999 | 2997.6 / 0.9999 | 4009.5 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 865.7 / 0.9999 | 934.2 / 0.9999 | 879.9 / 0.9999 | 959.1 / 0.9999 | 1083.2 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 5767.2 / 0.9999 | 5825.5 / 0.9999 | 6829.4 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 1407.1 / 0.9999 | 1473.1 / 0.9999 | 1588.5 / 1.0000 | 1485.7 / 0.9999 | 1534.7 / 0.9999 | 1873.6 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 2358.8 / 0.9999 | 2416.8 / 0.9999 | 2758.0 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 435.7 / 0.9999 | 489.6 / 0.9999 | 462.8 / 0.9999 | 516.5 / 0.9999 | 624.4 / 0.9999 | 513.2 / 0.9999 | 567.5 / 0.9999 | 892.2 / 1.0000 | 645.1 / 0.9999 | 698.7 / 0.9999 | 1678.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 |  |  |  |  |  | 278.2 / 0.9609 | 332.6 / 0.9609 | 660.6 / 0.9610 |  |  |  |
| faiss_rabitq_ivf | nprobe 16 |  |  | 246.2 / 0.9630 | 299.3 / 0.9630 | 408.3 / 0.9631 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 30 |  |  |  |  |  | 410.8 / 0.9854 | 466.8 / 0.9854 | 797.1 / 0.9855 |  |  |  |
| faiss_rabitq_ivf | nprobe 36 |  |  |  |  |  |  |  |  | 601.7 / 0.9896 | 658.1 / 0.9896 | 1646.3 / 0.9897 |
| faiss_rabitq_ivf | nprobe 4 | 121.4 / 0.8315 | 173.1 / 0.8315 |  |  |  |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 72 |  |  |  |  |  |  |  |  | 920.6 / 0.9994 | 976.6 / 0.9994 | 1965.0 / 0.9995 |
| faiss_rabitq_ivf | nprobe 8 | 156.1 / 0.9163 | 210.7 / 0.9165 | 173.7 / 0.9163 | 228.6 / 0.9163 | 335.3 / 0.9164 |  |  |  |  |  |  |
| hnswlib_f32 | ef 100 | 1528.9 / 0.9999 | 1582.8 / 0.9999 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 4903.2 / 0.9999 | 4954.3 / 0.9999 | 5951.9 / 1.0000 |
| hnswlib_f32 | ef 200 | 2375.8 / 0.9999 | 2429.7 / 0.9999 | 2399.4 / 0.9999 | 2457.8 / 0.9999 | 2561.6 / 1.0000 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 5554.8 / 0.9999 | 5598.0 / 0.9999 | 6626.1 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 3458.0 / 0.9999 | 3502.7 / 0.9999 | 3624.5 / 1.0000 | 3489.0 / 0.9999 | 3550.8 / 0.9999 | 3881.9 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 4509.4 / 0.9999 | 4560.5 / 0.9999 | 4904.5 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 76.7 / 0.9995 | 95.5 / 0.9996 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 147.8 / 0.9999 | 172.7 / 0.9999 | 608.6 / 1.0000 |
| ours_scan | ef 200 |  |  | 88.3 / 0.9997 | 106.1 / 0.9997 | 147.3 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 106.8 / 0.9997 | 128.9 / 0.9997 | 263.2 / 0.9997 |  |  |  |
| ours_walk | ef 100 | 89.1 / 0.9995 | 110.9 / 0.9996 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 224.9 / 0.9999 | 248.1 / 0.9999 | 688.8 / 1.0000 |
| ours_walk | ef 200 | 97.7 / 0.9995 | 118.9 / 0.9996 | 109.6 / 0.9997 | 130.0 / 0.9997 | 172.7 / 0.9998 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 281.7 / 0.9999 | 302.7 / 0.9999 | 739.0 / 1.0000 |
| ours_walk | ef 400 |  |  | 119.3 / 0.9997 | 141.3 / 0.9997 | 186.9 / 0.9998 | 140.0 / 0.9997 | 162.8 / 0.9997 | 306.9 / 0.9997 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 162.0 / 0.9997 | 184.3 / 0.9997 | 323.9 / 0.9997 |  |  |  |
| scann | reorder 100 | 598.9 / 0.9999 | 657.4 / 0.9999 |  |  |  |  |  |  |  |  |  |
| scann | reorder 1000 |  |  |  |  |  |  |  |  | 781.0 / 0.9999 | 838.8 / 0.9999 | 1956.7 / 1.0000 |
| scann | reorder 200 |  |  | 626.2 / 0.9999 | 679.7 / 0.9999 | 794.1 / 1.0000 |  |  |  |  |  |  |
| scann | reorder 400 |  |  |  |  |  | 667.0 / 0.9999 | 722.3 / 0.9999 | 1073.0 / 1.0000 |  |  |  |
| usearch_b1_rescore | ef 100 | 145.5 / 0.9960 | 200.7 / 0.9960 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 717.4 / 0.9962 | 775.7 / 0.9962 | 1831.8 / 0.9963 |
| usearch_b1_rescore | ef 200 | 205.4 / 0.9960 | 261.8 / 0.9960 | 218.2 / 0.9962 | 274.8 / 0.9962 | 384.9 / 0.9963 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 1214.2 / 0.9962 | 1276.6 / 0.9962 | 2399.1 / 0.9963 |
| usearch_b1_rescore | ef 400 |  |  | 321.8 / 0.9962 | 376.2 / 0.9962 | 489.9 / 0.9963 | 343.7 / 0.9962 | 404.9 / 0.9962 | 741.6 / 0.9963 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 533.0 / 0.9962 | 591.4 / 0.9962 | 935.5 / 0.9963 |  |  |  |

### quora / CodeRankEmbed (n_ho = 4000, exact quality 0.8569)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 1354.3 | 6 | 0.9882 | yes / yes | 7.56 [0.10, 9.57] | 1602 | 8415 |
| faiss_bin_flat | 0.99 | 1393.2 | 6 | 0.9959 | yes / yes | 7.77 [0.10, 9.68] | 1602 | 8430 |
| faiss_bin_flat | 0.995 | 1419.2 | 6 | 0.9986 | yes / yes | 5.22 [0.19, 6.54] | 1602 | 8411 |
| faiss_bin_hnsw | 0.98 | 179.1 | 6 | 0.9847 | yes / yes | 1.00 [0.01, 1.16] | 1764 | 8849 |
| faiss_bin_hnsw | 0.99 | 278.7 | 6 | 0.9920 | yes / no | 1.56 [0.02, 1.82] | 1892 | 9272 |
| faiss_bin_hnsw | 0.995 | 500.3 | 6 | 0.9963 | yes / no | 1.84 [0.07, 2.20] | 1892 | 9269 |
| faiss_exact | 0.98 | 61215.2 | 6 | 1.0001 | yes / yes | 341.61 [4.63, 415.18] | 1571 | 4830 |
| faiss_exact | 0.99 | 61215.2 | 6 | 1.0001 | yes / yes | 341.61 [4.63, 415.18] | 1571 | 4830 |
| faiss_exact | 0.995 | 61215.2 | 6 | 1.0001 | yes / yes | 224.96 [8.21, 279.20] | 1571 | 4830 |
| faiss_hnsw_flat | 0.98 | 382.1 | 6 | 0.9833 | yes / no | 2.13 [0.03, 2.48] | 1643 | 5007 |
| faiss_hnsw_flat | 0.99 | 681.6 | 6 | 0.9936 | yes / yes | 3.80 [0.05, 4.42] | 1707 | 5225 |
| faiss_hnsw_flat | 0.995 | 1253.7 | 6 | 0.9980 | yes / yes | 4.61 [0.17, 5.51] | 1707 | 5239 |
| faiss_hnsw_sq8 | 0.98 | 547.9 | 6 | 0.9826 | yes / no | 3.06 [0.04, 3.53] | 2052 | 9773 |
| faiss_hnsw_sq8 | 0.99 | 885.4 | 6 | 0.9923 | yes / no | 4.94 [0.06, 5.70] | 2243 | 10366 |
| faiss_hnsw_sq8 | 0.995 | 1565.5 | 6 | 0.9974 | yes / yes | 5.75 [0.21, 6.86] | 2243 | 10378 |
| faiss_ivfpq_fs | 0.98 | 953.8 | 6 | 0.9879 | yes / yes | 5.32 [0.07, 6.66] | 1649 | 8534 |
| faiss_ivfpq_fs | 0.99 | 1593.5 | 6 | 0.9949 | yes / yes | 8.89 [0.12, 10.76] | 1649 | 8531 |
| faiss_ivfpq_fs | 0.995 | 2670.3 | 6 | 0.9979 | yes / yes | 9.81 [0.37, 11.84] | 1637 | 8528 |
| faiss_rabitq_flat | 0.98 | 24869.3 | 6 | 1.0000 | yes / yes | 138.78 [1.81, 161.39] | 1654 | 8507 |
| faiss_rabitq_flat | 0.99 | 24869.3 | 6 | 1.0000 | yes / yes | 138.78 [1.81, 161.39] | 1654 | 8507 |
| faiss_rabitq_flat | 0.995 | 24869.3 | 6 | 1.0000 | yes / yes | 91.39 [3.48, 109.22] | 1654 | 8507 |
| faiss_rabitq_hnsw | 0.98 | 333.9 | 6 | 0.9838 | yes / no | 1.86 [0.02, 2.17] | 1912 | 9329 |
| faiss_rabitq_hnsw | 0.99 | 569.1 | 6 | 0.9941 | yes / yes | 3.18 [0.04, 3.69] | 1912 | 9332 |
| faiss_rabitq_hnsw | 0.995 | 1020.9 | 6 | 0.9980 | yes / yes | 3.75 [0.13, 4.48] | 1912 | 9331 |
| faiss_rabitq_ivf | 0.98 | 4068.6 | 6 | 0.9881 | yes / yes | 22.70 [0.30, 26.21] | 1636 | 8537 |
| faiss_rabitq_ivf | 0.99 | 7647.5 | 6 | 0.9951 | yes / yes | 42.68 [0.56, 49.40] | 1636 | 8562 |
| faiss_rabitq_ivf | 0.995 | 14677.2 | 6 | 0.9986 | yes / yes | 53.94 [2.03, 64.29] | 1636 | 8581 |
| hnswlib_f32 | 0.98 | 1013.2 | 6 | 0.9818 | yes / no | 5.65 [0.07, 6.54] | 1698 | 4904 |
| hnswlib_f32 | 0.99 | 1796.3 | 6 | 0.9909 | yes / no | 10.02 [0.13, 11.61] | 1698 | 4884 |
| hnswlib_f32 | 0.995 | 3115.9 | 6 | 0.9965 | yes / no | 11.45 [0.42, 13.68] | 1889 | 5445 |
| ours_cascade | 0.98 | 179.2 | 6 | 0.9926 | yes / yes |  | 1995 | 1479 |
| ours_cascade | 0.99 | 179.2 | 6 | 0.9926 | yes / no |  | 1995 | 1479 |
| ours_cascade | 0.995 | 272.1 | 6 | 0.9982 | yes / yes |  | 1997 | 1541 |
| scann | 0.98 | 603.9 | 6 | 0.9873 | yes / yes | 3.37 [0.04, 3.92] | 1822 | 8037 |
| scann | 0.99 | 1472.3 | 6 | 0.9954 | yes / yes | 8.22 [0.11, 9.56] | 1806 | 7844 |
| scann | 0.995 | 1537.2 | 6 | 0.9965 | yes / no | 5.65 [0.21, 6.75] | 1822 | 7890 |
| usearch_b1_rescore | 0.98 | 263.2 | 6 | 0.9821 | yes / no | 1.47 [0.02, 1.74] | 1795 | 8875 |
| usearch_b1_rescore | 0.99 | 440.4 | 6 | 0.9905 | yes / no | 2.46 [0.03, 2.92] | 1923 | 9283 |
| usearch_b1_rescore | 0.995 | 1137.8 | 6 | 0.9984 | yes / yes | 4.18 [0.14, 5.00] | 1795 | 8896 |
| usearch_f16 | 0.98 | 724.5 | 6 | 0.9838 | yes / no | 4.04 [0.05, 4.85] | 931 | 3500 |
| usearch_f16 | 0.99 | 1262.1 | 6 | 0.9893 | no / no | 7.04 [0.09, 8.44] | 1123 | 4074 |
| usearch_f16 | 0.995 | 1919.4 | 6 | 0.9967 | yes / no | 7.05 [0.24, 8.52] | 1123 | 4080 |
| usearch_i8 | 0.98 | 458.5 | 6 | 0.9821 | yes / no | 2.56 [0.03, 3.16] | 740 | 2466 |
| usearch_i8 | 0.99 | 663.4 | 6 | 0.9908 | yes / no | 3.70 [0.05, 4.56] | 611 | 2075 |
| usearch_i8 | 0.995 | 1548.0 | 6 | 0.9985 | yes / yes | 5.69 [0.19, 7.06] | 611 | 2079 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 1330.2 / 0.9995 | 1560.7 / 0.9995 | 1600.4 / 0.9998 | 1630.7 / 0.9998 | 1754.9 / 0.9998 | 1616.2 / 1.0000 | 1645.3 / 1.0000 | 2016.9 / 1.0000 | 1935.6 / 1.0000 | 2011.2 / 1.0000 | 3137.7 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 323.3 / 0.9944 | 399.0 / 0.9944 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 3202.6 / 1.0000 | 3167.0 / 1.0000 | 4295.3 / 1.0000 |
| faiss_bin_hnsw | ef 200 | 515.0 / 0.9978 | 631.2 / 0.9978 | 619.6 / 0.9981 | 668.3 / 0.9981 | 794.6 / 0.9981 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 7254.9 / 1.0000 | 7342.4 / 1.0000 | 8387.3 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 1114.4 / 0.9997 | 1174.9 / 0.9997 | 1291.2 / 0.9997 | 1162.7 / 0.9999 | 1260.2 / 0.9999 | 1580.3 / 0.9999 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2296.4 / 0.9999 | 2306.6 / 0.9999 | 2754.9 / 0.9999 |  |  |  |
| faiss_hnsw_flat | ef 100 | 1028.2 / 0.9971 | 1126.6 / 0.9971 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 8877.1 / 0.9999 | 8754.5 / 0.9999 | 10075.0 / 0.9999 |
| faiss_hnsw_flat | ef 200 | 1842.9 / 0.9989 | 1990.5 / 0.9989 | 2014.0 / 0.9989 | 2029.5 / 0.9989 | 2151.4 / 0.9989 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 17662.6 / 1.0000 | 17729.5 / 1.0000 | 18662.7 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 3696.2 / 0.9998 | 3686.1 / 0.9998 | 3844.8 / 0.9998 | 3652.2 / 0.9998 | 3833.5 / 0.9998 | 4108.1 / 0.9998 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 6885.6 / 0.9999 | 6785.5 / 0.9999 | 7417.0 / 0.9999 |  |  |  |
| faiss_rabitq_flat | exhaustive | 25652.6 / 1.0000 | 25724.5 / 1.0000 | 25723.5 / 1.0000 | 25780.4 / 1.0000 | 25886.5 / 1.0000 | 25804.0 / 1.0000 | 25868.8 / 1.0000 | 26215.8 / 1.0000 | 26102.4 / 1.0000 | 26163.5 / 1.0000 | 27249.1 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 189.8 / 0.6616 | 250.8 / 0.6616 | 219.8 / 0.6616 | 278.6 / 0.6616 | 393.7 / 0.6616 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 898.7 / 0.9236 | 959.9 / 0.9236 | 2039.1 / 0.9236 |
| faiss_rabitq_ivf | nprobe 2 | 241.2 / 0.7934 | 302.4 / 0.7934 | 274.1 / 0.7934 | 331.7 / 0.7934 | 449.5 / 0.7934 | 322.6 / 0.7934 | 379.2 / 0.7934 | 726.7 / 0.7934 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 427.2 / 0.8749 | 483.7 / 0.8749 | 832.1 / 0.8749 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 644.4 / 0.8907 | 704.9 / 0.8907 | 1786.8 / 0.8907 |
| hnswlib_f32 | ef 100 | 2713.9 / 0.9977 | 2915.1 / 0.9977 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 21413.3 / 0.9999 | 21393.0 / 0.9999 | 22573.9 / 0.9999 |
| hnswlib_f32 | ef 200 | 4970.3 / 0.9991 | 5240.5 / 0.9991 | 5241.0 / 0.9991 | 5260.6 / 0.9991 | 5391.2 / 0.9991 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 38605.7 / 1.0000 | 38904.2 / 1.0000 | 39820.3 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 9633.6 / 0.9995 | 9676.5 / 0.9995 | 9754.8 / 0.9995 | 9506.1 / 0.9995 | 9566.8 / 0.9995 | 9977.6 / 0.9995 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 17396.5 / 0.9998 | 17330.7 / 0.9998 | 17906.1 / 0.9998 |  |  |  |
| ours_scan | ef 100 | 182.2 / 0.9972 | 202.3 / 0.9972 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 881.4 / 0.9998 | 905.7 / 0.9998 | 1418.7 / 0.9998 |
| ours_scan | ef 200 |  |  | 283.8 / 0.9988 | 309.3 / 0.9988 | 368.7 / 0.9988 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 445.6 / 0.9996 | 468.2 / 0.9996 | 635.4 / 0.9996 |  |  |  |
| ours_walk | ef 100 | 178.7 / 0.9972 | 201.2 / 0.9972 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 886.4 / 0.9998 | 911.3 / 0.9998 | 1410.9 / 0.9998 |
| ours_walk | ef 200 | 248.0 / 0.9983 | 260.0 / 0.9983 | 284.9 / 0.9988 | 305.7 / 0.9988 | 365.0 / 0.9988 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 1326.7 / 0.9999 | 1325.6 / 0.9999 | 1859.3 / 0.9999 |
| ours_walk | ef 400 |  |  | 424.5 / 0.9994 | 446.3 / 0.9994 | 508.0 / 0.9994 | 445.4 / 0.9996 | 469.3 / 0.9996 | 632.3 / 0.9996 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 669.1 / 0.9998 | 688.6 / 0.9998 | 864.8 / 0.9998 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 206.4 / 0.5556 | 269.7 / 0.5556 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 258.3 / 0.5556 | 317.4 / 0.5556 | 437.0 / 0.5556 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 767.4 / 0.8876 | 837.7 / 0.8876 | 1947.9 / 0.8876 |
| scann | leaves_to_search 2, reorder 100 | 222.4 / 0.6947 | 287.8 / 0.6947 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 280.2 / 0.6947 | 343.4 / 0.6947 | 458.6 / 0.6947 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 371.5 / 0.6947 | 429.7 / 0.6947 | 792.5 / 0.6947 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 400.8 / 0.7980 | 457.1 / 0.7980 | 820.3 / 0.7980 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 704.6 / 0.8252 | 772.2 / 0.8252 | 1880.9 / 0.8252 |
| usearch_b1_rescore | ef 100 | 434.9 / 0.9928 | 563.2 / 0.9928 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 4090.2 / 0.9995 | 4257.5 / 0.9995 | 5353.8 / 0.9995 |
| usearch_b1_rescore | ef 200 | 803.5 / 0.9974 | 968.3 / 0.9974 | 926.2 / 0.9979 | 984.2 / 0.9979 | 1097.4 / 0.9979 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 8298.7 / 0.9995 | 8397.7 / 0.9995 | 9598.7 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 1718.7 / 0.9987 | 1751.7 / 0.9987 | 1899.2 / 0.9987 | 1682.3 / 0.9989 | 1620.1 / 0.9989 | 2146.0 / 0.9989 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 3250.5 / 0.9994 | 3170.0 / 0.9994 | 3652.2 / 0.9994 |  |  |  |

### quora / bge-base-en-v1.5 (n_ho = 4000, exact quality 0.8914)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 1404.0 | 6 | 0.9915 | yes / yes | 9.10 [1.38, 10.71] | 1602 | 8497 |
| faiss_bin_flat | 0.99 | 1423.7 | 6 | 0.9976 | yes / yes | 9.22 [1.38, 10.60] | 1602 | 8491 |
| faiss_bin_flat | 0.995 | 1423.7 | 6 | 0.9976 | yes / yes | 9.22 [1.38, 10.60] | 1602 | 8491 |
| faiss_bin_hnsw | 0.98 | 87.4 | 6 | 0.9834 | yes / no | 0.57 [0.09, 0.61] | 1764 | 8969 |
| faiss_bin_hnsw | 0.99 | 115.5 | 6 | 0.9944 | yes / yes | 0.75 [0.11, 0.81] | 1764 | 8946 |
| faiss_bin_hnsw | 0.995 | 163.6 | 6 | 0.9975 | yes / yes | 1.06 [0.16, 1.15] | 1764 | 8940 |
| faiss_exact | 0.98 | 62310.9 | 6 | 1.0000 | yes / yes | 403.71 [61.18, 467.56] | 1571 | 4849 |
| faiss_exact | 0.99 | 62310.9 | 6 | 1.0000 | yes / yes | 403.71 [61.18, 467.56] | 1571 | 4849 |
| faiss_exact | 0.995 | 62310.9 | 6 | 1.0000 | yes / yes | 403.71 [61.18, 467.56] | 1571 | 4849 |
| faiss_hnsw_flat | 0.98 | 136.0 | 6 | 0.9875 | yes / yes | 0.88 [0.13, 0.99] | 1643 | 5031 |
| faiss_hnsw_flat | 0.99 | 200.2 | 6 | 0.9949 | yes / yes | 1.30 [0.19, 1.44] | 1643 | 5031 |
| faiss_hnsw_flat | 0.995 | 258.4 | 6 | 0.9968 | yes / no | 1.67 [0.25, 1.84] | 1707 | 5215 |
| faiss_hnsw_sq8 | 0.98 | 188.4 | 6 | 0.9825 | yes / no | 1.22 [0.19, 1.30] | 2052 | 9840 |
| faiss_hnsw_sq8 | 0.99 | 290.1 | 6 | 0.9932 | yes / yes | 1.88 [0.29, 2.01] | 2052 | 9838 |
| faiss_hnsw_sq8 | 0.995 | 374.3 | 6 | 0.9967 | yes / no | 2.43 [0.37, 2.58] | 2116 | 10031 |
| faiss_ivfpq_fs | 0.98 | 224.3 | 6 | 0.9938 | yes / yes | 1.45 [0.22, 1.60] | 1637 | 8585 |
| faiss_ivfpq_fs | 0.99 | 334.1 | 6 | 0.9973 | yes / yes | 2.16 [0.33, 2.43] | 1637 | 8583 |
| faiss_ivfpq_fs | 0.995 | 556.2 | 6 | 0.9992 | yes / yes | 3.60 [0.54, 4.14] | 1637 | 8587 |
| faiss_rabitq_flat | 0.98 | 24874.9 | 6 | 0.9995 | yes / yes | 161.16 [24.91, 171.33] | 1654 | 8616 |
| faiss_rabitq_flat | 0.99 | 24874.9 | 6 | 0.9995 | yes / yes | 161.16 [24.91, 171.33] | 1654 | 8616 |
| faiss_rabitq_flat | 0.995 | 24874.9 | 6 | 0.9995 | yes / yes | 161.16 [24.91, 171.33] | 1654 | 8616 |
| faiss_rabitq_hnsw | 0.98 | 178.3 | 6 | 0.9896 | yes / yes | 1.16 [0.18, 1.26] | 1912 | 9408 |
| faiss_rabitq_hnsw | 0.99 | 178.3 | 6 | 0.9896 | no / no | 1.16 [0.18, 1.26] | 1912 | 9408 |
| faiss_rabitq_hnsw | 0.995 | 270.8 | 6 | 0.9959 | yes / no | 1.75 [0.27, 1.90] | 1912 | 9404 |
| faiss_rabitq_ivf | 0.98 | 504.9 | 6 | 0.9884 | yes / yes | 3.27 [0.50, 4.04] | 1636 | 8564 |
| faiss_rabitq_ivf | 0.99 | 1221.4 | 6 | 0.9969 | yes / yes | 7.91 [1.21, 8.72] | 1636 | 8594 |
| faiss_rabitq_ivf | 0.995 | 2108.6 | 6 | 0.9983 | yes / yes | 13.66 [2.11, 14.64] | 1636 | 8612 |
| hnswlib_f32 | 0.98 | 356.3 | 6 | 0.9852 | yes / yes | 2.31 [0.35, 2.48] | 1698 | 4907 |
| hnswlib_f32 | 0.99 | 560.7 | 6 | 0.9942 | yes / yes | 3.63 [0.55, 3.88] | 1698 | 4899 |
| hnswlib_f32 | 0.995 | 810.1 | 6 | 0.9972 | yes / yes | 5.25 [0.81, 5.63] | 1889 | 5442 |
| ours_cascade | 0.98 | 154.3 | 6 | 0.9983 | yes / yes |  | 1995 | 1483 |
| ours_cascade | 0.99 | 154.3 | 6 | 0.9983 | yes / yes |  | 1995 | 1483 |
| ours_cascade | 0.995 | 154.3 | 6 | 0.9983 | yes / yes |  | 1995 | 1483 |
| scann | 0.98 | 275.1 | 6 | 0.9909 | yes / yes | 1.78 [0.28, 1.92] | 1802 | 7843 |
| scann | 0.99 | 324.2 | 6 | 0.9965 | yes / yes | 2.10 [0.32, 2.26] | 1818 | 7880 |
| scann | 0.995 | 533.1 | 6 | 0.9986 | yes / yes | 3.45 [0.53, 3.70] | 1802 | 7939 |
| usearch_b1_rescore | 0.98 | 161.5 | 6 | 0.9941 | yes / yes | 1.05 [0.16, 1.20] | 1731 | 8746 |
| usearch_b1_rescore | 0.99 | 181.5 | 6 | 0.9929 | yes / yes | 1.18 [0.18, 1.34] | 1731 | 8752 |
| usearch_b1_rescore | 0.995 | 248.5 | 6 | 0.9973 | yes / yes | 1.61 [0.25, 1.85] | 1795 | 8964 |
| usearch_f16 | 0.98 | 230.2 | 6 | 0.9839 | yes / no | 1.49 [0.23, 1.70] | 931 | 3509 |
| usearch_f16 | 0.99 | 365.7 | 6 | 0.9937 | yes / yes | 2.37 [0.37, 2.67] | 1123 | 4107 |
| usearch_f16 | 0.995 | 579.9 | 6 | 0.9965 | yes / no | 3.76 [0.58, 4.32] | 1123 | 4103 |
| usearch_i8 | 0.98 | 147.7 | 6 | 0.9853 | yes / yes | 0.96 [0.14, 1.13] | 548 | 1889 |
| usearch_i8 | 0.99 | 229.9 | 6 | 0.9911 | yes / no | 1.49 [0.22, 1.74] | 740 | 2478 |
| usearch_i8 | 0.995 | 399.7 | 6 | 0.9958 | yes / no | 2.59 [0.39, 3.10] | 611 | 2091 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 1551.4 / 0.9996 | 1519.4 / 0.9996 | 1611.9 / 0.9998 | 1575.1 / 0.9998 | 1744.5 / 0.9998 | 1731.7 / 0.9999 | 1735.0 / 0.9999 | 2095.7 / 0.9999 | 1996.6 / 0.9999 | 2057.3 / 0.9999 | 3133.3 / 0.9999 |
| faiss_bin_hnsw | ef 100 | 326.6 / 0.9991 | 382.0 / 0.9991 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2965.2 / 0.9999 | 3017.4 / 0.9999 | 4110.1 / 0.9999 |
| faiss_bin_hnsw | ef 200 | 544.0 / 0.9996 | 596.7 / 0.9996 | 575.8 / 0.9998 | 631.8 / 0.9998 | 747.5 / 0.9998 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 6753.8 / 0.9999 | 6838.3 / 0.9999 | 7902.0 / 0.9999 |
| faiss_bin_hnsw | ef 400 |  |  | 1034.3 / 0.9998 | 1080.9 / 0.9998 | 1202.7 / 0.9998 | 1094.2 / 0.9999 | 1179.7 / 0.9999 | 1519.7 / 0.9999 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 2125.5 / 0.9999 | 2211.3 / 0.9999 | 2559.2 / 0.9999 |  |  |  |
| faiss_hnsw_flat | ef 100 | 884.2 / 1.0001 | 947.9 / 1.0001 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 7030.2 / 1.0000 | 7100.0 / 1.0000 | 8225.4 / 1.0000 |
| faiss_hnsw_flat | ef 200 | 1585.7 / 1.0000 | 1616.9 / 1.0000 | 1605.0 / 1.0000 | 1644.1 / 1.0000 | 1763.7 / 1.0000 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 14128.4 / 1.0000 | 14215.6 / 1.0000 | 15100.3 / 1.0000 |
| faiss_hnsw_flat | ef 400 |  |  | 2974.4 / 1.0000 | 2949.8 / 1.0000 | 3066.6 / 1.0000 | 2929.6 / 1.0000 | 3078.0 / 1.0000 | 3392.2 / 1.0000 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 5495.2 / 1.0000 | 5566.2 / 1.0000 | 5922.9 / 1.0000 |  |  |  |
| faiss_rabitq_flat | exhaustive | 25668.7 / 1.0000 | 25726.0 / 1.0000 | 25720.3 / 1.0000 | 25778.6 / 1.0000 | 25895.9 / 1.0000 | 25818.8 / 1.0000 | 25876.0 / 1.0000 | 26225.0 / 1.0000 | 26114.8 / 1.0000 | 26185.6 / 1.0000 | 27226.7 / 1.0000 |
| faiss_rabitq_ivf | nprobe 1 | 190.5 / 0.7587 | 247.6 / 0.7587 | 216.7 / 0.7587 | 274.4 / 0.7587 | 391.5 / 0.7587 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 858.4 / 0.9873 | 921.7 / 0.9873 | 1983.6 / 0.9873 |
| faiss_rabitq_ivf | nprobe 2 | 236.5 / 0.9018 | 294.0 / 0.9018 | 265.8 / 0.9018 | 322.7 / 0.9018 | 441.0 / 0.9018 | 317.5 / 0.9018 | 376.9 / 0.9018 | 732.2 / 0.9018 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 413.1 / 0.9616 | 471.0 / 0.9616 | 828.1 / 0.9616 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 630.7 / 0.9709 | 693.5 / 0.9709 | 1770.6 / 0.9709 |
| hnswlib_f32 | ef 100 | 2374.5 / 0.9998 | 2429.1 / 0.9998 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 16195.3 / 1.0000 | 16377.5 / 1.0000 | 17373.5 / 1.0000 |
| hnswlib_f32 | ef 200 | 4199.4 / 0.9997 | 4231.9 / 0.9997 | 4219.6 / 0.9997 | 4257.6 / 0.9997 | 4363.0 / 0.9997 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 28464.7 / 1.0000 | 28596.7 / 1.0000 | 29356.7 / 1.0000 |
| hnswlib_f32 | ef 400 |  |  | 7534.2 / 1.0000 | 7479.8 / 1.0000 | 7658.2 / 1.0000 | 7482.5 / 1.0000 | 7630.8 / 1.0000 | 7940.8 / 1.0000 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 13289.5 / 1.0000 | 13343.2 / 1.0000 | 13683.5 / 1.0000 |  |  |  |
| ours_scan | ef 100 | 160.0 / 0.9993 | 186.7 / 0.9993 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 636.9 / 0.9999 | 677.4 / 0.9999 | 1150.2 / 0.9999 |
| ours_scan | ef 200 |  |  | 229.4 / 0.9998 | 251.6 / 0.9998 | 308.2 / 0.9998 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 344.1 / 0.9999 | 370.4 / 0.9999 | 525.4 / 0.9999 |  |  |  |
| ours_walk | ef 100 | 158.0 / 0.9993 | 183.9 / 0.9993 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 633.6 / 0.9999 | 666.3 / 0.9999 | 1144.5 / 0.9999 |
| ours_walk | ef 200 | 210.0 / 0.9996 | 233.3 / 0.9996 | 228.2 / 0.9998 | 251.2 / 0.9998 | 307.1 / 0.9998 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 897.2 / 0.9999 | 943.5 / 0.9999 | 1428.8 / 0.9999 |
| ours_walk | ef 400 |  |  | 309.4 / 0.9999 | 332.5 / 0.9999 | 388.9 / 0.9999 | 341.3 / 0.9999 | 369.5 / 0.9999 | 519.5 / 0.9999 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 484.1 / 0.9999 | 508.3 / 0.9999 | 662.3 / 0.9999 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 213.6 / 0.7010 | 272.9 / 0.7010 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 265.1 / 0.7010 | 322.0 / 0.7010 | 442.8 / 0.7010 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 794.3 / 0.9755 | 860.4 / 0.9755 | 1940.3 / 0.9755 |
| scann | leaves_to_search 2, reorder 100 | 231.5 / 0.8422 | 289.3 / 0.8422 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 285.9 / 0.8422 | 342.5 / 0.8422 | 467.6 / 0.8422 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 385.0 / 0.8422 | 444.9 / 0.8422 | 807.0 / 0.8422 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 415.2 / 0.9306 | 474.5 / 0.9306 | 838.9 / 0.9306 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 726.6 / 0.9472 | 798.8 / 0.9472 | 1881.4 / 0.9472 |
| usearch_b1_rescore | ef 100 | 475.3 / 0.9983 | 527.4 / 0.9983 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 3599.8 / 0.9991 | 3738.1 / 0.9991 | 4829.5 / 0.9991 |
| usearch_b1_rescore | ef 200 | 821.1 / 0.9986 | 852.2 / 0.9986 | 840.4 / 0.9987 | 884.2 / 0.9987 | 993.3 / 0.9987 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 7058.9 / 0.9991 | 7148.6 / 0.9991 | 8016.8 / 0.9991 |
| usearch_b1_rescore | ef 400 |  |  | 1517.7 / 0.9990 | 1502.6 / 0.9990 | 1670.3 / 0.9990 | 1521.5 / 0.9991 | 1613.2 / 0.9991 | 1943.6 / 0.9991 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2840.9 / 0.9991 | 2902.8 / 0.9991 | 3251.9 / 0.9991 |  |  |  |

### quora / jina-v2-base-code (n_ho = 4000, exact quality 0.7004)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 1362.9 | 6 | 0.9923 | yes / yes | 9.58 [0.08, 11.53] | 1602 | 8471 |
| faiss_bin_flat | 0.99 | 1388.6 | 6 | 0.9974 | yes / yes | 8.22 [0.06, 9.78] | 1602 | 8488 |
| faiss_bin_flat | 0.995 | 1435.4 | 6 | 0.9985 | yes / yes | 4.47 [0.05, 5.30] | 1602 | 8466 |
| faiss_bin_hnsw | 0.98 | 163.1 | 6 | 0.9827 | yes / no | 1.15 [0.01, 1.28] | 1892 | 9338 |
| faiss_bin_hnsw | 0.99 | 340.4 | 6 | 0.9939 | yes / yes | 2.02 [0.02, 2.22] | 1892 | 9342 |
| faiss_bin_hnsw | 0.995 | 722.7 | 6 | 0.9978 | yes / yes | 2.25 [0.03, 2.52] | 1892 | 9350 |
| faiss_exact | 0.98 | 61172.3 | 6 | 1.0000 | yes / yes | 430.00 [3.49, 502.99] | 1571 | 4850 |
| faiss_exact | 0.99 | 61172.3 | 6 | 1.0000 | yes / yes | 362.16 [2.81, 420.96] | 1571 | 4850 |
| faiss_exact | 0.995 | 61172.3 | 6 | 1.0000 | yes / yes | 190.30 [2.21, 222.08] | 1571 | 4850 |
| faiss_hnsw_flat | 0.98 | 336.6 | 6 | 0.9863 | yes / yes | 2.37 [0.02, 2.67] | 1835 | 5644 |
| faiss_hnsw_flat | 0.99 | 580.1 | 6 | 0.9946 | yes / yes | 3.43 [0.03, 3.80] | 1835 | 5638 |
| faiss_hnsw_flat | 0.995 | 1022.5 | 6 | 0.9979 | yes / yes | 3.18 [0.04, 3.69] | 1835 | 5641 |
| faiss_hnsw_sq8 | 0.98 | 494.3 | 6 | 0.9865 | yes / yes | 3.47 [0.03, 3.85] | 2243 | 10501 |
| faiss_hnsw_sq8 | 0.99 | 829.9 | 6 | 0.9948 | yes / yes | 4.91 [0.04, 5.38] | 2243 | 10461 |
| faiss_hnsw_sq8 | 0.995 | 1461.0 | 6 | 0.9979 | yes / yes | 4.55 [0.05, 5.09] | 2243 | 10438 |
| faiss_ivfpq_fs | 0.98 | 753.1 | 6 | 0.9854 | yes / yes | 5.29 [0.04, 6.50] | 1650 | 8590 |
| faiss_ivfpq_fs | 0.99 | 1261.1 | 6 | 0.9935 | yes / yes | 7.47 [0.06, 8.69] | 1637 | 8572 |
| faiss_rabitq_flat | 0.98 | 24865.3 | 6 | 0.9979 | yes / yes | 174.79 [1.42, 193.70] | 1654 | 8602 |
| faiss_rabitq_flat | 0.99 | 24865.3 | 6 | 0.9979 | yes / yes | 147.21 [1.15, 161.14] | 1654 | 8602 |
| faiss_rabitq_flat | 0.995 | 24865.3 | 6 | 0.9979 | yes / yes | 77.36 [0.90, 86.33] | 1654 | 8602 |
| faiss_rabitq_hnsw | 0.98 | 424.3 | 6 | 0.9830 | yes / no | 2.98 [0.02, 3.32] | 1912 | 9379 |
| faiss_rabitq_hnsw | 0.99 | 746.8 | 6 | 0.9905 | yes / no | 4.42 [0.03, 4.85] | 1912 | 9373 |
| faiss_rabitq_hnsw | 0.995 | 1436.2 | 6 | 0.9947 | no / no | 4.47 [0.05, 5.02] | 1912 | 9379 |
| faiss_rabitq_ivf | 0.98 | 2348.8 | 6 | 0.9889 | yes / yes | 16.51 [0.13, 18.37] | 1636 | 8588 |
| faiss_rabitq_ivf | 0.99 | 4274.1 | 6 | 0.9948 | yes / yes | 25.30 [0.20, 27.70] | 1636 | 8581 |
| faiss_rabitq_ivf | 0.995 | 6095.5 | 6 | 0.9965 | yes / no | 18.96 [0.22, 21.16] | 1629 | 8583 |
| hnswlib_f32 | 0.98 | 910.3 | 6 | 0.9854 | yes / yes | 6.40 [0.05, 7.10] | 1698 | 4890 |
| hnswlib_f32 | 0.99 | 1600.9 | 6 | 0.9926 | yes / no | 9.48 [0.07, 10.42] | 1698 | 4898 |
| hnswlib_f32 | 0.995 | 2884.4 | 6 | 0.9969 | yes / no | 8.97 [0.10, 10.08] | 1698 | 4896 |
| ours_cascade | 0.98 | 142.3 | 6 | 0.9897 | yes / yes |  | 1997 | 1515 |
| ours_cascade | 0.99 | 168.9 | 6 | 0.9951 | yes / yes |  | 1996 | 1562 |
| ours_cascade | 0.995 | 321.4 | 6 | 0.9987 | yes / yes |  | 1996 | 1726 |
| scann | 0.98 | 1061.9 | 6 | 0.9816 | yes / no | 7.46 [0.06, 8.34] | 1733 | 6511 |
| scann | 0.99 | 1673.0 | 6 | 0.9959 | yes / yes | 9.90 [0.08, 10.88] | 1803 | 7931 |
| scann | 0.995 | 1700.2 | 6 | 0.9964 | yes / no | 5.29 [0.06, 5.98] | 1819 | 8094 |
| usearch_b1_rescore | 0.98 | 231.4 | 6 | 0.9823 | yes / no | 1.63 [0.01, 1.84] | 1795 | 8960 |
| usearch_b1_rescore | 0.99 | 654.2 | 6 | 0.9929 | yes / no | 3.87 [0.03, 4.32] | 1731 | 8780 |
| usearch_b1_rescore | 0.995 | 1059.1 | 6 | 0.9971 | yes / yes | 3.29 [0.04, 3.75] | 1923 | 9346 |
| usearch_f16 | 0.98 | 667.7 | 6 | 0.9864 | yes / yes | 4.69 [0.04, 5.21] | 931 | 3510 |
| usearch_f16 | 0.99 | 1188.2 | 6 | 0.9936 | yes / yes | 7.03 [0.05, 7.79] | 931 | 3510 |
| usearch_f16 | 0.995 | 2199.6 | 6 | 0.9960 | yes / no | 6.84 [0.08, 7.68] | 931 | 3506 |
| usearch_i8 | 0.98 | 376.9 | 6 | 0.9823 | yes / no | 2.65 [0.02, 2.98] | 611 | 2090 |
| usearch_i8 | 0.99 | 656.7 | 6 | 0.9905 | yes / no | 3.89 [0.03, 4.30] | 611 | 2089 |
| usearch_i8 | 0.995 | 1147.1 | 6 | 0.9943 | no / no | 3.57 [0.04, 4.02] | 611 | 2086 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 100 / H 50 | C 100 / H 100 | C 200 / H 50 | C 200 / H 100 | C 200 / H 200 | C 400 / H 50 | C 400 / H 100 | C 400 / H 400 | C 1000 / H 50 | C 1000 / H 100 | C 1000 / H 1000 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| faiss_bin_flat | exhaustive | 1512.3 / 0.9987 | 1570.0 / 0.9987 | 1600.4 / 0.9988 | 1585.4 / 0.9988 | 1782.1 / 0.9988 | 1631.4 / 0.9997 | 1732.1 / 0.9997 | 2085.8 / 0.9997 | 1923.3 / 1.0000 | 2042.3 / 1.0000 | 3103.9 / 1.0000 |
| faiss_bin_hnsw | ef 100 | 293.4 / 0.9928 | 350.7 / 0.9928 |  |  |  |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 1000 |  |  |  |  |  |  |  |  | 2657.0 / 0.9995 | 2745.2 / 0.9995 | 3754.2 / 0.9995 |
| faiss_bin_hnsw | ef 200 | 482.5 / 0.9963 | 537.8 / 0.9963 | 514.2 / 0.9965 | 572.4 / 0.9965 | 695.9 / 0.9965 |  |  |  |  |  |  |
| faiss_bin_hnsw | ef 2000 |  |  |  |  |  |  |  |  | 6196.4 / 1.0000 | 6263.9 / 1.0000 | 7284.1 / 1.0000 |
| faiss_bin_hnsw | ef 400 |  |  | 919.7 / 0.9974 | 974.8 / 0.9974 | 1104.8 / 0.9974 | 967.3 / 0.9982 | 1043.1 / 0.9982 | 1384.4 / 0.9982 |  |  |  |
| faiss_bin_hnsw | ef 800 |  |  |  |  |  | 1908.2 / 0.9992 | 1965.4 / 0.9992 | 2332.8 / 0.9992 |  |  |  |
| faiss_hnsw_flat | ef 100 | 790.2 / 0.9964 | 852.1 / 0.9964 |  |  |  |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 1000 |  |  |  |  |  |  |  |  | 6231.6 / 1.0001 | 6483.5 / 1.0001 | 7366.0 / 1.0001 |
| faiss_hnsw_flat | ef 200 | 1394.0 / 0.9982 | 1446.2 / 0.9982 | 1425.8 / 0.9982 | 1470.8 / 0.9982 | 1635.4 / 0.9982 |  |  |  |  |  |  |
| faiss_hnsw_flat | ef 2000 |  |  |  |  |  |  |  |  | 12649.9 / 1.0001 | 12636.7 / 1.0001 | 13587.1 / 1.0001 |
| faiss_hnsw_flat | ef 400 |  |  | 2595.3 / 0.9987 | 2627.9 / 0.9987 | 2805.0 / 0.9987 | 2611.6 / 0.9987 | 2696.5 / 0.9987 | 3051.8 / 0.9987 |  |  |  |
| faiss_hnsw_flat | ef 800 |  |  |  |  |  | 4903.4 / 0.9999 | 4945.3 / 0.9999 | 5339.8 / 0.9999 |  |  |  |
| faiss_rabitq_flat | exhaustive | 25667.6 / 1.0001 | 25722.7 / 1.0001 | 25703.4 / 1.0001 | 25765.2 / 1.0001 | 25865.8 / 1.0001 | 25799.9 / 1.0001 | 25852.8 / 1.0001 | 26195.7 / 1.0001 | 26072.4 / 1.0001 | 26138.8 / 1.0001 | 27166.1 / 1.0001 |
| faiss_rabitq_ivf | nprobe 1 | 187.5 / 0.6810 | 244.4 / 0.6810 | 212.5 / 0.6810 | 270.6 / 0.6810 | 382.5 / 0.6810 |  |  |  |  |  |  |
| faiss_rabitq_ivf | nprobe 10 |  |  |  |  |  |  |  |  | 920.1 / 0.9405 | 977.1 / 0.9405 | 1985.9 / 0.9405 |
| faiss_rabitq_ivf | nprobe 2 | 238.4 / 0.8058 | 296.3 / 0.8058 | 267.2 / 0.8058 | 329.0 / 0.8058 | 437.3 / 0.8058 | 315.2 / 0.8058 | 373.9 / 0.8058 | 717.1 / 0.8058 |  |  |  |
| faiss_rabitq_ivf | nprobe 4 |  |  |  |  |  | 426.8 / 0.8847 | 485.2 / 0.8847 | 830.3 / 0.8847 |  |  |  |
| faiss_rabitq_ivf | nprobe 5 |  |  |  |  |  |  |  |  | 645.3 / 0.9003 | 703.3 / 0.9003 | 1711.7 / 0.9003 |
| hnswlib_f32 | ef 100 | 2065.6 / 0.9956 | 2136.8 / 0.9956 |  |  |  |  |  |  |  |  |  |
| hnswlib_f32 | ef 1000 |  |  |  |  |  |  |  |  | 13795.5 / 0.9999 | 14029.2 / 0.9999 | 14877.6 / 0.9999 |
| hnswlib_f32 | ef 200 | 3643.5 / 0.9981 | 3692.1 / 0.9981 | 3676.9 / 0.9981 | 3709.6 / 0.9981 | 3874.5 / 0.9981 |  |  |  |  |  |  |
| hnswlib_f32 | ef 2000 |  |  |  |  |  |  |  |  | 23746.2 / 1.0001 | 24212.1 / 1.0001 | 24940.6 / 1.0001 |
| hnswlib_f32 | ef 400 |  |  | 6482.8 / 0.9991 | 6523.8 / 0.9991 | 6673.3 / 0.9991 | 6463.2 / 0.9991 | 6573.0 / 0.9991 | 6947.6 / 0.9991 |  |  |  |
| hnswlib_f32 | ef 800 |  |  |  |  |  | 11384.0 / 0.9999 | 11519.1 / 0.9999 | 11801.0 / 0.9999 |  |  |  |
| ours_scan | ef 100 | 150.9 / 0.9951 | 176.0 / 0.9951 |  |  |  |  |  |  |  |  |  |
| ours_scan | ef 1000 |  |  |  |  |  |  |  |  | 522.7 / 0.9997 | 554.4 / 0.9997 | 1108.9 / 0.9997 |
| ours_scan | ef 200 |  |  | 199.4 / 0.9966 | 233.1 / 0.9966 | 274.5 / 0.9966 |  |  |  |  |  |  |
| ours_scan | ef 400 |  |  |  |  |  | 290.7 / 0.9987 | 318.6 / 0.9987 | 492.9 / 0.9987 |  |  |  |
| ours_walk | ef 100 | 146.3 / 0.9951 | 170.7 / 0.9951 |  |  |  |  |  |  |  |  |  |
| ours_walk | ef 1000 |  |  |  |  |  |  |  |  | 525.0 / 0.9997 | 552.7 / 0.9997 | 1029.5 / 0.9997 |
| ours_walk | ef 200 | 185.8 / 0.9966 | 217.5 / 0.9966 | 205.5 / 0.9966 | 234.9 / 0.9966 | 279.7 / 0.9966 |  |  |  |  |  |  |
| ours_walk | ef 2000 |  |  |  |  |  |  |  |  | 712.3 / 1.0000 | 750.9 / 1.0000 | 1220.9 / 1.0000 |
| ours_walk | ef 400 |  |  | 268.6 / 0.9976 | 290.7 / 0.9976 | 341.8 / 0.9976 | 299.0 / 0.9987 | 319.2 / 0.9987 | 494.0 / 0.9987 |  |  |  |
| ours_walk | ef 800 |  |  |  |  |  | 402.1 / 0.9994 | 432.4 / 0.9994 | 599.7 / 0.9994 |  |  |  |
| scann | leaves_to_search 1, reorder 100 | 209.0 / 0.5129 | 270.0 / 0.5129 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 1, reorder 200 |  |  | 258.6 / 0.5129 | 313.8 / 0.5129 | 429.5 / 0.5129 |  |  |  |  |  |  |
| scann | leaves_to_search 10, reorder 1000 |  |  |  |  |  |  |  |  | 794.1 / 0.8596 | 869.2 / 0.8596 | 1902.9 / 0.8596 |
| scann | leaves_to_search 2, reorder 100 | 231.3 / 0.6487 | 288.1 / 0.6487 |  |  |  |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 200 |  |  | 282.4 / 0.6487 | 338.6 / 0.6487 | 454.2 / 0.6487 |  |  |  |  |  |  |
| scann | leaves_to_search 2, reorder 400 |  |  |  |  |  | 377.6 / 0.6487 | 434.9 / 0.6487 | 778.7 / 0.6487 |  |  |  |
| scann | leaves_to_search 4, reorder 400 |  |  |  |  |  | 412.1 / 0.7557 | 470.4 / 0.7557 | 818.3 / 0.7557 |  |  |  |
| scann | leaves_to_search 5, reorder 1000 |  |  |  |  |  |  |  |  | 718.8 / 0.7871 | 786.3 / 0.7871 | 1831.1 / 0.7871 |
| usearch_b1_rescore | ef 100 | 429.0 / 0.9924 | 490.6 / 0.9924 |  |  |  |  |  |  |  |  |  |
| usearch_b1_rescore | ef 1000 |  |  |  |  |  |  |  |  | 3177.6 / 0.9995 | 3281.9 / 0.9995 | 4303.0 / 0.9995 |
| usearch_b1_rescore | ef 200 | 730.0 / 0.9951 | 785.2 / 0.9951 | 751.3 / 0.9949 | 807.7 / 0.9949 | 944.0 / 0.9949 |  |  |  |  |  |  |
| usearch_b1_rescore | ef 2000 |  |  |  |  |  |  |  |  | 5737.8 / 0.9995 | 6195.1 / 0.9995 | 7088.3 / 0.9995 |
| usearch_b1_rescore | ef 400 |  |  | 1334.1 / 0.9977 | 1387.7 / 0.9977 | 1537.8 / 0.9977 | 1342.5 / 0.9984 | 1407.5 / 0.9984 | 1803.5 / 0.9984 |  |  |  |
| usearch_b1_rescore | ef 800 |  |  |  |  |  | 2428.2 / 0.9993 | 2571.0 / 0.9993 | 2918.1 / 0.9993 |  |  |  |

## box (frozen points from the amd shortlist, R = own A/A)

### advtest / CodeRankEmbed (n_ho = 1200, exact quality 0.4732)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 551.8 | 10 | 1.0009 | yes / yes | 4.63 [4.54, 4.77] | 105 | 99 |
| diskann_vamana | 0.99 | 917.3 | 10 | 0.9977 | yes / yes | 7.31 [7.17, 7.40] | 105 | 93 |
| diskann_vamana | 0.995 | 1620.0 | 10 | 0.9980 | yes / no | 11.87 [11.67, 12.03] | 106 | 100 |
| faiss_bin_flat | 0.98 | 90.5 | 10 | 0.9796 | no / no | 0.76 [0.74, 0.77] | 84 | 200 |
| faiss_bin_flat | 0.99 | 215.8 | 10 | 0.9954 | yes / no | 1.72 [1.69, 1.74] | 84 | 202 |
| faiss_bin_flat | 0.995 | 215.8 | 10 | 0.9954 | yes / no | 1.58 [1.55, 1.59] | 84 | 202 |
| faiss_bin_hnsw | 0.98 | 356.4 | 10 | 0.9778 | no / no | 2.99 [2.89, 3.05] | 95 | 212 |
| faiss_bin_hnsw | 0.99 | 553.0 | 10 | 0.9953 | yes / no | 4.41 [4.33, 4.46] | 87 | 203 |
| faiss_bin_hnsw | 0.995 | 673.2 | 10 | 0.9963 | yes / no | 4.93 [4.85, 5.02] | 90 | 208 |
| faiss_exact | 0.98 | 1588.4 | 10 | 1.0000 | yes / yes | 13.33 [13.07, 13.52] | 82 | 57 |
| faiss_exact | 0.99 | 1588.4 | 10 | 1.0000 | yes / yes | 12.65 [12.38, 12.83] | 82 | 57 |
| faiss_exact | 0.995 | 1588.4 | 10 | 1.0000 | yes / yes | 11.63 [11.42, 11.74] | 82 | 57 |
| faiss_hnsw_flat | 0.98 | 379.8 | 10 | 0.9935 | yes / yes | 3.19 [3.09, 3.23] | 86 | 61 |
| faiss_hnsw_flat | 0.99 | 492.7 | 10 | 0.9971 | yes / yes | 3.93 [3.85, 3.98] | 89 | 61 |
| faiss_hnsw_flat | 0.995 | 899.1 | 10 | 0.9995 | yes / yes | 6.59 [6.46, 6.70] | 89 | 61 |
| faiss_hnsw_sq8 | 0.98 | 190.8 | 10 | 0.9864 | yes / no | 1.60 [1.57, 1.63] | 110 | 223 |
| faiss_hnsw_sq8 | 0.99 | 295.6 | 10 | 0.9971 | yes / yes | 2.35 [2.27, 2.45] | 105 | 220 |
| faiss_hnsw_sq8 | 0.995 | 515.0 | 10 | 0.9996 | yes / yes | 3.77 [3.72, 3.82] | 105 | 220 |
| faiss_ivfpq_fs | 0.98 | 158.6 | 10 | 0.9999 | yes / yes | 1.33 [1.31, 1.35] | 87 | 206 |
| faiss_ivfpq_fs | 0.99 | 158.6 | 10 | 0.9999 | yes / yes | 1.26 [1.24, 1.28] | 87 | 206 |
| faiss_ivfpq_fs | 0.995 | 158.6 | 10 | 0.9999 | yes / yes | 1.16 [1.14, 1.17] | 87 | 206 |
| faiss_rabitq_flat | 0.98 | 406.7 | 10 | 0.9937 | yes / yes | 3.41 [3.35, 3.46] | 85 | 206 |
| faiss_rabitq_flat | 0.99 | 416.7 | 10 | 0.9986 | yes / yes | 3.32 [3.25, 3.37] | 85 | 203 |
| faiss_rabitq_flat | 0.995 | 416.7 | 10 | 0.9986 | yes / yes | 3.05 [3.00, 3.09] | 85 | 203 |
| faiss_rabitq_hnsw | 0.98 | 150.6 | 10 | 0.9881 | yes / no | 1.26 [1.24, 1.29] | 96 | 214 |
| faiss_rabitq_hnsw | 0.99 | 262.8 | 10 | 0.9979 | yes / yes | 2.09 [2.05, 2.13] | 96 | 215 |
| faiss_rabitq_hnsw | 0.995 | 332.8 | 10 | 0.9989 | yes / no | 2.44 [2.39, 2.47] | 96 | 216 |
| faiss_rabitq_ivf | 0.98 | 521.2 | 10 | 1.0000 | yes / yes | 4.37 [4.29, 4.43] | 86 | 206 |
| faiss_rabitq_ivf | 0.99 | 521.2 | 10 | 1.0000 | yes / yes | 4.15 [4.08, 4.20] | 86 | 206 |
| faiss_rabitq_ivf | 0.995 | 521.2 | 10 | 1.0000 | yes / yes | 3.82 [3.75, 3.85] | 86 | 206 |
| hnswlib_f32 | 0.98 | 439.5 | 10 | 0.9854 | yes / no | 3.69 [3.63, 3.76] | 97 | 75 |
| hnswlib_f32 | 0.99 | 694.9 | 10 | 0.9953 | yes / no | 5.54 [5.44, 5.62] | 92 | 69 |
| hnswlib_f32 | 0.995 | 787.4 | 10 | 1.0000 | yes / yes | 5.77 [5.67, 5.86] | 97 | 75 |
| ours_cascade | 0.98 | 119.1 | 10 | 0.9832 | yes / no |  | 163 | 58 |
| ours_cascade | 0.99 | 125.5 | 10 | 0.9909 | yes / no |  | 163 | 75 |
| ours_cascade | 0.995 | 136.5 | 10 | 0.9946 | no / no |  | 163 | 86 |
| scann | 0.98 | 333.2 | 10 | 1.0000 | yes / yes | 2.80 [2.74, 2.83] | 129 | 118 |
| scann | 0.99 | 333.2 | 10 | 1.0000 | yes / yes | 2.65 [2.61, 2.69] | 129 | 118 |
| scann | 0.995 | 333.2 | 10 | 1.0000 | yes / yes | 2.44 [2.40, 2.46] | 129 | 118 |
| usearch_b1_rescore | 0.98 | 383.2 | 10 | 0.9914 | yes / yes | 3.22 [3.16, 3.27] | 91 | 209 |
| usearch_b1_rescore | 0.99 | 472.4 | 10 | 0.9902 | yes / no | 3.76 [3.66, 3.91] | 97 | 214 |
| usearch_b1_rescore | 0.995 | 472.4 | 10 | 0.9902 | no / no | 3.46 [3.37, 3.58] | 97 | 214 |
| usearch_f16 | 0.98 | 764.0 | 10 | 0.9859 | yes / no | 6.41 [6.29, 6.55] | 58 | 49 |
| usearch_f16 | 0.99 | 886.0 | 10 | 1.0010 | yes / yes | 7.06 [6.87, 7.71] | 64 | 57 |
| usearch_f16 | 0.995 | 1571.5 | 10 | 1.0013 | yes / yes | 11.51 [11.31, 12.47] | 64 | 56 |
| usearch_i8 | 0.98 | 332.4 | 10 | 0.9948 | yes / yes | 2.79 [2.73, 2.84] | 42 | 30 |
| usearch_i8 | 0.99 | 707.2 | 10 | 0.9973 | yes / no | 5.63 [5.40, 5.96] | 48 | 37 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| diskann_vamana | L 400 | 2307.2 / 0.9994 |
| diskann_vamana | L 800 | 3427.7 / 1.0000 |
| faiss_bin_flat | exhaustive | 325.5 / 0.9972 |
| faiss_bin_hnsw | ef 400 | 658.3 / 0.9958 |
| faiss_bin_hnsw | ef 800 | 1061.6 / 0.9969 |
| faiss_hnsw_flat | ef 400 | 1577.9 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 2587.9 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 665.1 / 1.0000 |
| faiss_rabitq_ivf | nprobe 18 | 287.8 / 0.7543 |
| faiss_rabitq_ivf | nprobe 9 | 248.7 / 0.6515 |
| hnswlib_f32 | ef 400 | 1996.2 / 0.9995 |
| hnswlib_f32 | ef 800 | 3156.4 / 1.0000 |
| ours_scan | ef 400 | 123.9 / 0.9970 |
| ours_walk | ef 400 | 164.6 / 0.9966 |
| ours_walk | ef 800 | 187.9 / 0.9969 |
| scann | reorder 400 | 583.0 / 1.0000 |
| usearch_b1_rescore | ef 400 | 544.6 / 0.9904 |
| usearch_b1_rescore | ef 800 | 843.3 / 0.9912 |

### csn1m / CodeRankEmbed (n_ho = 2400, exact quality 0.5497)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 1655.7 | 10 | 0.9928 | yes / yes |  | 3425 |  |
| diskann_vamana | 0.99 | 2890.8 | 10 | 0.9974 | yes / yes |  | 3425 |  |
| diskann_vamana | 0.995 | 4602.5 | 10 | 0.9968 | yes / no |  | 3384 |  |
No held-out record on this machine: faiss_bin_flat, faiss_bin_hnsw, faiss_exact, faiss_hnsw_flat, faiss_hnsw_sq8, faiss_ivfpq_fs, faiss_rabitq_flat, faiss_rabitq_hnsw, faiss_rabitq_ivf, hnswlib_f32, ours_cascade, scann, usearch_b1_rescore, usearch_f16, usearch_i8.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| diskann_vamana | L 400 | 5876.5 / 0.9991 |

### d20k / CodeRankEmbed (n_ho = 2400, exact quality 0.8271)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 448.3 | 10 | 0.9887 | yes / no | 4.36 [4.29, 4.52] | 109 | 89 |
| diskann_vamana | 0.99 | 510.5 | 10 | 0.9950 | yes / yes | 4.97 [4.93, 5.16] | 107 | 82 |
| diskann_vamana | 0.995 | 751.8 | 10 | 0.9983 | yes / yes | 5.92 [5.86, 6.09] | 109 | 85 |
| faiss_bin_flat | 0.98 | 62.9 | 10 | 0.9872 | yes / no | 0.61 [0.61, 0.63] | 118 | 187 |
| faiss_bin_flat | 0.99 | 83.1 | 10 | 0.9927 | yes / no | 0.81 [0.79, 0.83] | 118 | 185 |
| faiss_bin_flat | 0.995 | 83.1 | 10 | 0.9927 | no / no | 0.66 [0.64, 0.67] | 118 | 185 |
| faiss_bin_hnsw | 0.98 | 192.3 | 10 | 0.9829 | yes / no | 1.87 [1.85, 1.93] | 119 | 189 |
| faiss_bin_hnsw | 0.99 | 258.0 | 10 | 0.9937 | yes / no | 2.51 [2.48, 2.57] | 119 | 191 |
| faiss_bin_hnsw | 0.995 | 322.3 | 10 | 0.9962 | yes / no | 2.54 [2.51, 2.63] | 119 | 191 |
| faiss_exact | 0.98 | 1479.0 | 10 | 1.0000 | yes / yes | 14.38 [14.22, 14.76] | 87 | 42 |
| faiss_exact | 0.99 | 1479.0 | 10 | 1.0000 | yes / yes | 14.38 [14.22, 14.76] | 87 | 42 |
| faiss_exact | 0.995 | 1479.0 | 10 | 1.0000 | yes / yes | 11.66 [11.51, 11.96] | 87 | 42 |
| faiss_hnsw_flat | 0.98 | 185.8 | 10 | 0.9892 | yes / yes | 1.81 [1.76, 1.85] | 90 | 42 |
| faiss_hnsw_flat | 0.99 | 330.2 | 10 | 0.9952 | yes / yes | 3.21 [3.19, 3.30] | 90 | 44 |
| faiss_hnsw_flat | 0.995 | 441.2 | 10 | 0.9990 | yes / yes | 3.48 [3.41, 3.58] | 93 | 46 |
| faiss_hnsw_sq8 | 0.98 | 141.7 | 10 | 0.9907 | yes / yes | 1.38 [1.36, 1.41] | 119 | 195 |
| faiss_hnsw_sq8 | 0.99 | 235.0 | 10 | 0.9952 | yes / yes | 2.29 [2.21, 2.39] | 119 | 194 |
| faiss_hnsw_sq8 | 0.995 | 286.0 | 10 | 0.9990 | yes / yes | 2.25 [2.23, 2.31] | 119 | 203 |
| faiss_ivfpq_fs | 0.98 | 178.0 | 10 | 1.0000 | yes / yes | 1.73 [1.71, 1.77] | 119 | 193 |
| faiss_ivfpq_fs | 0.99 | 178.0 | 10 | 1.0000 | yes / yes | 1.73 [1.71, 1.77] | 119 | 193 |
| faiss_ivfpq_fs | 0.995 | 178.0 | 10 | 1.0000 | yes / yes | 1.40 [1.38, 1.44] | 119 | 193 |
| faiss_rabitq_flat | 0.98 | 385.7 | 10 | 0.9998 | yes / yes | 3.75 [3.71, 3.86] | 118 | 186 |
| faiss_rabitq_flat | 0.99 | 385.7 | 10 | 0.9998 | yes / yes | 3.75 [3.71, 3.86] | 118 | 186 |
| faiss_rabitq_flat | 0.995 | 385.7 | 10 | 0.9998 | yes / yes | 3.04 [3.01, 3.13] | 118 | 186 |
| faiss_rabitq_hnsw | 0.98 | 143.9 | 10 | 0.9917 | yes / yes | 1.40 [1.37, 1.44] | 119 | 191 |
| faiss_rabitq_hnsw | 0.99 | 230.2 | 10 | 0.9981 | yes / yes | 2.24 [2.22, 2.29] | 119 | 191 |
| faiss_rabitq_hnsw | 0.995 | 389.4 | 10 | 0.9991 | yes / yes | 3.07 [3.04, 3.17] | 119 | 186 |
| faiss_rabitq_ivf | 0.98 | 430.7 | 10 | 0.9912 | yes / yes | 4.19 [4.15, 4.29] | 119 | 187 |
| faiss_rabitq_ivf | 0.99 | 466.2 | 10 | 0.9923 | yes / no | 4.53 [4.49, 4.64] | 119 | 188 |
| faiss_rabitq_ivf | 0.995 | 535.5 | 10 | 1.0000 | yes / yes | 4.22 [4.18, 4.32] | 119 | 188 |
| hnswlib_f32 | 0.98 | 237.8 | 10 | 0.9851 | yes / no | 2.31 [2.24, 2.40] | 93 | 50 |
| hnswlib_f32 | 0.99 | 617.3 | 10 | 1.0002 | yes / yes | 6.00 [5.91, 6.20] | 96 | 52 |
| hnswlib_f32 | 0.995 | 800.6 | 10 | 0.9982 | yes / yes | 6.31 [6.24, 6.47] | 93 | 50 |
| ours_cascade | 0.98 | 102.8 | 10 | 0.9902 | yes / yes |  | 185 | 50 |
| ours_cascade | 0.99 | 102.8 | 10 | 0.9902 | yes / no |  | 185 | 50 |
| ours_cascade | 0.995 | 126.9 | 10 | 0.9941 | no / no |  | 201 | 63 |
| scann | 0.98 | 323.5 | 10 | 1.0000 | yes / yes | 3.15 [3.11, 3.22] | 132 | 118 |
| scann | 0.99 | 323.5 | 10 | 1.0000 | yes / yes | 3.15 [3.11, 3.22] | 132 | 118 |
| scann | 0.995 | 323.5 | 10 | 1.0000 | yes / yes | 2.55 [2.53, 2.61] | 132 | 118 |
| usearch_b1_rescore | 0.98 | 174.4 | 10 | 0.9822 | yes / no | 1.70 [1.67, 1.74] | 123 | 191 |
| usearch_b1_rescore | 0.99 | 229.5 | 10 | 0.9919 | yes / no | 2.23 [2.21, 2.30] | 125 | 195 |
| usearch_b1_rescore | 0.995 | 330.6 | 10 | 0.9931 | no / no | 2.61 [2.58, 2.70] | 130 | 197 |
| usearch_f16 | 0.98 | 375.1 | 10 | 0.9894 | yes / yes | 3.65 [3.53, 3.93] | 65 | 45 |
| usearch_f16 | 0.99 | 492.6 | 10 | 0.9902 | yes / no | 4.79 [4.75, 5.17] | 70 | 50 |
| usearch_f16 | 0.995 | 885.4 | 10 | 0.9955 | yes / no | 6.98 [6.83, 7.26] | 70 | 45 |
| usearch_i8 | 0.98 | 176.4 | 10 | 0.9877 | yes / yes | 1.72 [1.69, 1.76] | 50 | 27 |
| usearch_i8 | 0.99 | 202.4 | 10 | 0.9921 | yes / no | 1.97 [1.80, 2.02] | 55 | 33 |
| usearch_i8 | 0.995 | 577.7 | 10 | 0.9961 | yes / no | 4.55 [4.48, 4.68] | 55 | 33 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| diskann_vamana | L 400 | 1916.7 / 1.0000 |
| diskann_vamana | L 800 | 2887.7 / 1.0000 |
| faiss_bin_flat | exhaustive | 307.7 / 0.9978 |
| faiss_bin_hnsw | ef 400 | 628.7 / 0.9983 |
| faiss_bin_hnsw | ef 800 | 1017.1 / 0.9978 |
| faiss_hnsw_flat | ef 400 | 1400.7 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 2284.6 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 618.0 / 1.0000 |
| faiss_rabitq_ivf | nprobe 18 | 285.7 / 0.8766 |
| faiss_rabitq_ivf | nprobe 9 | 236.9 / 0.7978 |
| hnswlib_f32 | ef 400 | 1794.8 / 1.0000 |
| hnswlib_f32 | ef 800 | 2789.9 / 1.0000 |
| ours_scan | ef 400 | 118.4 / 0.9979 |
| ours_walk | ef 400 | 152.4 / 0.9978 |
| ours_walk | ef 800 | 179.1 / 0.9978 |
| scann | reorder 400 | 547.0 / 1.0000 |
| usearch_b1_rescore | ef 400 | 515.2 / 0.9957 |
| usearch_b1_rescore | ef 800 | 791.3 / 0.9961 |

### dall / CodeRankEmbed (n_ho = 2400, exact quality 0.7906)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 2105.0 | 10 | 0.9930 | yes / yes | 6.51 [6.38, 6.67] | 498 | 522 |
| diskann_vamana | 0.99 | 3541.9 | 10 | 0.9955 | yes / yes | 9.83 [9.69, 9.93] | 500 | 520 |
| diskann_vamana | 0.995 | 4338.1 | 10 | 0.9982 | yes / yes | 11.65 [11.49, 11.73] | 507 | 539 |
| faiss_bin_flat | 0.98 | 312.6 | 10 | 0.9868 | yes / no | 0.97 [0.95, 0.98] | 471 | 1326 |
| faiss_bin_flat | 0.99 | 368.4 | 10 | 0.9944 | yes / no | 1.02 [1.01, 1.03] | 471 | 1322 |
| faiss_bin_flat | 0.995 | 460.4 | 10 | 0.9973 | yes / no | 1.24 [1.22, 1.25] | 471 | 1326 |
| faiss_bin_hnsw | 0.98 | 477.1 | 10 | 0.9828 | yes / no | 1.48 [1.44, 1.51] | 541 | 1366 |
| faiss_bin_hnsw | 0.99 | 1044.4 | 10 | 0.9918 | yes / no | 2.90 [2.84, 3.10] | 506 | 1336 |
| faiss_bin_hnsw | 0.995 | 1853.0 | 10 | 0.9965 | yes / no | 4.98 [4.90, 5.36] | 506 | 1341 |
| faiss_exact | 0.98 | 11349.1 | 10 | 1.0000 | yes / yes | 35.10 [34.42, 35.64] | 440 | 290 |
| faiss_exact | 0.99 | 11349.1 | 10 | 1.0000 | yes / yes | 31.50 [31.14, 31.86] | 440 | 290 |
| faiss_exact | 0.995 | 11349.1 | 10 | 1.0000 | yes / yes | 30.48 [30.13, 30.74] | 440 | 290 |
| faiss_hnsw_flat | 0.98 | 865.9 | 10 | 0.9906 | yes / yes | 2.68 [2.62, 2.72] | 460 | 308 |
| faiss_hnsw_flat | 0.99 | 1151.2 | 10 | 0.9937 | yes / no | 3.20 [3.15, 3.23] | 477 | 310 |
| faiss_hnsw_flat | 0.995 | 2160.7 | 10 | 0.9993 | yes / yes | 5.80 [5.73, 5.85] | 477 | 316 |
| faiss_hnsw_sq8 | 0.98 | 799.7 | 10 | 0.9891 | yes / yes | 2.47 [2.42, 2.52] | 575 | 1389 |
| faiss_hnsw_sq8 | 0.99 | 1051.9 | 10 | 0.9943 | yes / no | 2.92 [2.88, 2.95] | 610 | 1399 |
| faiss_hnsw_sq8 | 0.995 | 1976.1 | 10 | 0.9991 | yes / yes | 5.31 [5.25, 5.35] | 610 | 1414 |
| faiss_ivfpq_fs | 0.98 | 664.1 | 10 | 0.9998 | yes / yes | 2.05 [2.01, 2.09] | 472 | 1312 |
| faiss_ivfpq_fs | 0.99 | 664.1 | 10 | 0.9998 | yes / yes | 1.84 [1.81, 1.87] | 472 | 1312 |
| faiss_ivfpq_fs | 0.995 | 664.1 | 10 | 0.9998 | yes / yes | 1.78 [1.75, 1.81] | 472 | 1312 |
| faiss_rabitq_flat | 0.98 | 2522.3 | 10 | 0.9988 | yes / yes | 7.80 [7.65, 7.90] | 471 | 1327 |
| faiss_rabitq_flat | 0.99 | 2522.3 | 10 | 0.9988 | yes / yes | 7.00 [6.92, 7.07] | 471 | 1327 |
| faiss_rabitq_flat | 0.995 | 2522.3 | 10 | 0.9988 | yes / yes | 6.78 [6.70, 6.82] | 471 | 1327 |
| faiss_rabitq_hnsw | 0.98 | 460.4 | 10 | 0.9843 | yes / no | 1.42 [1.38, 1.50] | 541 | 1370 |
| faiss_rabitq_hnsw | 0.99 | 666.5 | 10 | 0.9931 | yes / no | 1.85 [1.81, 1.93] | 541 | 1360 |
| faiss_rabitq_hnsw | 0.995 | 1008.7 | 10 | 0.9990 | yes / yes | 2.71 [2.66, 2.89] | 541 | 1370 |
| faiss_rabitq_ivf | 0.98 | 1967.7 | 10 | 0.9938 | yes / yes | 6.09 [5.96, 6.21] | 472 | 1338 |
| faiss_rabitq_ivf | 0.99 | 2860.8 | 10 | 1.0000 | yes / yes | 7.94 [7.85, 8.03] | 472 | 1340 |
| faiss_rabitq_ivf | 0.995 | 2860.8 | 10 | 1.0000 | yes / yes | 7.68 [7.59, 7.76] | 472 | 1340 |
| hnswlib_f32 | 0.98 | 1050.0 | 10 | 0.9902 | yes / yes | 3.25 [3.18, 3.29] | 525 | 405 |
| hnswlib_f32 | 0.99 | 1650.6 | 10 | 0.9980 | yes / yes | 4.58 [4.51, 4.63] | 491 | 382 |
| hnswlib_f32 | 0.995 | 3023.9 | 10 | 0.9986 | yes / yes | 8.12 [8.02, 8.18] | 491 | 383 |
| ours_cascade | 0.98 | 323.3 | 10 | 0.9852 | yes / no |  | 505 | 175 |
| ours_cascade | 0.99 | 360.3 | 10 | 0.9946 | yes / no |  | 505 | 178 |
| ours_cascade | 0.995 | 372.3 | 10 | 0.9971 | yes / no |  | 505 | 202 |
| scann | 0.98 | 2297.9 | 10 | 1.0000 | yes / yes | 7.11 [6.97, 7.21] | 509 | 582 |
| scann | 0.99 | 2297.9 | 10 | 1.0000 | yes / yes | 6.38 [6.30, 6.45] | 509 | 582 |
| scann | 0.995 | 2297.9 | 10 | 1.0000 | yes / yes | 6.17 [6.09, 6.22] | 509 | 582 |
| usearch_b1_rescore | 0.98 | 878.2 | 10 | 0.9838 | yes / no | 2.72 [2.66, 2.81] | 523 | 1379 |
| usearch_b1_rescore | 0.99 | 1249.0 | 10 | 0.9893 | no / no | 3.47 [3.41, 3.61] | 557 | 1415 |
| usearch_b1_rescore | 0.995 | 1883.3 | 10 | 0.9940 | no / no | 5.06 [4.99, 5.20] | 523 | 1392 |
| usearch_f16 | 0.98 | 2583.3 | 10 | 0.9910 | yes / yes | 7.99 [7.81, 8.20] | 284 | 309 |
| usearch_f16 | 0.99 | 3376.4 | 10 | 0.9935 | yes / no | 9.37 [9.22, 9.55] | 267 | 291 |
| usearch_f16 | 0.995 | 5322.2 | 10 | 0.9971 | yes / no | 14.30 [14.11, 14.40] | 319 | 357 |
| usearch_i8 | 0.98 | 1929.6 | 10 | 0.9917 | yes / yes | 5.97 [5.83, 6.14] | 181 | 172 |
| usearch_i8 | 0.99 | 1929.6 | 10 | 0.9917 | yes / no | 5.36 [5.27, 5.49] | 181 | 172 |
| usearch_i8 | 0.995 | 3585.8 | 10 | 0.9937 | no / no | 9.63 [9.51, 9.81] | 181 | 175 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| diskann_vamana | L 400 | 3255.6 / 0.9984 |
| diskann_vamana | L 800 | 5510.0 / 0.9994 |
| faiss_bin_flat | exhaustive | 640.4 / 0.9982 |
| faiss_bin_hnsw | ef 400 | 872.9 / 0.9876 |
| faiss_bin_hnsw | ef 800 | 1467.9 / 0.9969 |
| faiss_hnsw_flat | ef 400 | 2006.3 / 0.9979 |
| faiss_hnsw_flat | ef 800 | 3580.2 / 0.9994 |
| faiss_rabitq_flat | exhaustive | 2862.1 / 1.0001 |
| faiss_rabitq_ivf | nprobe 4 | 281.5 / 0.5694 |
| faiss_rabitq_ivf | nprobe 8 | 334.3 / 0.6689 |
| hnswlib_f32 | ef 400 | 2659.4 / 0.9986 |
| hnswlib_f32 | ef 800 | 4686.3 / 0.9993 |
| ours_scan | ef 400 | 353.8 / 0.9981 |
| ours_walk | ef 400 | 246.2 / 0.9927 |
| ours_walk | ef 800 | 315.1 / 0.9948 |
| scann | leaves_to_search 4, reorder 400 | 324.2 / 0.2342 |
| scann | leaves_to_search 8, reorder 400 | 357.9 / 0.3020 |
| usearch_b1_rescore | ef 400 | 898.1 / 0.9842 |
| usearch_b1_rescore | ef 800 | 1539.7 / 0.9944 |

### fiqa / bge-base-en-v1.5 (n_ho = 259, exact quality 0.4175)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 866.4 | 10 | 0.9912 | yes / no | 4.66 [4.56, 4.79] | 208 | 208 |
| diskann_vamana | 0.99 | 1196.4 | 10 | 1.0000 | yes / yes | 5.56 [5.43, 5.82] | 215 | 215 |
| diskann_vamana | 0.995 | 1196.4 | 10 | 1.0000 | yes / yes |  | 215 | 215 |
| faiss_exact | 0.98 | 4529.6 | 10 | 1.0000 | yes / yes | 24.39 [23.99, 25.03] | 181 | 111 |
| faiss_exact | 0.99 | 4529.6 | 10 | 1.0000 | yes / yes | 21.06 [20.57, 22.05] | 181 | 111 |
| faiss_exact | 0.995 | 4529.6 | 10 | 1.0000 | yes / yes |  | 181 | 111 |
| faiss_hnsw_flat | 0.98 | 475.9 | 10 | 1.0001 | yes / yes | 2.56 [2.53, 2.62] | 196 | 124 |
| faiss_hnsw_flat | 0.99 | 475.9 | 10 | 1.0001 | yes / yes | 2.21 [2.16, 2.31] | 196 | 124 |
| faiss_hnsw_flat | 0.995 | 475.9 | 10 | 1.0001 | yes / yes |  | 196 | 124 |
| faiss_hnsw_sq8 | 0.98 | 311.7 | 10 | 0.9961 | yes / yes | 1.68 [1.64, 1.81] | 232 | 612 |
| faiss_hnsw_sq8 | 0.99 | 625.6 | 10 | 0.9726 | no / no | 2.91 [2.84, 3.17] | 253 | 632 |
| faiss_hnsw_sq8 | 0.995 | 1061.9 | 10 | 1.0000 | yes / yes |  | 232 | 612 |
| faiss_ivfpq_fs | 0.98 | 178.6 | 10 | 0.9991 | yes / yes | 0.96 [0.95, 0.99] | 190 | 584 |
| faiss_ivfpq_fs | 0.99 | 178.6 | 10 | 0.9991 | yes / yes | 0.83 [0.81, 0.87] | 190 | 584 |
| faiss_ivfpq_fs | 0.995 | 231.7 | 10 | 1.0000 | yes / yes |  | 190 | 582 |
| faiss_rabitq_flat | 0.98 | 1065.7 | 10 | 0.9974 | yes / yes | 5.74 [5.66, 5.88] | 186 | 579 |
| faiss_rabitq_flat | 0.99 | 1065.7 | 10 | 0.9974 | yes / yes | 4.95 [4.84, 5.18] | 186 | 579 |
| faiss_rabitq_flat | 0.995 | 1065.7 | 10 | 0.9974 | yes / no |  | 186 | 579 |
| faiss_rabitq_hnsw | 0.98 | 431.8 | 10 | 1.0007 | yes / yes | 2.32 [2.29, 2.39] | 195 | 597 |
| faiss_rabitq_hnsw | 0.99 | 579.8 | 10 | 1.0039 | yes / yes | 2.70 [2.54, 2.86] | 202 | 591 |
| faiss_rabitq_hnsw | 0.995 | 705.1 | 10 | 1.0001 | yes / yes |  | 216 | 603 |
| faiss_rabitq_ivf | 0.98 | 320.9 | 10 | 0.9946 | yes / yes | 1.73 [1.70, 1.77] | 190 | 587 |
| faiss_rabitq_ivf | 0.99 | 320.9 | 10 | 0.9946 | yes / no | 1.49 [1.46, 1.56] | 190 | 587 |
| faiss_rabitq_ivf | 0.995 | 549.5 | 10 | 1.0003 | yes / yes |  | 190 | 588 |
| hnswlib_f32 | 0.98 | 253.6 | 10 | 0.9879 | yes / no | 1.37 [1.34, 1.41] | 196 | 138 |
| hnswlib_f32 | 0.99 | 457.5 | 10 | 0.9902 | yes / no | 2.13 [2.07, 2.23] | 196 | 138 |
| hnswlib_f32 | 0.995 | 1420.5 | 10 | 1.0000 | yes / yes |  | 196 | 139 |
| ours_cascade | 0.98 | 185.7 | 10 | 0.9935 | yes / no |  | 223 | 109 |
| ours_cascade | 0.99 | 215.1 | 10 | 0.9959 | yes / no |  | 221 | 158 |
| scann | 0.98 | 819.4 | 10 | 1.0000 | yes / yes | 4.41 [4.36, 4.52] | 246 | 204 |
| scann | 0.99 | 819.4 | 10 | 1.0000 | yes / yes | 3.81 [3.72, 3.99] | 246 | 204 |
| scann | 0.995 | 819.4 | 10 | 1.0000 | yes / yes |  | 246 | 204 |
| usearch_f16 | 0.98 | 907.1 | 10 | 0.9896 | yes / no | 4.88 [4.81, 5.12] | 117 | 121 |
| usearch_f16 | 0.99 | 907.1 | 10 | 0.9896 | no / no | 4.22 [4.12, 4.47] | 117 | 121 |
| usearch_f16 | 0.995 | 1558.5 | 10 | 0.9895 | no / no |  | 117 | 123 |
| usearch_i8 | 0.98 | 600.1 | 10 | 0.9973 | yes / no | 3.23 [2.95, 3.35] | 75 | 70 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| diskann_vamana | L 400 | 1883.6 / 1.0000 |
| diskann_vamana | L 800 | 2968.6 / 1.0000 |
| faiss_bin_flat | exhaustive | 453.3 / 0.9969 |
| faiss_bin_hnsw | ef 400 | 691.4 / 0.9876 |
| faiss_bin_hnsw | ef 800 | 1151.0 / 0.9969 |
| faiss_hnsw_flat | ef 400 | 1509.1 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 2548.0 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 1359.9 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 | 319.9 / 0.9588 |
| faiss_rabitq_ivf | nprobe 5 | 276.6 / 0.8618 |
| hnswlib_f32 | ef 400 | 1825.6 / 1.0000 |
| hnswlib_f32 | ef 800 | 2977.8 / 1.0000 |
| ours_scan | ef 400 | 198.3 / 0.9967 |
| ours_walk | ef 400 | 165.1 / 0.9994 |
| ours_walk | ef 800 | 200.3 / 0.9995 |
| scann | reorder 400 | 1122.8 / 1.0000 |
| usearch_b1_rescore | ef 400 | 598.7 / 0.9967 |
| usearch_b1_rescore | ef 800 | 949.0 / 0.9950 |

### gcsn / CodeRankEmbed (n_ho = 2400, exact quality 0.8412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 199.7 | 10 | 0.9990 | yes / yes | 2.87 [2.77, 2.91] | 66 | 36 |
| diskann_vamana | 0.99 | 199.7 | 10 | 0.9990 | yes / yes | 2.87 [2.77, 2.91] | 66 | 36 |
| diskann_vamana | 0.995 | 216.0 | 10 | 0.9994 | yes / yes | 2.33 [2.17, 2.45] | 66 | 35 |
| faiss_bin_flat | 0.98 | 36.1 | 10 | 0.9897 | yes / yes | 0.52 [0.50, 0.54] | 80 | 56 |
| faiss_bin_flat | 0.99 | 36.1 | 10 | 0.9897 | no / no | 0.52 [0.50, 0.54] | 80 | 56 |
| faiss_bin_flat | 0.995 | 52.8 | 10 | 0.9959 | yes / no | 0.57 [0.56, 0.58] | 80 | 56 |
| faiss_bin_hnsw | 0.98 | 135.1 | 10 | 0.9889 | yes / yes | 1.94 [1.88, 1.97] | 80 | 57 |
| faiss_bin_hnsw | 0.99 | 157.5 | 10 | 0.9923 | yes / no | 2.26 [2.19, 2.29] | 80 | 58 |
| faiss_bin_hnsw | 0.995 | 190.2 | 10 | 0.9956 | yes / no | 2.05 [1.95, 2.09] | 80 | 58 |
| faiss_exact | 0.98 | 366.8 | 10 | 1.0000 | yes / yes | 5.27 [5.09, 5.35] | 49 | 16 |
| faiss_exact | 0.99 | 366.8 | 10 | 1.0000 | yes / yes | 5.27 [5.09, 5.35] | 49 | 16 |
| faiss_exact | 0.995 | 366.8 | 10 | 1.0000 | yes / yes | 3.95 [3.86, 4.03] | 49 | 16 |
| faiss_hnsw_flat | 0.98 | 118.6 | 10 | 0.9976 | yes / yes | 1.70 [1.60, 1.75] | 50 | 19 |
| faiss_hnsw_flat | 0.99 | 118.6 | 10 | 0.9976 | yes / yes | 1.70 [1.60, 1.75] | 50 | 19 |
| faiss_hnsw_flat | 0.995 | 149.9 | 10 | 0.9969 | yes / no | 1.61 [1.58, 1.70] | 53 | 22 |
| faiss_hnsw_sq8 | 0.98 | 89.2 | 10 | 0.9914 | yes / yes | 1.28 [1.24, 1.30] | 81 | 60 |
| faiss_hnsw_sq8 | 0.99 | 111.6 | 10 | 0.9956 | yes / yes | 1.60 [1.55, 1.62] | 81 | 62 |
| faiss_hnsw_sq8 | 0.995 | 160.2 | 10 | 0.9963 | yes / no | 1.73 [1.68, 1.76] | 81 | 62 |
| faiss_ivfpq_fs | 0.98 | 101.5 | 10 | 1.0000 | yes / yes | 1.46 [1.41, 1.52] | 81 | 62 |
| faiss_ivfpq_fs | 0.99 | 101.5 | 10 | 1.0000 | yes / yes | 1.46 [1.41, 1.52] | 81 | 62 |
| faiss_ivfpq_fs | 0.995 | 101.5 | 10 | 1.0000 | yes / yes | 1.09 [1.07, 1.14] | 81 | 62 |
| faiss_rabitq_flat | 0.98 | 149.8 | 10 | 0.9999 | yes / yes | 2.15 [2.08, 2.18] | 80 | 57 |
| faiss_rabitq_flat | 0.99 | 149.8 | 10 | 0.9999 | yes / yes | 2.15 [2.08, 2.18] | 80 | 57 |
| faiss_rabitq_flat | 0.995 | 149.8 | 10 | 0.9999 | yes / yes | 1.61 [1.58, 1.64] | 80 | 57 |
| faiss_rabitq_hnsw | 0.98 | 93.9 | 10 | 0.9912 | yes / yes | 1.35 [1.30, 1.37] | 81 | 61 |
| faiss_rabitq_hnsw | 0.99 | 96.3 | 10 | 0.9964 | yes / yes | 1.38 [1.33, 1.42] | 81 | 62 |
| faiss_rabitq_hnsw | 0.995 | 135.2 | 10 | 0.9986 | yes / yes | 1.46 [1.42, 1.49] | 81 | 60 |
| faiss_rabitq_ivf | 0.98 | 215.8 | 10 | 0.9961 | yes / yes | 3.10 [3.00, 3.14] | 80 | 62 |
| faiss_rabitq_ivf | 0.99 | 255.1 | 10 | 1.0000 | yes / yes | 3.67 [3.53, 3.74] | 80 | 60 |
| faiss_rabitq_ivf | 0.995 | 255.1 | 10 | 1.0000 | yes / yes | 2.75 [2.67, 2.81] | 80 | 60 |
| hnswlib_f32 | 0.98 | 117.5 | 10 | 0.9976 | yes / yes | 1.69 [1.63, 1.82] | 52 | 20 |
| hnswlib_f32 | 0.99 | 117.5 | 10 | 0.9976 | yes / yes | 1.69 [1.63, 1.82] | 52 | 20 |
| hnswlib_f32 | 0.995 | 201.3 | 10 | 1.0001 | yes / yes | 2.17 [2.12, 2.22] | 55 | 20 |
| ours_cascade | 0.98 | 69.6 | 10 | 0.9908 | yes / yes |  | 142 | 49 |
| ours_cascade | 0.99 | 69.6 | 10 | 0.9908 | yes / no |  | 142 | 49 |
| ours_cascade | 0.995 | 92.8 | 10 | 0.9959 | yes / no |  | 143 | 65 |
| scann | 0.98 | 287.0 | 10 | 1.0000 | yes / yes | 4.12 [3.97, 4.22] | 80 | 72 |
| scann | 0.99 | 287.0 | 10 | 1.0000 | yes / yes | 4.12 [3.97, 4.22] | 80 | 72 |
| scann | 0.995 | 287.0 | 10 | 1.0000 | yes / yes | 3.09 [3.01, 3.17] | 80 | 72 |
| usearch_b1_rescore | 0.98 | 147.4 | 10 | 0.9876 | yes / no | 2.12 [2.05, 2.14] | 81 | 58 |
| usearch_b1_rescore | 0.99 | 179.5 | 10 | 0.9943 | yes / no | 2.58 [2.49, 2.61] | 82 | 59 |
| usearch_f16 | 0.98 | 170.9 | 10 | 0.9916 | yes / yes | 2.46 [2.37, 2.49] | 40 | 15 |
| usearch_f16 | 0.99 | 218.5 | 10 | 0.9951 | yes / yes | 3.14 [3.03, 3.18] | 41 | 17 |
| usearch_i8 | 0.98 | 97.8 | 10 | 0.9869 | yes / yes | 1.41 [1.36, 1.42] | 35 | 10 |
| usearch_i8 | 0.99 | 130.0 | 10 | 0.9918 | yes / no | 1.87 [1.80, 1.89] | 38 | 13 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| diskann_vamana | L 400 | 1010.4 / 1.0000 |
| diskann_vamana | L 800 | 1288.4 / 1.0000 |
| faiss_bin_flat | exhaustive | 241.8 / 0.9996 |
| faiss_bin_hnsw | ef 400 | 492.6 / 0.9996 |
| faiss_bin_hnsw | ef 800 | 777.5 / 0.9996 |
| faiss_hnsw_flat | ef 400 | 860.6 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 1282.2 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 337.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 | 223.4 / 0.9175 |
| faiss_rabitq_ivf | nprobe 30 | 266.5 / 0.9669 |
| hnswlib_f32 | ef 400 | 887.7 / 1.0000 |
| hnswlib_f32 | ef 800 | 1168.0 / 1.0000 |
| ours_scan | ef 400 | 80.8 / 0.9996 |
| ours_walk | ef 400 | 113.2 / 0.9997 |
| ours_walk | ef 800 | 122.9 / 0.9997 |
| scann | reorder 400 | 484.7 / 1.0000 |
| usearch_b1_rescore | ef 400 | 367.9 / 0.9963 |
| usearch_b1_rescore | ef 800 | 538.1 / 0.9963 |

### quora / bge-base-en-v1.5 (n_ho = 4000, exact quality 0.8914)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| diskann_vamana | 0.98 | 195.8 | 10 | 0.9845 | yes / yes | 2.15 [2.13, 2.18] | 1694 | 1722 |
| diskann_vamana | 0.99 | 276.3 | 10 | 0.9938 | yes / yes | 3.03 [2.99, 3.11] | 1694 | 1766 |
| diskann_vamana | 0.995 | 369.0 | 10 | 0.9965 | yes / no | 4.05 [4.00, 4.12] | 1819 | 1859 |
| faiss_bin_flat | 0.98 | 1157.1 | 10 | 0.9976 | yes / yes | 12.70 [12.59, 12.81] | 1604 | 4931 |
| faiss_bin_flat | 0.99 | 1157.1 | 10 | 0.9976 | yes / yes | 12.70 [12.59, 12.81] | 1604 | 4931 |
| faiss_bin_flat | 0.995 | 1157.1 | 10 | 0.9976 | yes / yes | 12.70 [12.59, 12.81] | 1604 | 4931 |
| faiss_bin_hnsw | 0.98 | 97.3 | 10 | 0.9834 | yes / no | 1.07 [1.06, 1.08] | 1766 | 4999 |
| faiss_bin_hnsw | 0.99 | 132.2 | 10 | 0.9944 | yes / yes | 1.45 [1.42, 1.47] | 1765 | 5043 |
| faiss_bin_hnsw | 0.995 | 183.3 | 10 | 0.9975 | yes / yes | 2.01 [2.00, 2.04] | 1766 | 5086 |
| faiss_exact | 0.98 | 41579.3 | 10 | 1.0000 | yes / yes | 456.29 [453.63, 460.92] | 1572 | 899 |
| faiss_exact | 0.99 | 41579.3 | 10 | 1.0000 | yes / yes | 456.29 [453.63, 460.92] | 1572 | 899 |
| faiss_exact | 0.995 | 41579.3 | 10 | 1.0000 | yes / yes | 456.29 [453.63, 460.92] | 1572 | 899 |
| faiss_hnsw_flat | 0.98 | 94.0 | 10 | 0.9875 | yes / yes | 1.03 [1.02, 1.09] | 1645 | 997 |
| faiss_hnsw_flat | 0.99 | 131.9 | 10 | 0.9921 | yes / no | 1.45 [1.41, 1.49] | 1709 | 1057 |
| faiss_hnsw_flat | 0.995 | 173.6 | 10 | 0.9968 | yes / no | 1.91 [1.87, 1.96] | 1709 | 1079 |
| faiss_hnsw_sq8 | 0.98 | 89.5 | 10 | 0.9825 | yes / no | 0.98 [0.97, 1.00] | 2053 | 5218 |
| faiss_hnsw_sq8 | 0.99 | 129.2 | 10 | 0.9921 | yes / no | 1.42 [1.41, 1.43] | 2117 | 5255 |
| faiss_hnsw_sq8 | 0.995 | 168.4 | 10 | 0.9967 | yes / no | 1.85 [1.84, 1.88] | 2117 | 5289 |
| faiss_ivfpq_fs | 0.98 | 136.9 | 10 | 0.9938 | yes / yes | 1.50 [1.49, 1.52] | 1639 | 5002 |
| faiss_ivfpq_fs | 0.99 | 197.9 | 10 | 0.9973 | yes / yes | 2.17 [2.15, 2.19] | 1639 | 4990 |
| faiss_ivfpq_fs | 0.995 | 310.8 | 10 | 0.9992 | yes / yes | 3.41 [3.38, 3.46] | 1639 | 4995 |
| faiss_rabitq_flat | 0.98 | 9363.9 | 10 | 1.0000 | yes / yes | 102.76 [102.11, 103.96] | 1656 | 5019 |
| faiss_rabitq_flat | 0.99 | 9363.9 | 10 | 1.0000 | yes / yes | 102.76 [102.11, 103.96] | 1656 | 5019 |
| faiss_rabitq_flat | 0.995 | 9363.9 | 10 | 1.0000 | yes / yes | 102.76 [102.11, 103.96] | 1656 | 5019 |
| faiss_rabitq_hnsw | 0.98 | 135.3 | 10 | 0.9896 | yes / yes | 1.49 [1.45, 1.59] | 1914 | 5163 |
| faiss_rabitq_hnsw | 0.99 | 135.3 | 10 | 0.9896 | no / no | 1.49 [1.45, 1.59] | 1914 | 5163 |
| faiss_rabitq_hnsw | 0.995 | 206.1 | 10 | 0.9959 | yes / no | 2.26 [2.21, 2.40] | 1913 | 5137 |
| faiss_rabitq_ivf | 0.98 | 237.7 | 10 | 0.9884 | yes / yes | 2.61 [2.57, 2.67] | 1637 | 4942 |
| faiss_rabitq_ivf | 0.99 | 470.2 | 10 | 0.9969 | yes / yes | 5.16 [5.13, 5.21] | 1637 | 4965 |
| faiss_rabitq_ivf | 0.995 | 770.3 | 10 | 0.9983 | yes / yes | 8.45 [8.39, 8.56] | 1637 | 4977 |
| hnswlib_f32 | 0.98 | 114.2 | 10 | 0.9852 | yes / yes | 1.25 [1.23, 1.29] | 1694 | 1263 |
| hnswlib_f32 | 0.99 | 184.3 | 10 | 0.9942 | yes / yes | 2.02 [1.99, 2.05] | 1694 | 1266 |
| hnswlib_f32 | 0.995 | 269.3 | 10 | 0.9972 | yes / yes | 2.96 [2.91, 3.03] | 1885 | 1388 |
| ours_cascade | 0.98 | 91.1 | 10 | 0.9983 | yes / yes |  | 1724 | 821 |
| ours_cascade | 0.99 | 91.1 | 10 | 0.9983 | yes / yes |  | 1724 | 821 |
| ours_cascade | 0.995 | 91.1 | 10 | 0.9983 | yes / yes |  | 1724 | 821 |
| scann | 0.98 | 234.3 | 10 | 0.9909 | yes / yes | 2.57 [2.55, 2.60] | 1805 | 2915 |
| scann | 0.99 | 268.3 | 10 | 0.9965 | yes / yes | 2.94 [2.92, 2.97] | 1821 | 2889 |
| scann | 0.995 | 517.2 | 10 | 0.9986 | yes / yes | 5.68 [5.64, 5.72] | 1805 | 2879 |
| usearch_b1_rescore | 0.98 | 148.0 | 10 | 0.9924 | yes / yes | 1.62 [1.58, 1.74] | 1733 | 5116 |
| usearch_b1_rescore | 0.99 | 163.9 | 10 | 0.9929 | yes / yes | 1.80 [1.77, 1.91] | 1733 | 5114 |
| usearch_b1_rescore | 0.995 | 229.7 | 10 | 0.9977 | yes / yes | 2.52 [2.47, 2.74] | 1797 | 5189 |
| usearch_f16 | 0.98 | 199.0 | 10 | 0.9839 | yes / no | 2.18 [2.16, 2.22] | 932 | 964 |
| usearch_f16 | 0.99 | 314.5 | 10 | 0.9937 | yes / yes | 3.45 [3.36, 3.54] | 1124 | 1142 |
| usearch_f16 | 0.995 | 505.1 | 10 | 0.9965 | yes / no | 5.54 [5.47, 5.62] | 1124 | 1124 |
| usearch_i8 | 0.98 | 147.9 | 10 | 0.9853 | yes / yes | 1.62 [1.61, 1.66] | 549 | 546 |
| usearch_i8 | 0.99 | 233.7 | 10 | 0.9911 | yes / no | 2.56 [2.54, 2.63] | 741 | 700 |
| usearch_i8 | 0.995 | 423.3 | 10 | 0.9958 | yes / no | 4.65 [4.60, 4.69] | 613 | 600 |

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| diskann_vamana | L 400 | 3147.9 / 1.0000 |
| diskann_vamana | L 800 | 5350.7 / 1.0000 |
| faiss_bin_flat | exhaustive | 1556.7 / 0.9999 |
| faiss_bin_hnsw | ef 400 | 1275.2 / 0.9999 |
| faiss_bin_hnsw | ef 800 | 2270.3 / 0.9999 |
| faiss_hnsw_flat | ef 400 | 2281.1 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 4007.2 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 9781.3 / 1.0000 |
| faiss_rabitq_ivf | nprobe 2 | 326.8 / 0.9018 |
| faiss_rabitq_ivf | nprobe 4 | 372.4 / 0.9616 |
| hnswlib_f32 | ef 400 | 2835.2 / 1.0000 |
| hnswlib_f32 | ef 800 | 4993.2 / 1.0000 |
| ours_scan | ef 400 | 198.8 / 0.9999 |
| ours_walk | ef 400 | 199.7 / 0.9999 |
| ours_walk | ef 800 | 271.8 / 0.9999 |
| scann | leaves_to_search 2, reorder 400 | 380.6 / 0.8422 |
| scann | leaves_to_search 4, reorder 400 | 409.5 / 0.9306 |
| usearch_b1_rescore | ef 400 | 1458.0 / 0.9991 |
| usearch_b1_rescore | ef 800 | 2597.2 / 0.9991 |

## mac (frozen points from the arm shortlist, R = own A/A)

### advtest / CodeRankEmbed (n_ho = 1200, exact quality 0.4732)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 64.5 | 4 | 0.9796 | no / no | 0.95 [0.93, 0.96] | 280 | 224 |
| faiss_bin_flat | 0.99 | 161.6 | 4 | 0.9954 | yes / no | 2.21 [2.19, 2.23] | 280 | 226 |
| faiss_bin_flat | 0.995 | 161.6 | 4 | 0.9954 | yes / no | 2.05 [2.03, 2.08] | 280 | 226 |
| faiss_bin_hnsw | 0.98 | 265.5 | 4 | 0.9778 | no / no | 3.91 [3.82, 3.92] | 281 | 228 |
| faiss_bin_hnsw | 0.99 | 408.2 | 4 | 0.9963 | yes / no | 5.58 [5.49, 5.60] | 281 | 228 |
| faiss_bin_hnsw | 0.995 | 596.8 | 4 | 0.9963 | yes / no | 7.59 [7.53, 7.72] | 281 | 226 |
| faiss_exact | 0.98 | 1020.5 | 4 | 1.0000 | yes / yes | 15.04 [14.68, 15.12] | 99 | 14 |
| faiss_exact | 0.99 | 1020.5 | 4 | 1.0000 | yes / yes | 13.96 [13.88, 14.04] | 99 | 14 |
| faiss_exact | 0.995 | 1020.5 | 4 | 1.0000 | yes / yes | 12.98 [12.90, 13.11] | 99 | 14 |
| faiss_hnsw_flat | 0.98 | 320.4 | 4 | 0.9935 | yes / yes | 4.72 [4.61, 4.77] | 99 | 14 |
| faiss_hnsw_flat | 0.99 | 419.2 | 4 | 0.9971 | yes / yes | 5.73 [5.68, 5.76] | 99 | 15 |
| faiss_hnsw_flat | 0.995 | 790.3 | 4 | 0.9995 | yes / yes | 10.05 [9.91, 10.17] | 99 | 15 |
| faiss_hnsw_sq8 | 0.98 | 316.2 | 4 | 0.9864 | yes / no | 4.66 [4.53, 4.71] | 279 | 228 |
| faiss_hnsw_sq8 | 0.99 | 471.7 | 4 | 0.9971 | yes / yes | 6.45 [6.41, 6.55] | 279 | 230 |
| faiss_hnsw_sq8 | 0.995 | 844.1 | 4 | 0.9996 | yes / yes | 10.74 [10.61, 10.84] | 279 | 228 |
| faiss_ivfpq_fs | 0.98 | 180.6 | 4 | 0.9999 | yes / yes | 2.66 [2.60, 2.70] | 283 | 225 |
| faiss_ivfpq_fs | 0.99 | 180.6 | 4 | 0.9999 | yes / yes | 2.47 [2.46, 2.51] | 283 | 225 |
| faiss_ivfpq_fs | 0.995 | 180.6 | 4 | 0.9999 | yes / yes | 2.30 [2.28, 2.33] | 283 | 225 |
| faiss_rabitq_flat | 0.98 | 664.7 | 4 | 0.9937 | yes / yes | 9.79 [9.56, 9.82] | 279 | 224 |
| faiss_rabitq_flat | 0.99 | 676.4 | 4 | 0.9986 | yes / yes | 9.25 [9.20, 9.28] | 279 | 224 |
| faiss_rabitq_flat | 0.995 | 676.4 | 4 | 0.9986 | yes / yes | 8.60 [8.53, 8.67] | 279 | 224 |
| faiss_rabitq_hnsw | 0.98 | 159.6 | 4 | 0.9881 | yes / no | 2.35 [2.28, 2.37] | 279 | 227 |
| faiss_rabitq_hnsw | 0.99 | 276.9 | 4 | 0.9979 | yes / yes | 3.79 [3.73, 3.82] | 279 | 227 |
| faiss_rabitq_hnsw | 0.995 | 337.9 | 4 | 0.9989 | yes / no | 4.30 [4.24, 4.34] | 279 | 227 |
| faiss_rabitq_ivf | 0.98 | 1018.8 | 4 | 1.0000 | yes / yes | 15.01 [14.65, 15.04] | 282 | 225 |
| faiss_rabitq_ivf | 0.99 | 1018.8 | 4 | 1.0000 | yes / yes | 13.94 [13.86, 13.98] | 282 | 225 |
| faiss_rabitq_ivf | 0.995 | 1018.8 | 4 | 1.0000 | yes / yes | 12.96 [12.87, 13.05] | 282 | 225 |
| hnswlib_f32 | 0.98 | 457.5 | 4 | 0.9854 | yes / no | 6.74 [6.54, 6.88] | 113 | 49 |
| hnswlib_f32 | 0.99 | 733.9 | 4 | 0.9953 | yes / no | 10.04 [9.79, 10.30] | 107 | 47 |
| hnswlib_f32 | 0.995 | 824.6 | 4 | 1.0000 | yes / yes | 10.49 [10.38, 10.68] | 113 | 49 |
| ours_cascade | 0.98 | 67.9 | 4 | 0.9832 | yes / no |  | 106 | 11 |
| ours_cascade | 0.99 | 73.1 | 4 | 0.9909 | yes / no |  | 106 | 11 |
| ours_cascade | 0.995 | 78.6 | 4 | 0.9946 | no / no |  | 106 | 11 |
| usearch_b1_rescore | 0.98 | 287.4 | 4 | 0.9914 | yes / yes | 4.23 [4.13, 4.25] | 289 | 227 |
| usearch_b1_rescore | 0.99 | 338.8 | 4 | 0.9902 | yes / no | 4.63 [4.59, 4.74] | 295 | 228 |
| usearch_b1_rescore | 0.995 | 338.8 | 4 | 0.9902 | no / no | 4.31 [4.26, 4.41] | 295 | 228 |
| usearch_f16 | 0.98 | 713.6 | 4 | 0.9859 | yes / no | 10.52 [10.27, 10.53] | 75 | 10 |
| usearch_f16 | 0.99 | 816.2 | 4 | 1.0010 | yes / yes | 11.17 [11.10, 11.20] | 81 | 12 |
| usearch_f16 | 0.995 | 1412.1 | 4 | 1.0013 | yes / yes | 17.96 [17.83, 18.10] | 81 | 12 |
| usearch_i8 | 0.98 | 186.3 | 4 | 0.9948 | yes / yes | 2.74 [2.67, 2.80] | 59 | 7 |
| usearch_i8 | 0.99 | 375.2 | 4 | 0.9973 | yes / no | 5.13 [5.04, 5.22] | 65 | 8 |
No held-out record on this machine: scann.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| faiss_bin_flat | exhaustive | 244.5 / 0.9972 |
| faiss_bin_hnsw | ef 400 | 543.9 / 0.9958 |
| faiss_bin_hnsw | ef 800 | 1049.9 / 0.9969 |
| faiss_hnsw_flat | ef 400 | 1421.5 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 2450.8 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 941.0 / 1.0000 |
| faiss_rabitq_ivf | nprobe 18 | 312.6 / 0.7543 |
| faiss_rabitq_ivf | nprobe 9 | 240.6 / 0.6515 |
| hnswlib_f32 | ef 400 | 2092.9 / 0.9995 |
| hnswlib_f32 | ef 800 | 3297.3 / 1.0000 |
| ours_scan | ef 400 | 79.7 / 0.9970 |
| ours_walk | ef 400 | 110.5 / 0.9966 |
| ours_walk | ef 800 | 129.5 / 0.9969 |
| usearch_b1_rescore | ef 400 | 409.2 / 0.9904 |
| usearch_b1_rescore | ef 800 | 644.0 / 0.9912 |

### csn1m / CodeRankEmbed (n_ho = 2400, exact quality 0.5497)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 1356.4 | 4 | 0.9914 | yes / yes | 6.28 [6.23, 6.41] | 9137 | 10188 |
| faiss_bin_flat | 0.99 | 1419.7 | 4 | 0.9942 | yes / no | 4.98 [4.95, 5.06] | 9137 | 10141 |
| faiss_bin_flat | 0.995 | 1598.0 | 4 | 0.9969 | yes / no | 4.50 [4.37, 4.71] | 9137 | 10145 |
| faiss_bin_hnsw | 0.98 | 873.1 | 4 | 0.9935 | yes / yes | 4.04 [4.01, 4.13] | 9139 | 10272 |
| faiss_bin_hnsw | 0.99 | 1478.1 | 4 | 0.9946 | yes / no | 5.19 [4.96, 5.95] | 9139 | 10256 |
| faiss_bin_hnsw | 0.995 | 5420.5 | 4 | 0.9971 | yes / no | 15.28 [12.16, 18.64] | 8034 | 10279 |
| faiss_exact | 0.98 | 56425.6 | 4 | 1.0000 | yes / yes | 261.32 [248.20, 380.85] | 3014 | 622 |
| faiss_exact | 0.99 | 56425.6 | 4 | 1.0000 | yes / yes | 197.94 [188.01, 288.48] | 3014 | 622 |
| faiss_exact | 0.995 | 56425.6 | 4 | 1.0000 | yes / yes | 159.03 [151.05, 231.77] | 3014 | 622 |
| faiss_hnsw_flat | 0.98 | 1016.6 | 4 | 0.9930 | yes / yes | 4.71 [4.66, 4.80] | 3509 | 698 |
| faiss_hnsw_flat | 0.99 | 1473.0 | 4 | 0.9965 | yes / yes | 5.17 [5.14, 5.23] | 3509 | 705 |
| faiss_hnsw_flat | 0.995 | 1889.1 | 4 | 0.9969 | yes / no | 5.32 [5.26, 5.40] | 3509 | 695 |
| faiss_hnsw_sq8 | 0.98 | 810.9 | 4 | 0.9905 | yes / yes | 3.76 [3.72, 3.84] | 9138 | 10325 |
| faiss_hnsw_sq8 | 0.99 | 1435.6 | 4 | 0.9974 | yes / yes | 5.04 [5.01, 5.10] | 9874 | 10417 |
| faiss_hnsw_sq8 | 0.995 | 2679.5 | 4 | 0.9986 | yes / yes | 7.55 [7.45, 7.63] | 9874 | 10389 |
| faiss_ivfpq_fs | 0.98 | 1978.3 | 4 | 0.9909 | yes / yes | 9.16 [9.08, 9.35] | 9271 | 10164 |
| faiss_ivfpq_fs | 0.99 | 2486.0 | 4 | 0.9940 | yes / no | 8.72 [8.68, 8.83] | 9247 | 10156 |
| faiss_ivfpq_fs | 0.995 | 3477.1 | 4 | 0.9963 | yes / no | 9.80 [9.70, 9.85] | 9271 | 10167 |
| faiss_rabitq_flat | 0.98 | 30153.5 | 4 | 0.9965 | yes / yes | 139.65 [138.44, 142.49] | 9137 | 10177 |
| faiss_rabitq_flat | 0.99 | 30153.5 | 4 | 0.9965 | yes / yes | 105.78 [105.50, 107.09] | 9137 | 10177 |
| faiss_rabitq_flat | 0.995 | 30190.5 | 4 | 1.0001 | yes / yes | 85.09 [84.24, 85.49] | 9137 | 10180 |
| faiss_rabitq_hnsw | 0.98 | 868.6 | 4 | 0.9873 | yes / no | 4.02 [3.99, 4.11] | 9138 | 10288 |
| faiss_rabitq_hnsw | 0.99 | 1622.2 | 4 | 0.9942 | yes / no | 5.69 [5.67, 5.76] | 9138 | 10265 |
| faiss_rabitq_hnsw | 0.995 | 3137.2 | 4 | 0.9973 | yes / no | 8.84 [8.75, 8.94] | 9138 | 10288 |
| faiss_rabitq_ivf | 0.98 | 10728.0 | 4 | 0.9908 | yes / yes | 49.68 [49.25, 50.69] | 7721 | 10182 |
| faiss_rabitq_ivf | 0.99 | 16396.3 | 4 | 0.9938 | yes / no | 57.52 [57.28, 58.23] | 7702 | 10166 |
| faiss_rabitq_ivf | 0.995 | 20727.9 | 4 | 0.9962 | yes / no | 58.42 [57.84, 58.70] | 9263 | 10188 |
| hnswlib_f32 | 0.98 | 1693.3 | 4 | 0.9932 | yes / yes | 7.84 [7.77, 8.00] | 3386 | 2204 |
| hnswlib_f32 | 0.99 | 3112.9 | 4 | 0.9957 | yes / yes | 10.92 [10.89, 11.17] | 3386 | 2148 |
| hnswlib_f32 | 0.995 | 4050.5 | 4 | 0.9987 | yes / yes | 11.42 [11.30, 11.47] | 3631 | 2222 |
| ours_cascade | 0.98 | 215.9 | 4 | 0.9899 | yes / yes |  | 2110 | 692 |
| ours_cascade | 0.99 | 285.1 | 4 | 0.9957 | yes / yes |  | 2108 | 689 |
| ours_cascade | 0.995 | 354.8 | 4 | 0.9976 | yes / no |  | 2242 | 699 |
| usearch_b1_rescore | 0.98 | 930.9 | 4 | 0.9834 | yes / no | 4.31 [4.27, 4.40] | 9526 | 10323 |
| usearch_b1_rescore | 0.99 | 1832.5 | 4 | 0.9959 | yes / yes | 6.43 [6.34, 6.51] | 9771 | 10387 |
| usearch_f16 | 0.98 | 1776.6 | 4 | 0.9912 | yes / yes | 8.23 [8.07, 8.40] | 1901 | 501 |
| usearch_f16 | 0.99 | 3245.4 | 4 | 0.9945 | yes / no | 11.39 [11.31, 11.53] | 1901 | 454 |
| usearch_f16 | 0.995 | 6163.0 | 4 | 0.9995 | yes / yes | 17.37 [17.20, 17.52] | 2147 | 521 |
| usearch_i8 | 0.98 | 831.5 | 4 | 0.9873 | yes / no | 3.85 [3.81, 3.98] | 1411 | 352 |
| usearch_i8 | 0.99 | 1564.0 | 4 | 0.9936 | yes / no | 5.49 [5.44, 5.57] | 1165 | 301 |
| usearch_i8 | 0.995 | 5590.5 | 4 | 0.9958 | yes / no | 15.76 [15.60, 15.85] | 1165 | 309 |
No held-out record on this machine: scann.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| faiss_bin_flat | exhaustive | 1635.7 / 0.9977 |
| faiss_bin_hnsw | ef 400 | 1021.9 / 0.9871 |
| faiss_bin_hnsw | ef 800 | 1948.8 / 0.9927 |
| faiss_hnsw_flat | ef 400 | 3271.6 / 0.9991 |
| faiss_hnsw_flat | ef 800 | 6008.1 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 30676.3 / 1.0000 |
| faiss_rabitq_ivf | nprobe 2 | 381.7 / 0.5790 |
| faiss_rabitq_ivf | nprobe 4 | 467.1 / 0.7009 |
| hnswlib_f32 | ef 400 | 5621.7 / 0.9980 |
| hnswlib_f32 | ef 800 | 10219.0 / 0.9986 |
| ours_scan | ef 400 | 270.3 / 0.9957 |
| ours_walk | ef 400 | 266.5 / 0.9957 |
| ours_walk | ef 800 | 380.0 / 0.9957 |
| usearch_b1_rescore | ef 400 | 1060.2 / 0.9903 |
| usearch_b1_rescore | ef 800 | 1908.6 / 0.9955 |

### d20k / CodeRankEmbed (n_ho = 2400, exact quality 0.8271)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 42.8 | 4 | 0.9872 | yes / no | 0.71 [0.69, 0.72] | 297 | 206 |
| faiss_bin_flat | 0.99 | 57.4 | 4 | 0.9927 | yes / no | 0.96 [0.92, 0.96] | 297 | 208 |
| faiss_bin_flat | 0.995 | 57.4 | 4 | 0.9927 | no / no | 0.78 [0.76, 0.79] | 297 | 208 |
| faiss_bin_hnsw | 0.98 | 142.0 | 4 | 0.9829 | yes / no | 2.36 [2.28, 2.41] | 297 | 209 |
| faiss_bin_hnsw | 0.99 | 194.2 | 4 | 0.9937 | yes / no | 3.23 [3.12, 3.26] | 297 | 208 |
| faiss_bin_hnsw | 0.995 | 259.2 | 4 | 0.9962 | yes / no | 3.50 [3.44, 3.56] | 297 | 207 |
| faiss_exact | 0.98 | 949.4 | 4 | 1.0000 | yes / yes | 15.80 [15.26, 15.87] | 127 | 13 |
| faiss_exact | 0.99 | 949.4 | 4 | 1.0000 | yes / yes | 15.80 [15.26, 15.87] | 127 | 13 |
| faiss_exact | 0.995 | 949.4 | 4 | 1.0000 | yes / yes | 12.83 [12.61, 13.03] | 127 | 13 |
| faiss_hnsw_flat | 0.98 | 149.6 | 4 | 0.9892 | yes / yes | 2.49 [2.40, 2.50] | 128 | 13 |
| faiss_hnsw_flat | 0.99 | 277.6 | 4 | 0.9952 | yes / yes | 4.62 [4.46, 4.68] | 128 | 13 |
| faiss_hnsw_flat | 0.995 | 361.9 | 4 | 0.9990 | yes / yes | 4.89 [4.81, 4.99] | 128 | 14 |
| faiss_hnsw_sq8 | 0.98 | 208.2 | 4 | 0.9907 | yes / yes | 3.46 [3.35, 3.56] | 296 | 210 |
| faiss_hnsw_sq8 | 0.99 | 354.6 | 4 | 0.9952 | yes / yes | 5.90 [5.70, 5.95] | 296 | 211 |
| faiss_hnsw_sq8 | 0.995 | 459.4 | 4 | 0.9990 | yes / yes | 6.21 [6.10, 6.31] | 296 | 210 |
| faiss_ivfpq_fs | 0.98 | 199.9 | 4 | 1.0000 | yes / yes | 3.33 [3.21, 3.36] | 299 | 207 |
| faiss_ivfpq_fs | 0.99 | 199.9 | 4 | 1.0000 | yes / yes | 3.33 [3.21, 3.36] | 299 | 207 |
| faiss_ivfpq_fs | 0.995 | 199.9 | 4 | 1.0000 | yes / yes | 2.70 [2.66, 2.75] | 299 | 207 |
| faiss_rabitq_flat | 0.98 | 625.5 | 4 | 0.9998 | yes / yes | 10.41 [10.05, 10.46] | 298 | 206 |
| faiss_rabitq_flat | 0.99 | 625.5 | 4 | 0.9998 | yes / yes | 10.41 [10.05, 10.46] | 298 | 206 |
| faiss_rabitq_flat | 0.995 | 625.5 | 4 | 0.9998 | yes / yes | 8.45 [8.32, 8.59] | 298 | 206 |
| faiss_rabitq_hnsw | 0.98 | 148.8 | 4 | 0.9917 | yes / yes | 2.48 [2.39, 2.51] | 298 | 209 |
| faiss_rabitq_hnsw | 0.99 | 244.2 | 4 | 0.9981 | yes / yes | 4.06 [3.93, 4.09] | 298 | 209 |
| faiss_rabitq_hnsw | 0.995 | 427.3 | 4 | 0.9991 | yes / yes | 5.77 [5.67, 5.89] | 298 | 208 |
| faiss_rabitq_ivf | 0.98 | 960.1 | 4 | 0.9912 | yes / yes | 15.98 [15.43, 16.13] | 300 | 207 |
| faiss_rabitq_ivf | 0.99 | 997.1 | 4 | 1.0000 | yes / yes | 16.59 [16.03, 16.76] | 299 | 207 |
| faiss_rabitq_ivf | 0.995 | 997.1 | 4 | 1.0000 | yes / yes | 13.47 [13.27, 13.74] | 299 | 207 |
| hnswlib_f32 | 0.98 | 219.9 | 4 | 0.9851 | yes / no | 3.66 [3.54, 3.69] | 133 | 43 |
| hnswlib_f32 | 0.99 | 583.9 | 4 | 1.0002 | yes / yes | 9.72 [9.39, 9.83] | 135 | 44 |
| hnswlib_f32 | 0.995 | 762.6 | 4 | 0.9982 | yes / yes | 10.31 [10.14, 10.46] | 133 | 44 |
| ours_cascade | 0.98 | 60.1 | 4 | 0.9902 | yes / yes |  | 133 | 11 |
| ours_cascade | 0.99 | 60.1 | 4 | 0.9902 | yes / no |  | 133 | 11 |
| ours_cascade | 0.995 | 74.0 | 4 | 0.9941 | no / no |  | 133 | 12 |
| usearch_b1_rescore | 0.98 | 134.6 | 4 | 0.9822 | yes / no | 2.24 [2.16, 2.31] | 302 | 208 |
| usearch_b1_rescore | 0.99 | 165.4 | 4 | 0.9919 | yes / no | 2.75 [2.66, 2.81] | 305 | 208 |
| usearch_b1_rescore | 0.995 | 237.4 | 4 | 0.9931 | no / no | 3.21 [3.14, 3.28] | 310 | 209 |
| usearch_f16 | 0.98 | 381.8 | 4 | 0.9894 | yes / yes | 6.35 [6.14, 6.39] | 106 | 10 |
| usearch_f16 | 0.99 | 510.4 | 4 | 0.9902 | yes / no | 8.49 [8.20, 8.56] | 111 | 11 |
| usearch_f16 | 0.995 | 882.4 | 4 | 0.9955 | yes / no | 11.92 [11.75, 12.14] | 111 | 12 |
| usearch_i8 | 0.98 | 98.5 | 4 | 0.9877 | yes / yes | 1.64 [1.58, 1.65] | 91 | 6 |
| usearch_i8 | 0.99 | 105.4 | 4 | 0.9921 | yes / no | 1.75 [1.69, 1.83] | 97 | 7 |
| usearch_i8 | 0.995 | 320.8 | 4 | 0.9961 | yes / no | 4.33 [4.27, 4.42] | 97 | 8 |
No held-out record on this machine: scann.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| faiss_bin_flat | exhaustive | 234.9 / 0.9978 |
| faiss_bin_hnsw | ef 400 | 530.6 / 0.9983 |
| faiss_bin_hnsw | ef 800 | 1029.2 / 0.9978 |
| faiss_hnsw_flat | ef 400 | 1258.3 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 2191.4 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 874.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 18 | 317.2 / 0.8766 |
| faiss_rabitq_ivf | nprobe 9 | 242.9 / 0.7978 |
| hnswlib_f32 | ef 400 | 1705.0 / 1.0000 |
| hnswlib_f32 | ef 800 | 2717.7 / 1.0000 |
| ours_scan | ef 400 | 76.5 / 0.9979 |
| ours_walk | ef 400 | 103.6 / 0.9978 |
| ours_walk | ef 800 | 120.4 / 0.9978 |
| usearch_b1_rescore | ef 400 | 396.6 / 0.9957 |
| usearch_b1_rescore | ef 800 | 617.6 / 0.9961 |

### dall / CodeRankEmbed (n_ho = 2400, exact quality 0.7906)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 207.4 | 4 | 0.9868 | yes / no | 1.08 [1.08, 1.10] | 1993 | 1454 |
| faiss_bin_flat | 0.99 | 248.0 | 4 | 0.9944 | yes / no | 1.17 [1.15, 1.19] | 1993 | 1460 |
| faiss_bin_flat | 0.995 | 311.4 | 4 | 0.9973 | yes / no | 1.41 [1.39, 1.43] | 1993 | 1458 |
| faiss_bin_hnsw | 0.98 | 353.6 | 4 | 0.9828 | yes / no | 1.85 [1.82, 1.87] | 1995 | 1471 |
| faiss_bin_hnsw | 0.99 | 842.0 | 4 | 0.9918 | yes / no | 3.96 [3.95, 3.98] | 1995 | 1464 |
| faiss_bin_hnsw | 0.995 | 1787.0 | 4 | 0.9965 | yes / no | 8.09 [7.95, 8.17] | 1995 | 1471 |
| faiss_exact | 0.98 | 6732.0 | 4 | 1.0000 | yes / yes | 35.19 [34.93, 35.45] | 480 | 87 |
| faiss_exact | 0.99 | 6732.0 | 4 | 1.0000 | yes / yes | 31.66 [31.51, 31.82] | 480 | 87 |
| faiss_exact | 0.995 | 6732.0 | 4 | 1.0000 | yes / yes | 30.48 [29.96, 30.79] | 480 | 87 |
| faiss_hnsw_flat | 0.98 | 865.3 | 4 | 0.9906 | yes / yes | 4.52 [4.49, 4.55] | 500 | 84 |
| faiss_hnsw_flat | 0.99 | 1139.6 | 4 | 0.9937 | yes / no | 5.36 [5.33, 5.38] | 517 | 89 |
| faiss_hnsw_flat | 0.995 | 2199.7 | 4 | 0.9993 | yes / yes | 9.96 [9.79, 10.06] | 517 | 91 |
| faiss_hnsw_sq8 | 0.98 | 867.0 | 4 | 0.9891 | yes / yes | 4.53 [4.49, 4.56] | 1995 | 1472 |
| faiss_hnsw_sq8 | 0.99 | 1154.1 | 4 | 0.9943 | yes / no | 5.43 [5.40, 5.45] | 1995 | 1482 |
| faiss_hnsw_sq8 | 0.995 | 2195.9 | 4 | 0.9991 | yes / yes | 9.94 [9.77, 10.04] | 1995 | 1480 |
| faiss_ivfpq_fs | 0.98 | 703.5 | 4 | 0.9938 | yes / yes | 3.68 [3.64, 3.71] | 2017 | 1462 |
| faiss_ivfpq_fs | 0.99 | 795.3 | 4 | 0.9998 | yes / yes | 3.74 [3.73, 3.76] | 2012 | 1469 |
| faiss_ivfpq_fs | 0.995 | 795.3 | 4 | 0.9998 | yes / yes | 3.60 [3.54, 3.64] | 2012 | 1469 |
| faiss_rabitq_flat | 0.98 | 4229.6 | 4 | 0.9988 | yes / yes | 22.11 [21.95, 22.22] | 1993 | 1459 |
| faiss_rabitq_flat | 0.99 | 4229.6 | 4 | 0.9988 | yes / yes | 19.89 [19.83, 19.93] | 1993 | 1459 |
| faiss_rabitq_flat | 0.995 | 4229.6 | 4 | 0.9988 | yes / yes | 19.15 [18.83, 19.34] | 1993 | 1459 |
| faiss_rabitq_hnsw | 0.98 | 444.5 | 4 | 0.9843 | yes / no | 2.32 [2.31, 2.34] | 1995 | 1476 |
| faiss_rabitq_hnsw | 0.99 | 685.0 | 4 | 0.9931 | yes / no | 3.22 [3.20, 3.24] | 1995 | 1472 |
| faiss_rabitq_hnsw | 0.995 | 1131.3 | 4 | 0.9990 | yes / yes | 5.12 [5.04, 5.17] | 1995 | 1474 |
| faiss_rabitq_ivf | 0.98 | 3988.8 | 4 | 0.9938 | yes / yes | 20.85 [20.70, 21.04] | 2011 | 1462 |
| faiss_rabitq_ivf | 0.99 | 5114.4 | 4 | 1.0000 | yes / yes | 24.05 [23.98, 24.10] | 2012 | 1462 |
| faiss_rabitq_ivf | 0.995 | 5114.4 | 4 | 1.0000 | yes / yes | 23.16 [22.76, 23.39] | 2012 | 1462 |
| hnswlib_f32 | 0.98 | 1377.2 | 4 | 0.9902 | yes / yes | 7.20 [7.15, 7.24] | 560 | 313 |
| hnswlib_f32 | 0.99 | 2169.8 | 4 | 0.9980 | yes / yes | 10.20 [10.17, 10.22] | 526 | 301 |
| hnswlib_f32 | 0.995 | 4033.4 | 4 | 0.9986 | yes / yes | 18.26 [17.95, 18.45] | 526 | 303 |
| ours_cascade | 0.98 | 191.3 | 4 | 0.9852 | yes / no |  | 297 | 47 |
| ours_cascade | 0.99 | 212.6 | 4 | 0.9952 | yes / yes |  | 297 | 43 |
| ours_cascade | 0.995 | 220.9 | 4 | 0.9971 | yes / no |  | 296 | 55 |
| usearch_b1_rescore | 0.98 | 527.5 | 4 | 0.9838 | yes / no | 2.76 [2.74, 2.79] | 2050 | 1475 |
| usearch_b1_rescore | 0.99 | 775.8 | 4 | 0.9893 | no / no | 3.65 [3.62, 3.69] | 2084 | 1483 |
| usearch_b1_rescore | 0.995 | 1234.0 | 4 | 0.9940 | no / no | 5.59 [5.49, 5.64] | 2050 | 1474 |
| usearch_f16 | 0.98 | 1994.9 | 4 | 0.9910 | yes / yes | 10.43 [10.34, 10.49] | 322 | 66 |
| usearch_f16 | 0.99 | 2616.0 | 4 | 0.9935 | yes / no | 12.30 [12.26, 12.42] | 304 | 65 |
| usearch_f16 | 0.995 | 4065.0 | 4 | 0.9971 | yes / no | 18.40 [18.09, 18.59] | 357 | 76 |
| usearch_i8 | 0.98 | 876.6 | 4 | 0.9917 | yes / yes | 4.58 [4.55, 4.61] | 219 | 42 |
| usearch_i8 | 0.99 | 876.6 | 4 | 0.9917 | yes / no | 4.12 [4.10, 4.13] | 219 | 42 |
| usearch_i8 | 0.995 | 1677.9 | 4 | 0.9937 | no / no | 7.60 [7.47, 7.67] | 219 | 43 |
No held-out record on this machine: scann.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| faiss_bin_flat | exhaustive | 448.0 / 0.9982 |
| faiss_bin_hnsw | ef 400 | 657.5 / 0.9876 |
| faiss_bin_hnsw | ef 800 | 1291.0 / 0.9969 |
| faiss_hnsw_flat | ef 400 | 1957.3 / 0.9979 |
| faiss_hnsw_flat | ef 800 | 3618.8 / 0.9994 |
| faiss_rabitq_flat | exhaustive | 4570.4 / 1.0001 |
| faiss_rabitq_ivf | nprobe 4 | 261.4 / 0.5694 |
| faiss_rabitq_ivf | nprobe 8 | 331.2 / 0.6689 |
| hnswlib_f32 | ef 400 | 3431.4 / 0.9986 |
| hnswlib_f32 | ef 800 | 6105.7 / 0.9993 |
| ours_scan | ef 400 | 203.3 / 0.9981 |
| ours_walk | ef 400 | 162.7 / 0.9927 |
| ours_walk | ef 800 | 214.2 / 0.9948 |
| usearch_b1_rescore | ef 400 | 576.5 / 0.9842 |
| usearch_b1_rescore | ef 800 | 981.2 / 0.9944 |

### fiqa / bge-base-en-v1.5 (n_ho = 259, exact quality 0.4175)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_exact | 0.98 | 2736.1 | 4 | 1.0000 | yes / yes | 24.17 [24.09, 24.29] | 179 | 35 |
| faiss_exact | 0.99 | 2736.1 | 4 | 1.0000 | yes / yes | 20.97 [20.42, 21.25] | 179 | 35 |
| faiss_exact | 0.995 | 2736.1 | 4 | 1.0000 | yes / yes |  | 179 | 35 |
| faiss_hnsw_flat | 0.98 | 445.6 | 4 | 1.0001 | yes / yes | 3.94 [3.91, 4.14] | 194 | 38 |
| faiss_hnsw_flat | 0.99 | 445.6 | 4 | 1.0001 | yes / yes | 3.41 [3.33, 3.59] | 194 | 38 |
| faiss_hnsw_flat | 0.995 | 445.6 | 4 | 1.0001 | yes / yes |  | 194 | 38 |
| faiss_hnsw_sq8 | 0.98 | 342.4 | 4 | 0.9961 | yes / yes | 3.02 [3.00, 3.23] | 558 | 590 |
| faiss_hnsw_sq8 | 0.99 | 707.9 | 4 | 0.9726 | no / no | 5.42 [5.28, 5.61] | 600 | 597 |
| faiss_hnsw_sq8 | 0.995 | 1181.9 | 4 | 1.0000 | yes / yes |  | 558 | 593 |
| faiss_ivfpq_fs | 0.98 | 166.1 | 4 | 0.9935 | yes / yes | 1.47 [1.46, 1.47] | 568 | 585 |
| faiss_ivfpq_fs | 0.99 | 210.1 | 4 | 0.9947 | yes / no | 1.61 [1.57, 1.63] | 568 | 588 |
| faiss_ivfpq_fs | 0.995 | 273.6 | 4 | 1.0000 | yes / yes |  | 566 | 587 |
| faiss_rabitq_flat | 0.98 | 1765.1 | 4 | 0.9974 | yes / yes | 15.59 [15.56, 15.85] | 557 | 586 |
| faiss_rabitq_flat | 0.99 | 1765.1 | 4 | 0.9974 | yes / yes | 13.53 [13.17, 13.80] | 557 | 586 |
| faiss_rabitq_flat | 0.995 | 1765.1 | 4 | 0.9974 | yes / no |  | 557 | 586 |
| faiss_rabitq_hnsw | 0.98 | 551.6 | 4 | 1.0007 | yes / yes | 4.87 [4.85, 4.89] | 558 | 590 |
| faiss_rabitq_hnsw | 0.99 | 658.4 | 4 | 1.0039 | yes / yes | 5.05 [4.91, 5.11] | 558 | 590 |
| faiss_rabitq_hnsw | 0.995 | 815.9 | 4 | 1.0001 | yes / yes |  | 558 | 592 |
| faiss_rabitq_ivf | 0.98 | 636.4 | 4 | 0.9946 | yes / yes | 5.62 [5.58, 5.74] | 565 | 589 |
| faiss_rabitq_ivf | 0.99 | 636.4 | 4 | 0.9946 | yes / no | 4.88 [4.75, 4.99] | 565 | 589 |
| faiss_rabitq_ivf | 0.995 | 1184.5 | 4 | 1.0003 | yes / yes |  | 565 | 586 |
| hnswlib_f32 | 0.98 | 296.3 | 4 | 0.9879 | yes / no | 2.62 [2.61, 2.67] | 199 | 123 |
| hnswlib_f32 | 0.99 | 534.9 | 4 | 0.9902 | yes / no | 4.10 [3.99, 4.19] | 199 | 123 |
| hnswlib_f32 | 0.995 | 1672.0 | 4 | 1.0000 | yes / yes |  | 199 | 123 |
| ours_cascade | 0.98 | 113.2 | 4 | 0.9935 | yes / no |  | 86 | 16 |
| ours_cascade | 0.99 | 130.5 | 4 | 0.9959 | yes / no |  | 86 | 17 |
| usearch_f16 | 0.98 | 714.6 | 4 | 0.9896 | yes / no | 6.31 [6.28, 6.35] | 114 | 26 |
| usearch_f16 | 0.99 | 714.6 | 4 | 0.9896 | no / no | 5.48 [5.33, 5.55] | 114 | 26 |
| usearch_f16 | 0.995 | 1232.5 | 4 | 0.9895 | no / no |  | 114 | 27 |
| usearch_i8 | 0.98 | 238.1 | 4 | 0.9973 | yes / no | 2.10 [2.06, 2.63] | 72 | 17 |
No held-out record on this machine: scann.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| faiss_bin_flat | exhaustive | 315.2 / 0.9969 |
| faiss_bin_hnsw | ef 400 | 563.9 / 0.9876 |
| faiss_bin_hnsw | ef 800 | 1111.2 / 0.9969 |
| faiss_hnsw_flat | ef 400 | 1449.2 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 2559.3 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 2070.7 / 1.0000 |
| faiss_rabitq_ivf | nprobe 10 | 327.5 / 0.9588 |
| faiss_rabitq_ivf | nprobe 5 | 259.8 / 0.8618 |
| hnswlib_f32 | ef 400 | 2152.2 / 1.0000 |
| hnswlib_f32 | ef 800 | 3454.1 / 1.0000 |
| ours_scan | ef 400 | 118.6 / 0.9967 |
| ours_walk | ef 400 | 105.4 / 0.9994 |
| ours_walk | ef 800 | 126.4 / 0.9995 |
| usearch_b1_rescore | ef 400 | 422.4 / 0.9967 |
| usearch_b1_rescore | ef 800 | 664.7 / 0.9950 |

### gcsn / CodeRankEmbed (n_ho = 2400, exact quality 0.8412)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 25.3 | 4 | 0.9897 | yes / yes | 0.57 [0.56, 0.58] | 114 | 70 |
| faiss_bin_flat | 0.99 | 25.3 | 4 | 0.9897 | no / no | 0.57 [0.56, 0.58] | 114 | 70 |
| faiss_bin_flat | 0.995 | 37.6 | 4 | 0.9959 | yes / no | 0.68 [0.66, 0.70] | 114 | 70 |
| faiss_bin_hnsw | 0.98 | 94.6 | 4 | 0.9848 | yes / no | 2.13 [2.10, 2.16] | 114 | 71 |
| faiss_bin_hnsw | 0.99 | 116.5 | 4 | 0.9923 | yes / no | 2.62 [2.61, 2.66] | 116 | 71 |
| faiss_bin_hnsw | 0.995 | 131.2 | 4 | 0.9956 | yes / no | 2.37 [2.36, 2.40] | 114 | 71 |
| faiss_exact | 0.98 | 323.0 | 4 | 1.0000 | yes / yes | 7.27 [7.23, 7.35] | 89 | 5 |
| faiss_exact | 0.99 | 323.0 | 4 | 1.0000 | yes / yes | 7.27 [7.23, 7.35] | 89 | 5 |
| faiss_exact | 0.995 | 323.0 | 4 | 1.0000 | yes / yes | 5.84 [5.81, 5.88] | 89 | 5 |
| faiss_hnsw_flat | 0.98 | 98.9 | 4 | 0.9989 | yes / yes | 2.23 [2.19, 2.28] | 90 | 5 |
| faiss_hnsw_flat | 0.99 | 98.9 | 4 | 0.9989 | yes / yes | 2.23 [2.19, 2.28] | 90 | 5 |
| faiss_hnsw_flat | 0.995 | 124.8 | 4 | 0.9969 | yes / no | 2.26 [2.24, 2.29] | 89 | 6 |
| faiss_hnsw_sq8 | 0.98 | 125.1 | 4 | 0.9914 | yes / yes | 2.82 [2.80, 2.87] | 114 | 71 |
| faiss_hnsw_sq8 | 0.99 | 165.6 | 4 | 0.9956 | yes / yes | 3.73 [3.69, 3.79] | 115 | 71 |
| faiss_hnsw_sq8 | 0.995 | 249.7 | 4 | 0.9963 | yes / no | 4.52 [4.45, 4.57] | 119 | 72 |
| faiss_ivfpq_fs | 0.98 | 112.7 | 4 | 1.0000 | yes / yes | 2.54 [2.50, 2.63] | 115 | 70 |
| faiss_ivfpq_fs | 0.99 | 112.7 | 4 | 1.0000 | yes / yes | 2.54 [2.50, 2.63] | 115 | 70 |
| faiss_ivfpq_fs | 0.995 | 112.7 | 4 | 1.0000 | yes / yes | 2.04 [2.01, 2.12] | 115 | 70 |
| faiss_rabitq_flat | 0.98 | 232.4 | 4 | 0.9999 | yes / yes | 5.23 [5.19, 5.29] | 114 | 70 |
| faiss_rabitq_flat | 0.99 | 232.4 | 4 | 0.9999 | yes / yes | 5.23 [5.19, 5.29] | 114 | 70 |
| faiss_rabitq_flat | 0.995 | 232.4 | 4 | 0.9999 | yes / yes | 4.21 [4.17, 4.24] | 114 | 70 |
| faiss_rabitq_hnsw | 0.98 | 97.8 | 4 | 0.9912 | yes / yes | 2.20 [2.19, 2.23] | 114 | 71 |
| faiss_rabitq_hnsw | 0.99 | 102.9 | 4 | 0.9968 | yes / yes | 2.32 [2.29, 2.38] | 116 | 71 |
| faiss_rabitq_hnsw | 0.995 | 142.8 | 4 | 0.9986 | yes / yes | 2.58 [2.57, 2.62] | 114 | 71 |
| faiss_rabitq_ivf | 0.98 | 454.1 | 4 | 0.9961 | yes / yes | 10.22 [10.17, 10.34] | 116 | 71 |
| faiss_rabitq_ivf | 0.99 | 463.0 | 4 | 1.0000 | yes / yes | 10.42 [10.37, 10.54] | 115 | 71 |
| faiss_rabitq_ivf | 0.995 | 463.0 | 4 | 1.0000 | yes / yes | 8.38 [8.33, 8.44] | 115 | 71 |
| hnswlib_f32 | 0.98 | 119.0 | 4 | 0.9976 | yes / yes | 2.68 [2.66, 2.71] | 91 | 15 |
| hnswlib_f32 | 0.99 | 119.0 | 4 | 0.9976 | yes / yes | 2.68 [2.66, 2.71] | 91 | 15 |
| hnswlib_f32 | 0.995 | 202.7 | 4 | 1.0001 | yes / yes | 3.67 [3.64, 3.69] | 94 | 17 |
| ours_cascade | 0.98 | 44.4 | 4 | 0.9908 | yes / yes |  | 102 | 7 |
| ours_cascade | 0.99 | 44.4 | 4 | 0.9908 | yes / no |  | 102 | 7 |
| ours_cascade | 0.995 | 55.3 | 4 | 0.9959 | yes / no |  | 102 | 8 |
| usearch_b1_rescore | 0.98 | 119.4 | 4 | 0.9925 | yes / yes | 2.69 [2.67, 2.84] | 116 | 70 |
| usearch_b1_rescore | 0.99 | 142.6 | 4 | 0.9943 | yes / no | 3.21 [3.16, 3.25] | 117 | 71 |
| usearch_f16 | 0.98 | 215.7 | 4 | 0.9916 | yes / yes | 4.86 [4.79, 4.92] | 81 | 3 |
| usearch_f16 | 0.99 | 280.8 | 4 | 0.9951 | yes / yes | 6.32 [6.26, 6.39] | 82 | 4 |
| usearch_i8 | 0.98 | 63.4 | 4 | 0.9869 | yes / yes | 1.43 [1.41, 1.46] | 76 | 2 |
| usearch_i8 | 0.99 | 81.6 | 4 | 0.9918 | yes / no | 1.84 [1.80, 1.87] | 79 | 3 |
No held-out record on this machine: scann.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| faiss_bin_flat | exhaustive | 190.4 / 0.9996 |
| faiss_bin_hnsw | ef 400 | 451.9 / 0.9996 |
| faiss_bin_hnsw | ef 800 | 893.1 / 0.9996 |
| faiss_hnsw_flat | ef 400 | 790.6 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 1285.9 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 431.8 / 1.0000 |
| faiss_rabitq_ivf | nprobe 15 | 241.2 / 0.9175 |
| faiss_rabitq_ivf | nprobe 30 | 325.6 / 0.9669 |
| hnswlib_f32 | ef 400 | 832.4 / 1.0000 |
| hnswlib_f32 | ef 800 | 1072.1 / 1.0000 |
| ours_scan | ef 400 | 57.2 / 0.9996 |
| ours_walk | ef 400 | 77.5 / 0.9997 |
| ours_walk | ef 800 | 86.1 / 0.9997 |
| usearch_b1_rescore | ef 400 | 315.5 / 0.9963 |
| usearch_b1_rescore | ef 800 | 460.8 / 0.9963 |

### quora / bge-base-en-v1.5 (n_ho = 4000, exact quality 0.8914)

| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |
|---|---:|---:|---:|---:|---|---|---:|---:|
| faiss_bin_flat | 0.98 | 671.0 | 4 | 0.9915 | yes / yes | 9.32 [9.11, 9.52] | 4687 | 5268 |
| faiss_bin_flat | 0.99 | 680.0 | 4 | 0.9976 | yes / yes | 9.44 [9.23, 9.65] | 4687 | 5263 |
| faiss_bin_flat | 0.995 | 680.0 | 4 | 0.9976 | yes / yes | 9.44 [9.23, 9.65] | 4687 | 5263 |
| faiss_bin_hnsw | 0.98 | 61.2 | 4 | 0.9834 | yes / no | 0.85 [0.83, 0.87] | 4689 | 5302 |
| faiss_bin_hnsw | 0.99 | 77.6 | 4 | 0.9944 | yes / yes | 1.08 [1.05, 1.10] | 4689 | 5285 |
| faiss_bin_hnsw | 0.995 | 104.6 | 4 | 0.9975 | yes / yes | 1.45 [1.42, 1.48] | 4689 | 5295 |
| faiss_exact | 0.98 | 27231.9 | 4 | 1.0000 | yes / yes | 378.06 [354.50, 650.07] | 1661 | 378 |
| faiss_exact | 0.99 | 27231.9 | 4 | 1.0000 | yes / yes | 378.06 [354.50, 650.07] | 1661 | 378 |
| faiss_exact | 0.995 | 27231.9 | 4 | 1.0000 | yes / yes | 378.06 [354.50, 650.07] | 1661 | 378 |
| faiss_hnsw_flat | 0.98 | 85.3 | 4 | 0.9874 | yes / yes | 1.18 [1.16, 1.21] | 1730 | 313 |
| faiss_hnsw_flat | 0.99 | 124.2 | 4 | 0.9948 | yes / yes | 1.72 [1.69, 1.76] | 1730 | 315 |
| faiss_hnsw_flat | 0.995 | 157.2 | 4 | 0.9969 | yes / yes | 2.18 [2.13, 2.23] | 1793 | 334 |
| faiss_hnsw_sq8 | 0.98 | 89.5 | 4 | 0.9825 | yes / no | 1.24 [1.21, 1.28] | 4689 | 5347 |
| faiss_hnsw_sq8 | 0.99 | 134.2 | 4 | 0.9932 | yes / yes | 1.86 [1.82, 1.90] | 4689 | 5342 |
| faiss_hnsw_sq8 | 0.995 | 169.7 | 4 | 0.9967 | yes / no | 2.36 [2.30, 2.41] | 4689 | 5348 |
| faiss_ivfpq_fs | 0.98 | 137.6 | 4 | 0.9938 | yes / yes | 1.91 [1.87, 1.95] | 4746 | 5263 |
| faiss_ivfpq_fs | 0.99 | 197.7 | 4 | 0.9973 | yes / yes | 2.74 [2.68, 2.80] | 4746 | 5275 |
| faiss_ivfpq_fs | 0.995 | 313.9 | 4 | 0.9992 | yes / yes | 4.36 [4.26, 4.45] | 4746 | 5269 |
| faiss_rabitq_flat | 0.98 | 15713.0 | 4 | 0.9995 | yes / yes | 218.14 [213.30, 222.88] | 3952 | 5297 |
| faiss_rabitq_flat | 0.99 | 15713.0 | 4 | 0.9995 | yes / yes | 218.14 [213.30, 222.88] | 3952 | 5297 |
| faiss_rabitq_flat | 0.995 | 15713.0 | 4 | 0.9995 | yes / yes | 218.14 [213.30, 222.88] | 3952 | 5297 |
| faiss_rabitq_hnsw | 0.98 | 109.6 | 4 | 0.9896 | yes / yes | 1.52 [1.48, 1.56] | 4689 | 5329 |
| faiss_rabitq_hnsw | 0.99 | 109.6 | 4 | 0.9896 | no / no | 1.52 [1.48, 1.56] | 4689 | 5329 |
| faiss_rabitq_hnsw | 0.995 | 160.3 | 4 | 0.9959 | yes / no | 2.23 [2.18, 2.27] | 4689 | 5325 |
| faiss_rabitq_ivf | 0.98 | 299.2 | 4 | 0.9884 | yes / yes | 4.15 [4.06, 4.24] | 4752 | 5278 |
| faiss_rabitq_ivf | 0.99 | 687.5 | 4 | 0.9969 | yes / yes | 9.54 [9.33, 9.75] | 4752 | 5271 |
| faiss_rabitq_ivf | 0.995 | 1207.3 | 4 | 0.9983 | yes / yes | 16.76 [16.39, 17.13] | 4752 | 5276 |
| hnswlib_f32 | 0.98 | 149.3 | 4 | 0.9852 | yes / yes | 2.07 [2.03, 2.12] | 1795 | 1104 |
| hnswlib_f32 | 0.99 | 240.1 | 4 | 0.9942 | yes / yes | 3.33 [3.26, 3.41] | 1795 | 1104 |
| hnswlib_f32 | 0.995 | 358.1 | 4 | 0.9972 | yes / yes | 4.97 [4.86, 5.08] | 1986 | 1144 |
| ours_cascade | 0.98 | 72.0 | 4 | 0.9983 | yes / yes |  | 1018 | 202 |
| ours_cascade | 0.99 | 72.0 | 4 | 0.9983 | yes / yes |  | 1018 | 202 |
| ours_cascade | 0.995 | 72.0 | 4 | 0.9983 | yes / yes |  | 1018 | 202 |
| usearch_b1_rescore | 0.98 | 74.5 | 4 | 0.9941 | yes / yes | 1.03 [1.01, 1.08] | 4826 | 5316 |
| usearch_b1_rescore | 0.99 | 83.7 | 4 | 0.9929 | yes / yes | 1.16 [1.12, 1.19] | 4826 | 5327 |
| usearch_b1_rescore | 0.995 | 99.3 | 4 | 0.9973 | yes / yes | 1.38 [1.35, 1.41] | 4889 | 5350 |
| usearch_f16 | 0.98 | 145.0 | 4 | 0.9839 | yes / no | 2.01 [1.97, 2.06] | 1002 | 218 |
| usearch_f16 | 0.99 | 222.4 | 4 | 0.9937 | yes / yes | 3.09 [3.02, 3.16] | 1194 | 263 |
| usearch_f16 | 0.995 | 355.1 | 4 | 0.9965 | yes / no | 4.93 [4.82, 5.04] | 1194 | 263 |
| usearch_i8 | 0.98 | 69.2 | 4 | 0.9853 | yes / yes | 0.96 [0.94, 1.00] | 618 | 141 |
| usearch_i8 | 0.99 | 104.6 | 4 | 0.9911 | yes / no | 1.45 [1.42, 1.48] | 810 | 185 |
| usearch_i8 | 0.995 | 193.6 | 4 | 0.9958 | yes / no | 2.69 [2.61, 2.76] | 682 | 155 |
No held-out record on this machine: scann.

Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): held-out µs / retained quality.

| Generator | Effort | C 400 / H 100 |
|---|---|---:|
| faiss_bin_flat | exhaustive | 972.4 / 0.9999 |
| faiss_bin_hnsw | ef 400 | 823.5 / 0.9999 |
| faiss_bin_hnsw | ef 800 | 1581.9 / 0.9999 |
| faiss_hnsw_flat | ef 400 | 2075.4 / 1.0000 |
| faiss_hnsw_flat | ef 800 | 3818.2 / 1.0000 |
| faiss_rabitq_flat | exhaustive | 16146.1 / 1.0000 |
| faiss_rabitq_ivf | nprobe 2 | 313.5 / 0.9018 |
| faiss_rabitq_ivf | nprobe 4 | 374.8 / 0.9616 |
| hnswlib_f32 | ef 400 | 3637.7 / 1.0000 |
| hnswlib_f32 | ef 800 | 6380.6 / 1.0000 |
| ours_scan | ef 400 | 146.0 / 0.9999 |
| ours_walk | ef 400 | 146.5 / 0.9999 |
| ours_walk | ef 800 | 196.9 / 0.9999 |
| usearch_b1_rescore | ef 400 | 722.5 / 0.9991 |
| usearch_b1_rescore | ef 800 | 1252.2 / 0.9991 |

## Build cost at 1M (csn1m; memory-admitted builds, not isolated cost runs)

| Model | Family | Params | Wall s | Threads | Core-s | Size GB | Peak RSS GB |
|---|---|---|---:|---:|---:|---:|---:|
| CodeRankEmbed | diskann_vamana | {"L": "100", "R": "32", "alpha": "1.2"} | 151 | 16 | 2418 | 3.22 | 6.3 |
| CodeRankEmbed | diskann_vamana | {"L": "100", "R": "64", "alpha": "1.2"} | 1100 | 16 | 17606 | 3.34 | 6.5 |
| CodeRankEmbed | diskann_vamana | {"L": "100", "R": "96", "alpha": "1.2"} | 1349 | 16 | 21581 | 3.42 | 6.7 |
| CodeRankEmbed | diskann_vamana | {"L": "200", "R": "32", "alpha": "1.2"} | 1152 | 16 | 18427 | 3.22 | 6.3 |
| CodeRankEmbed | diskann_vamana | {"L": "200", "R": "64", "alpha": "1.2"} | 1762 | 16 | 28186 | 3.35 | 6.5 |
| CodeRankEmbed | diskann_vamana | {"L": "200", "R": "96", "alpha": "1.2"} | 1990 | 16 | 31839 | 3.47 | 6.7 |
| CodeRankEmbed | faiss_bin_flat | {} | 0 | 16 | 3 | 0.06 | 6.0 |
| CodeRankEmbed | faiss_bin_hnsw | {"M": "16", "efC": "200"} | 154 | 16 | 2464 | 0.21 | 6.0 |
| CodeRankEmbed | faiss_bin_hnsw | {"M": "16", "efC": "800"} | 460 | 16 | 7365 | 0.21 | 6.0 |
| CodeRankEmbed | faiss_bin_hnsw | {"M": "32", "efC": "200"} | 242 | 16 | 3866 | 0.34 | 6.0 |
| CodeRankEmbed | faiss_bin_hnsw | {"M": "32", "efC": "800"} | 786 | 16 | 12568 | 0.34 | 6.0 |
| CodeRankEmbed | faiss_bin_hnsw | {"M": "64", "efC": "200"} | 325 | 16 | 5199 | 0.59 | 6.0 |
| CodeRankEmbed | faiss_bin_hnsw | {"M": "64", "efC": "800"} | 1260 | 16 | 20152 | 0.59 | 6.0 |
| CodeRankEmbed | faiss_exact | {} | 10 | 16 | 165 | 3.09 | 6.0 |
| CodeRankEmbed | faiss_hnsw_flat | {"M": "16", "efC": "200"} | 182 | 16 | 2917 | 3.23 | 6.2 |
| CodeRankEmbed | faiss_hnsw_flat | {"M": "16", "efC": "800"} | 1889 | 16 | 30219 | 3.23 | 6.2 |
| CodeRankEmbed | faiss_hnsw_flat | {"M": "32", "efC": "200"} | 827 | 16 | 13226 | 3.36 | 6.4 |
| CodeRankEmbed | faiss_hnsw_flat | {"M": "32", "efC": "800"} | 3705 | 16 | 59278 | 3.36 | 6.4 |
| CodeRankEmbed | faiss_hnsw_flat | {"M": "64", "efC": "200"} | 1199 | 16 | 19191 | 3.62 | 6.6 |
| CodeRankEmbed | faiss_hnsw_flat | {"M": "64", "efC": "800"} | 4882 | 16 | 78120 | 3.62 | 6.6 |
| CodeRankEmbed | faiss_hnsw_sq8 | {"M": "16", "efC": "200"} | 724 | 16 | 11583 | 0.92 | 6.0 |
| CodeRankEmbed | faiss_hnsw_sq8 | {"M": "16", "efC": "800"} | 2281 | 16 | 36499 | 0.92 | 6.0 |
| CodeRankEmbed | faiss_hnsw_sq8 | {"M": "32", "efC": "200"} | 1028 | 16 | 16440 | 1.05 | 6.0 |
| CodeRankEmbed | faiss_hnsw_sq8 | {"M": "32", "efC": "800"} | 4005 | 16 | 64079 | 1.05 | 6.0 |
| CodeRankEmbed | faiss_hnsw_sq8 | {"M": "64", "efC": "200"} | 1346 | 16 | 21537 | 1.30 | 6.0 |
| CodeRankEmbed | faiss_hnsw_sq8 | {"M": "64", "efC": "800"} | 5936 | 16 | 94976 | 1.30 | 6.0 |
| CodeRankEmbed | faiss_ivfpq_fs | {"nlist": "1002"} | 350 | 16 | 5594 | 0.11 | 6.0 |
| CodeRankEmbed | faiss_ivfpq_fs | {"nlist": "4008"} | 503 | 16 | 8043 | 0.12 | 6.0 |
| CodeRankEmbed | faiss_rabitq_flat | {} | 4 | 16 | 65 | 0.10 | 6.0 |
| CodeRankEmbed | faiss_rabitq_hnsw | {"M": "16", "efC": "200"} | 221 | 16 | 3539 | 0.25 | 6.0 |
| CodeRankEmbed | faiss_rabitq_hnsw | {"M": "16", "efC": "800"} | 740 | 16 | 11843 | 0.25 | 6.0 |
| CodeRankEmbed | faiss_rabitq_hnsw | {"M": "32", "efC": "200"} | 382 | 16 | 6107 | 0.38 | 6.0 |
| CodeRankEmbed | faiss_rabitq_hnsw | {"M": "32", "efC": "800"} | 1092 | 16 | 17466 | 0.38 | 6.0 |
| CodeRankEmbed | faiss_rabitq_hnsw | {"M": "64", "efC": "200"} | 618 | 16 | 9894 | 0.64 | 6.0 |
| CodeRankEmbed | faiss_rabitq_hnsw | {"M": "64", "efC": "800"} | 1464 | 16 | 23419 | 0.64 | 6.0 |
| CodeRankEmbed | faiss_rabitq_ivf | {"nlist": "1002"} | 61 | 16 | 975 | 0.12 | 6.0 |
| CodeRankEmbed | faiss_rabitq_ivf | {"nlist": "4008"} | 205 | 16 | 3278 | 0.12 | 6.0 |
| CodeRankEmbed | hnswlib_f32 | {"M": "16", "efC": "200"} | 165 | 16 | 2643 | 3.24 | 6.3 |
| CodeRankEmbed | hnswlib_f32 | {"M": "16", "efC": "800"} | 542 | 16 | 8672 | 3.24 | 6.3 |
| CodeRankEmbed | hnswlib_f32 | {"M": "32", "efC": "200"} | 283 | 16 | 4530 | 3.36 | 6.4 |
| CodeRankEmbed | hnswlib_f32 | {"M": "32", "efC": "800"} | 1029 | 16 | 16471 | 3.36 | 6.4 |
| CodeRankEmbed | hnswlib_f32 | {"M": "64", "efC": "200"} | 368 | 16 | 5891 | 3.62 | 6.7 |
| CodeRankEmbed | hnswlib_f32 | {"M": "64", "efC": "800"} | 4227 | 16 | 67624 | 3.62 | 6.7 |
| CodeRankEmbed | ours | M=64,efC=800 | 20303 | 1 | 20303 | 2.77 | 15.7 |
| CodeRankEmbed | scann | {"leaves": "1002", "mode": "tree_ah", "soar": "0"} | 82 | 16 | 1320 | 3.48 | 10.7 |
| CodeRankEmbed | scann | {"leaves": "1002", "mode": "tree_ah", "soar": "1"} | 80 | 16 | 1286 | 3.87 | 10.7 |
| CodeRankEmbed | scann | {"leaves": "2004", "mode": "tree_ah", "soar": "0"} | 86 | 16 | 1378 | 3.49 | 10.8 |
| CodeRankEmbed | scann | {"leaves": "2004", "mode": "tree_ah", "soar": "1"} | 182 | 16 | 2914 | 3.88 | 11.7 |
| CodeRankEmbed | svs_vamana_leanvec | {"degree": "32"} | 147 | 16 | 2349 | 1.05 | 7.6 |
| CodeRankEmbed | svs_vamana_leanvec | {"degree": "64"} | 230 | 16 | 3685 | 1.18 | 7.6 |
| CodeRankEmbed | svs_vamana_lvq | {"degree": "32"} | 924 | 16 | 14785 | 1.30 | 6.0 |
| CodeRankEmbed | svs_vamana_lvq | {"degree": "64"} | 1468 | 16 | 23481 | 1.43 | 6.0 |
| CodeRankEmbed | usearch_b1_rescore | {"M": "16", "efC": "200"} | 205 | 16 | 3283 | 0.21 | 6.0 |
| CodeRankEmbed | usearch_b1_rescore | {"M": "16", "efC": "800"} | 789 | 16 | 12626 | 0.21 | 6.0 |
| CodeRankEmbed | usearch_b1_rescore | {"M": "32", "efC": "200"} | 282 | 16 | 4514 | 0.34 | 6.0 |
| CodeRankEmbed | usearch_b1_rescore | {"M": "32", "efC": "800"} | 933 | 16 | 14926 | 0.34 | 6.0 |
| CodeRankEmbed | usearch_b1_rescore | {"M": "64", "efC": "200"} | 340 | 16 | 5446 | 0.60 | 6.0 |
| CodeRankEmbed | usearch_b1_rescore | {"M": "64", "efC": "800"} | 1235 | 16 | 19755 | 0.60 | 6.0 |
| CodeRankEmbed | usearch_f16 | {"M": "16", "efC": "200"} | 918 | 16 | 14696 | 1.69 | 6.0 |
| CodeRankEmbed | usearch_f16 | {"M": "16", "efC": "800"} | 3581 | 16 | 57290 | 1.69 | 6.0 |
| CodeRankEmbed | usearch_f16 | {"M": "32", "efC": "200"} | 1275 | 16 | 20397 | 1.82 | 6.0 |
| CodeRankEmbed | usearch_f16 | {"M": "32", "efC": "800"} | 4698 | 16 | 75167 | 1.82 | 6.0 |
| CodeRankEmbed | usearch_f16 | {"M": "64", "efC": "200"} | 2019 | 16 | 32310 | 2.08 | 6.0 |
| CodeRankEmbed | usearch_f16 | {"M": "64", "efC": "800"} | 4873 | 16 | 77975 | 2.08 | 6.0 |
| CodeRankEmbed | usearch_i8 | {"M": "16", "efC": "200"} | 659 | 16 | 10551 | 0.92 | 6.0 |
| CodeRankEmbed | usearch_i8 | {"M": "16", "efC": "800"} | 2826 | 16 | 45221 | 0.92 | 6.0 |
| CodeRankEmbed | usearch_i8 | {"M": "32", "efC": "200"} | 1126 | 16 | 18011 | 1.05 | 6.0 |
| CodeRankEmbed | usearch_i8 | {"M": "32", "efC": "800"} | 4258 | 16 | 68126 | 1.05 | 6.0 |
| CodeRankEmbed | usearch_i8 | {"M": "64", "efC": "200"} | 1382 | 16 | 22120 | 1.31 | 6.0 |
| CodeRankEmbed | usearch_i8 | {"M": "64", "efC": "800"} | 6844 | 16 | 109506 | 1.31 | 6.0 |
| bge-base-en-v1.5 | diskann_vamana | {"L": "100", "R": "32", "alpha": "1.2"} | 149 | 16 | 2377 | 3.22 | 6.3 |
| bge-base-en-v1.5 | diskann_vamana | {"L": "100", "R": "64", "alpha": "1.2"} | 628 | 16 | 10050 | 3.35 | 6.5 |
| bge-base-en-v1.5 | diskann_vamana | {"L": "100", "R": "96", "alpha": "1.2"} | 1270 | 16 | 20321 | 3.47 | 6.7 |
| bge-base-en-v1.5 | diskann_vamana | {"L": "200", "R": "32", "alpha": "1.2"} | 258 | 16 | 4125 | 3.22 | 6.3 |
| bge-base-en-v1.5 | diskann_vamana | {"L": "200", "R": "64", "alpha": "1.2"} | 1507 | 16 | 24107 | 3.35 | 6.5 |
| bge-base-en-v1.5 | diskann_vamana | {"L": "200", "R": "96", "alpha": "1.2"} | 1793 | 16 | 28684 | 3.48 | 6.7 |
| bge-base-en-v1.5 | faiss_bin_flat | {} | 0 | 16 | 4 | 0.06 | 6.0 |
| bge-base-en-v1.5 | faiss_bin_hnsw | {"M": "16", "efC": "200"} | 111 | 16 | 1771 | 0.21 | 6.0 |
| bge-base-en-v1.5 | faiss_bin_hnsw | {"M": "16", "efC": "800"} | 392 | 16 | 6268 | 0.21 | 6.0 |
| bge-base-en-v1.5 | faiss_bin_hnsw | {"M": "32", "efC": "200"} | 188 | 16 | 3015 | 0.34 | 6.0 |
| bge-base-en-v1.5 | faiss_bin_hnsw | {"M": "32", "efC": "800"} | 615 | 16 | 9844 | 0.34 | 6.0 |
| bge-base-en-v1.5 | faiss_bin_hnsw | {"M": "64", "efC": "200"} | 236 | 16 | 3771 | 0.59 | 6.0 |
| bge-base-en-v1.5 | faiss_bin_hnsw | {"M": "64", "efC": "800"} | 867 | 16 | 13869 | 0.59 | 6.0 |
| bge-base-en-v1.5 | faiss_exact | {} | 7 | 16 | 107 | 3.09 | 6.0 |
| bge-base-en-v1.5 | faiss_hnsw_flat | {"M": "16", "efC": "200"} | 173 | 16 | 2773 | 3.23 | 6.2 |
| bge-base-en-v1.5 | faiss_hnsw_flat | {"M": "16", "efC": "800"} | 577 | 16 | 9239 | 3.23 | 6.2 |
| bge-base-en-v1.5 | faiss_hnsw_flat | {"M": "32", "efC": "200"} | 643 | 16 | 10292 | 3.36 | 6.4 |
| bge-base-en-v1.5 | faiss_hnsw_flat | {"M": "32", "efC": "800"} | 2549 | 16 | 40785 | 3.36 | 6.4 |
| bge-base-en-v1.5 | faiss_hnsw_flat | {"M": "64", "efC": "200"} | 790 | 16 | 12634 | 3.62 | 6.6 |
| bge-base-en-v1.5 | faiss_hnsw_flat | {"M": "64", "efC": "800"} | 3124 | 16 | 49983 | 3.62 | 6.6 |
| bge-base-en-v1.5 | faiss_hnsw_sq8 | {"M": "16", "efC": "200"} | 618 | 16 | 9881 | 0.92 | 6.0 |
| bge-base-en-v1.5 | faiss_hnsw_sq8 | {"M": "16", "efC": "800"} | 1978 | 16 | 31646 | 0.92 | 6.0 |
| bge-base-en-v1.5 | faiss_hnsw_sq8 | {"M": "32", "efC": "200"} | 819 | 16 | 13097 | 1.05 | 6.0 |
| bge-base-en-v1.5 | faiss_hnsw_sq8 | {"M": "32", "efC": "800"} | 3035 | 16 | 48561 | 1.05 | 6.0 |
| bge-base-en-v1.5 | faiss_hnsw_sq8 | {"M": "64", "efC": "200"} | 1000 | 16 | 16002 | 1.30 | 6.0 |
| bge-base-en-v1.5 | faiss_hnsw_sq8 | {"M": "64", "efC": "800"} | 3774 | 16 | 60390 | 1.30 | 6.0 |
| bge-base-en-v1.5 | faiss_ivfpq_fs | {"nlist": "1002"} | 343 | 16 | 5491 | 0.11 | 6.0 |
| bge-base-en-v1.5 | faiss_ivfpq_fs | {"nlist": "4008"} | 400 | 16 | 6400 | 0.12 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_flat | {} | 4 | 16 | 62 | 0.10 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_hnsw | {"M": "16", "efC": "200"} | 162 | 16 | 2596 | 0.25 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_hnsw | {"M": "16", "efC": "800"} | 590 | 16 | 9435 | 0.25 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_hnsw | {"M": "32", "efC": "200"} | 301 | 16 | 4822 | 0.38 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_hnsw | {"M": "32", "efC": "800"} | 810 | 16 | 12966 | 0.38 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_hnsw | {"M": "64", "efC": "200"} | 459 | 16 | 7344 | 0.64 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_hnsw | {"M": "64", "efC": "800"} | 987 | 16 | 15796 | 0.64 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_ivf | {"nlist": "1002"} | 55 | 16 | 878 | 0.12 | 6.0 |
| bge-base-en-v1.5 | faiss_rabitq_ivf | {"nlist": "4008"} | 219 | 16 | 3501 | 0.12 | 6.0 |
| bge-base-en-v1.5 | hnswlib_f32 | {"M": "16", "efC": "200"} | 154 | 16 | 2459 | 3.24 | 6.3 |
| bge-base-en-v1.5 | hnswlib_f32 | {"M": "16", "efC": "800"} | 507 | 16 | 8110 | 3.24 | 6.3 |
| bge-base-en-v1.5 | hnswlib_f32 | {"M": "32", "efC": "200"} | 240 | 16 | 3844 | 3.36 | 6.4 |
| bge-base-en-v1.5 | hnswlib_f32 | {"M": "32", "efC": "800"} | 891 | 16 | 14263 | 3.36 | 6.4 |
| bge-base-en-v1.5 | hnswlib_f32 | {"M": "64", "efC": "200"} | 293 | 16 | 4691 | 3.62 | 6.7 |
| bge-base-en-v1.5 | hnswlib_f32 | {"M": "64", "efC": "800"} | 1290 | 16 | 20640 | 3.62 | 6.7 |
| bge-base-en-v1.5 | scann | {"leaves": "1002", "mode": "tree_ah", "soar": "0"} | 76 | 16 | 1214 | 3.48 | 10.7 |
| bge-base-en-v1.5 | scann | {"leaves": "1002", "mode": "tree_ah", "soar": "1"} | 64 | 16 | 1032 | 3.87 | 10.7 |
| bge-base-en-v1.5 | scann | {"leaves": "2004", "mode": "tree_ah", "soar": "0"} | 59 | 16 | 950 | 3.49 | 10.8 |
| bge-base-en-v1.5 | scann | {"leaves": "2004", "mode": "tree_ah", "soar": "1"} | 199 | 16 | 3182 | 3.88 | 11.7 |
| bge-base-en-v1.5 | svs_vamana_leanvec | {"degree": "32"} | 138 | 16 | 2213 | 1.05 | 7.6 |
| bge-base-en-v1.5 | svs_vamana_leanvec | {"degree": "64"} | 184 | 16 | 2939 | 1.18 | 7.6 |
| bge-base-en-v1.5 | svs_vamana_lvq | {"degree": "32"} | 1024 | 16 | 16391 | 1.30 | 6.0 |
| bge-base-en-v1.5 | svs_vamana_lvq | {"degree": "64"} | 1410 | 16 | 22556 | 1.43 | 6.0 |
| bge-base-en-v1.5 | usearch_b1_rescore | {"M": "16", "efC": "200"} | 218 | 16 | 3484 | 0.21 | 6.0 |
| bge-base-en-v1.5 | usearch_b1_rescore | {"M": "16", "efC": "800"} | 703 | 16 | 11254 | 0.21 | 6.0 |
| bge-base-en-v1.5 | usearch_b1_rescore | {"M": "32", "efC": "200"} | 239 | 16 | 3824 | 0.34 | 6.0 |
| bge-base-en-v1.5 | usearch_b1_rescore | {"M": "32", "efC": "800"} | 737 | 16 | 11789 | 0.34 | 6.0 |
| bge-base-en-v1.5 | usearch_b1_rescore | {"M": "64", "efC": "200"} | 231 | 16 | 3698 | 0.60 | 6.0 |
| bge-base-en-v1.5 | usearch_b1_rescore | {"M": "64", "efC": "800"} | 964 | 16 | 15429 | 0.60 | 6.0 |
| bge-base-en-v1.5 | usearch_f16 | {"M": "16", "efC": "200"} | 733 | 16 | 11722 | 1.69 | 6.0 |
| bge-base-en-v1.5 | usearch_f16 | {"M": "16", "efC": "800"} | 2524 | 16 | 40391 | 1.69 | 6.0 |
| bge-base-en-v1.5 | usearch_f16 | {"M": "32", "efC": "200"} | 956 | 16 | 15295 | 1.82 | 6.0 |
| bge-base-en-v1.5 | usearch_f16 | {"M": "32", "efC": "800"} | 3307 | 16 | 52908 | 1.82 | 6.0 |
| bge-base-en-v1.5 | usearch_f16 | {"M": "64", "efC": "200"} | 1140 | 16 | 18232 | 2.08 | 6.0 |
| bge-base-en-v1.5 | usearch_f16 | {"M": "64", "efC": "800"} | 3844 | 16 | 61496 | 2.08 | 6.0 |
| bge-base-en-v1.5 | usearch_i8 | {"M": "16", "efC": "200"} | 356 | 16 | 5703 | 0.92 | 6.0 |
| bge-base-en-v1.5 | usearch_i8 | {"M": "16", "efC": "800"} | 1742 | 16 | 27873 | 0.92 | 6.0 |
| bge-base-en-v1.5 | usearch_i8 | {"M": "32", "efC": "200"} | 704 | 16 | 11265 | 1.05 | 6.0 |
| bge-base-en-v1.5 | usearch_i8 | {"M": "32", "efC": "800"} | 2883 | 16 | 46126 | 1.05 | 6.0 |
| bge-base-en-v1.5 | usearch_i8 | {"M": "64", "efC": "200"} | 803 | 16 | 12850 | 1.31 | 6.0 |
| bge-base-en-v1.5 | usearch_i8 | {"M": "64", "efC": "800"} | 4245 | 16 | 67917 | 1.31 | 6.0 |
| jina-v2-base-code | diskann_vamana | {"L": "100", "R": "32", "alpha": "1.2"} | 549 | 16 | 8779 | 3.22 | 6.3 |
| jina-v2-base-code | diskann_vamana | {"L": "100", "R": "64", "alpha": "1.2"} | 1006 | 16 | 16095 | 3.33 | 6.5 |
| jina-v2-base-code | diskann_vamana | {"L": "100", "R": "96", "alpha": "1.2"} | 1110 | 16 | 17753 | 3.41 | 6.7 |
| jina-v2-base-code | diskann_vamana | {"L": "200", "R": "32", "alpha": "1.2"} | 982 | 16 | 15709 | 3.22 | 6.3 |
| jina-v2-base-code | diskann_vamana | {"L": "200", "R": "64", "alpha": "1.2"} | 1497 | 16 | 23956 | 3.34 | 6.5 |
| jina-v2-base-code | diskann_vamana | {"L": "200", "R": "96", "alpha": "1.2"} | 1452 | 16 | 23228 | 3.45 | 6.7 |
| jina-v2-base-code | faiss_bin_flat | {} | 0 | 16 | 2 | 0.06 | 6.0 |
| jina-v2-base-code | faiss_bin_hnsw | {"M": "16", "efC": "200"} | 140 | 16 | 2244 | 0.21 | 6.0 |
| jina-v2-base-code | faiss_bin_hnsw | {"M": "16", "efC": "800"} | 444 | 16 | 7097 | 0.21 | 6.0 |
| jina-v2-base-code | faiss_bin_hnsw | {"M": "32", "efC": "200"} | 184 | 16 | 2946 | 0.34 | 6.0 |
| jina-v2-base-code | faiss_bin_hnsw | {"M": "32", "efC": "800"} | 738 | 16 | 11814 | 0.34 | 6.0 |
| jina-v2-base-code | faiss_bin_hnsw | {"M": "64", "efC": "200"} | 243 | 16 | 3893 | 0.59 | 6.0 |
| jina-v2-base-code | faiss_bin_hnsw | {"M": "64", "efC": "800"} | 989 | 16 | 15825 | 0.59 | 6.0 |
| jina-v2-base-code | faiss_exact | {} | 8 | 16 | 130 | 3.09 | 6.0 |
| jina-v2-base-code | faiss_hnsw_flat | {"M": "16", "efC": "200"} | 166 | 16 | 2658 | 3.23 | 6.2 |
| jina-v2-base-code | faiss_hnsw_flat | {"M": "16", "efC": "800"} | 1524 | 16 | 24380 | 3.23 | 6.2 |
| jina-v2-base-code | faiss_hnsw_flat | {"M": "32", "efC": "200"} | 645 | 16 | 10327 | 3.36 | 6.4 |
| jina-v2-base-code | faiss_hnsw_flat | {"M": "32", "efC": "800"} | 2845 | 16 | 45526 | 3.36 | 6.4 |
| jina-v2-base-code | faiss_hnsw_flat | {"M": "64", "efC": "200"} | 851 | 16 | 13623 | 3.62 | 6.6 |
| jina-v2-base-code | faiss_hnsw_flat | {"M": "64", "efC": "800"} | 3506 | 16 | 56092 | 3.62 | 6.6 |
| jina-v2-base-code | faiss_hnsw_sq8 | {"M": "16", "efC": "200"} | 642 | 16 | 10264 | 0.92 | 6.0 |
| jina-v2-base-code | faiss_hnsw_sq8 | {"M": "16", "efC": "800"} | 2090 | 16 | 33438 | 0.92 | 6.0 |
| jina-v2-base-code | faiss_hnsw_sq8 | {"M": "32", "efC": "200"} | 827 | 16 | 13232 | 1.05 | 6.0 |
| jina-v2-base-code | faiss_hnsw_sq8 | {"M": "32", "efC": "800"} | 3312 | 16 | 52993 | 1.05 | 6.0 |
| jina-v2-base-code | faiss_hnsw_sq8 | {"M": "64", "efC": "200"} | 1037 | 16 | 16584 | 1.30 | 6.0 |
| jina-v2-base-code | faiss_hnsw_sq8 | {"M": "64", "efC": "800"} | 4150 | 16 | 66395 | 1.30 | 6.0 |
| jina-v2-base-code | faiss_ivfpq_fs | {"nlist": "1002"} | 354 | 16 | 5658 | 0.11 | 6.0 |
| jina-v2-base-code | faiss_ivfpq_fs | {"nlist": "4008"} | 440 | 16 | 7039 | 0.12 | 6.0 |
| jina-v2-base-code | faiss_rabitq_flat | {} | 3 | 16 | 55 | 0.10 | 6.0 |
| jina-v2-base-code | faiss_rabitq_hnsw | {"M": "16", "efC": "200"} | 192 | 16 | 3068 | 0.25 | 6.0 |
| jina-v2-base-code | faiss_rabitq_hnsw | {"M": "16", "efC": "800"} | 637 | 16 | 10188 | 0.25 | 6.0 |
| jina-v2-base-code | faiss_rabitq_hnsw | {"M": "32", "efC": "200"} | 320 | 16 | 5122 | 0.38 | 6.0 |
| jina-v2-base-code | faiss_rabitq_hnsw | {"M": "32", "efC": "800"} | 886 | 16 | 14182 | 0.38 | 6.0 |
| jina-v2-base-code | faiss_rabitq_hnsw | {"M": "64", "efC": "200"} | 507 | 16 | 8112 | 0.64 | 6.0 |
| jina-v2-base-code | faiss_rabitq_hnsw | {"M": "64", "efC": "800"} | 1161 | 16 | 18570 | 0.64 | 6.0 |
| jina-v2-base-code | faiss_rabitq_ivf | {"nlist": "1002"} | 59 | 16 | 948 | 0.12 | 6.0 |
| jina-v2-base-code | faiss_rabitq_ivf | {"nlist": "4008"} | 202 | 16 | 3229 | 0.12 | 6.0 |
| jina-v2-base-code | hnswlib_f32 | {"M": "16", "efC": "200"} | 145 | 16 | 2325 | 3.24 | 6.3 |
| jina-v2-base-code | hnswlib_f32 | {"M": "16", "efC": "800"} | 464 | 16 | 7422 | 3.24 | 6.3 |
| jina-v2-base-code | hnswlib_f32 | {"M": "32", "efC": "200"} | 227 | 16 | 3639 | 3.36 | 6.4 |
| jina-v2-base-code | hnswlib_f32 | {"M": "32", "efC": "800"} | 849 | 16 | 13580 | 3.36 | 6.4 |
| jina-v2-base-code | hnswlib_f32 | {"M": "64", "efC": "200"} | 278 | 16 | 4442 | 3.62 | 6.7 |
| jina-v2-base-code | hnswlib_f32 | {"M": "64", "efC": "800"} | 1274 | 16 | 20376 | 3.62 | 6.7 |
| jina-v2-base-code | scann | {"leaves": "1002", "mode": "tree_ah", "soar": "0"} | 77 | 16 | 1234 | 3.48 | 10.7 |
| jina-v2-base-code | scann | {"leaves": "1002", "mode": "tree_ah", "soar": "1"} | 68 | 16 | 1089 | 3.87 | 10.7 |
| jina-v2-base-code | scann | {"leaves": "2004", "mode": "tree_ah", "soar": "0"} | 80 | 16 | 1279 | 3.49 | 10.8 |
| jina-v2-base-code | scann | {"leaves": "2004", "mode": "tree_ah", "soar": "1"} | 149 | 16 | 2392 | 3.88 | 11.7 |
| jina-v2-base-code | svs_vamana_leanvec | {"degree": "32"} | 139 | 16 | 2231 | 1.05 | 7.6 |
| jina-v2-base-code | svs_vamana_leanvec | {"degree": "64"} | 189 | 16 | 3028 | 1.18 | 7.6 |
| jina-v2-base-code | svs_vamana_lvq | {"degree": "32"} | 821 | 16 | 13131 | 1.30 | 6.0 |
| jina-v2-base-code | svs_vamana_lvq | {"degree": "64"} | 1173 | 16 | 18768 | 1.43 | 6.0 |
| jina-v2-base-code | usearch_b1_rescore | {"M": "16", "efC": "200"} | 183 | 16 | 2923 | 0.21 | 6.0 |
| jina-v2-base-code | usearch_b1_rescore | {"M": "16", "efC": "800"} | 719 | 16 | 11500 | 0.21 | 6.0 |
| jina-v2-base-code | usearch_b1_rescore | {"M": "32", "efC": "200"} | 219 | 16 | 3509 | 0.34 | 6.0 |
| jina-v2-base-code | usearch_b1_rescore | {"M": "32", "efC": "800"} | 766 | 16 | 12248 | 0.34 | 6.0 |
| jina-v2-base-code | usearch_b1_rescore | {"M": "64", "efC": "200"} | 238 | 16 | 3811 | 0.60 | 6.0 |
| jina-v2-base-code | usearch_b1_rescore | {"M": "64", "efC": "800"} | 955 | 16 | 15280 | 0.60 | 6.0 |
| jina-v2-base-code | usearch_f16 | {"M": "16", "efC": "200"} | 800 | 16 | 12799 | 1.69 | 6.0 |
| jina-v2-base-code | usearch_f16 | {"M": "16", "efC": "800"} | 2639 | 16 | 42222 | 1.69 | 6.0 |
| jina-v2-base-code | usearch_f16 | {"M": "32", "efC": "200"} | 1030 | 16 | 16487 | 1.82 | 6.0 |
| jina-v2-base-code | usearch_f16 | {"M": "32", "efC": "800"} | 3525 | 16 | 56401 | 1.82 | 6.0 |
| jina-v2-base-code | usearch_f16 | {"M": "64", "efC": "200"} | 1230 | 16 | 19673 | 2.08 | 6.0 |
| jina-v2-base-code | usearch_f16 | {"M": "64", "efC": "800"} | 4302 | 16 | 68837 | 2.08 | 6.0 |
| jina-v2-base-code | usearch_i8 | {"M": "16", "efC": "200"} | 129 | 16 | 2057 | 0.92 | 6.0 |
| jina-v2-base-code | usearch_i8 | {"M": "16", "efC": "800"} | 1974 | 16 | 31581 | 0.92 | 6.0 |
| jina-v2-base-code | usearch_i8 | {"M": "32", "efC": "200"} | 680 | 16 | 10878 | 1.05 | 6.0 |
| jina-v2-base-code | usearch_i8 | {"M": "32", "efC": "800"} | 3067 | 16 | 49075 | 1.05 | 6.0 |
| jina-v2-base-code | usearch_i8 | {"M": "64", "efC": "200"} | 823 | 16 | 13162 | 1.31 | 6.0 |
| jina-v2-base-code | usearch_i8 | {"M": "64", "efC": "800"} | 4743 | 16 | 75891 | 1.31 | 6.0 |
