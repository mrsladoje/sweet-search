# Replication: held-out results (pre-registered tests, REPLICATION_PLAN.md)

| CPU | Set | Rival | Rounds | Ours µs | Rival µs | rival/ours [95% CI] | mean log ratio | p (latency) | Holm | mean(ours−rival) | lower | margin | p (quality) | Holm | Meets 0.99 ours ; rival |
|---|---|---|---:|---:|---:|---|---:|---:|---|---:|---:|---:|---:|---|---|
| intel | cqadup | svs_vamana_lvq | 12 | 199.0 | 283.4 | 1.41 [1.37, 1.44] | +0.340 | 0.0000 | pass | -0.0010 | -0.0031 | -0.0021 | 0.1584 | fail | yes/no ; yes/no |
| intel | msmarco1m | svs_vamana_lvq | 12 | 332.7 | 866.1 | 2.64 [2.59, 2.70] | +0.970 | 0.0000 | pass | +0.0021 | -0.0003 | -0.0035 | 0.0001 | pass | yes/yes ; yes/yes |
| amd | cqadup | faiss_hnsw_sq8 | 12 | 125.1 | 264.9 | 2.12 [2.10, 2.14] | +0.751 | 0.0000 | pass | +0.0000 | -0.0020 | -0.0021 | 0.0207 | fail | yes/no ; yes/no |
| amd | msmarco1m | faiss_hnsw_sq8 | 12 | 192.0 | 526.1 | 2.75 [2.73, 2.78] | +1.012 | 0.0000 | pass | +0.0006 | -0.0016 | -0.0035 | 0.0002 | pass | yes/yes ; yes/yes |
| arm | cqadup | faiss_hnsw_flat | 12 | 310.4 | 632.5 | 2.07 [2.04, 2.11] | +0.728 | 0.0000 | pass | -0.0001 | -0.0022 | -0.0021 | 0.0283 | fail | yes/no ; yes/no |
| arm | msmarco1m | faiss_bin_hnsw | 12 | 513.8 | 1207.7 | 2.36 [2.31, 2.41] | +0.858 | 0.0000 | pass | +0.0017 | +0.0003 | -0.0035 | 0.0001 | pass | yes/yes ; yes/yes |
