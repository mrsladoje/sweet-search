# Replication: held-out results (pre-registered tests, REPLICATION_PLAN.md)

| CPU | Set | Rival | Rounds | Ours µs | Rival µs | rival/ours [95% CI] | mean log ratio | p (latency) | Holm | mean(ours−rival) | lower | margin | p (quality) | Holm | Meets 0.99 ours ; rival |
|---|---|---|---:|---:|---:|---|---:|---:|---|---:|---:|---:|---:|---|---|
| intel | cqadup | svs_vamana_lvq | 12 | 182.2 | 259.6 | 1.45 [1.42, 1.47] | +0.370 | 0.0000 | pass | -0.0010 | -0.0031 | -0.0021 | 0.1584 | fail | yes/no ; yes/no |
| intel | msmarco1m | svs_vamana_lvq | 12 | 310.0 | 857.1 | 2.81 [2.71, 2.94] | +1.035 | 0.0000 | pass | +0.0021 | -0.0003 | -0.0035 | 0.0001 | pass | yes/yes ; yes/yes |
| amd | cqadup | faiss_hnsw_sq8 | 12 | 127.9 | 272.6 | 2.13 [2.12, 2.14] | +0.756 | 0.0000 | pass | +0.0000 | -0.0020 | -0.0021 | 0.0207 | fail | yes/no ; yes/no |
| amd | msmarco1m | faiss_hnsw_sq8 | 11 | 189.1 | 533.1 | 2.83 [2.78, 2.87] | +1.039 | 0.0000 | pass | +0.0006 | -0.0016 | -0.0035 | 0.0002 | pass | yes/yes ; yes/yes |
| arm | cqadup | faiss_hnsw_flat | 12 | 285.6 | 606.8 | 2.15 [2.09, 2.23] | +0.767 | 0.0000 | pass | -0.0001 | -0.0022 | -0.0021 | 0.0283 | fail | yes/no ; yes/no |
| arm | msmarco1m | faiss_bin_hnsw | 12 | 474.9 | 1158.2 | 2.43 [2.40, 2.47] | +0.888 | 0.0000 | pass | +0.0017 | +0.0003 | -0.0035 | 0.0001 | pass | yes/yes ; yes/yes |
