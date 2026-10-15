# Workload table (build rows measured by the S3a pilot; timing rows are estimates from v4)

Pilot: S3a pilot, intel c8i.4xlarge (16 vCPU), csn1m/CodeRankEmbed, 2026-10-15; build core-s = build_s x threads at n=1,004,739

Assumptions: {"lat_graph_1m": 0.0006, "lat_flat_bin_1m": 0.004, "lat_flat_f32_1m": 0.06, "lat_ivf_1m": 0.0015, "lat_ours_1m": 0.00025, "proc_overhead": 3.0, "load_1m": 15.0, "build_graph_1m": 9600, "build_ivf_1m": 1920, "build_flat_1m": 160, "build_ours_1m": 7541, "build_diskann_1m": 14400, "build_scann_1m": 801, "embed_docs_per_s": 1000000000000.0, "build_svs_vamana_leanvec_1m": 1930, "build_usearch_f16_1m": 24525, "build_faiss_hnsw_sq8_1m": 20815, "build_faiss_hnsw_flat_1m": 20225, "build_faiss_rabitq_ivf_1m": 138, "build_svs_vamana_lvq_1m": 5101, "build_usearch_b1_rescore_1m": 3158, "build_faiss_bin_hnsw_1m": 3406, "build_faiss_ivfpq_fs_1m": 152, "build_diskann_vamana_1m": 6470, "build_hnswlib_f32_1m": 22535, "build_faiss_rabitq_hnsw_1m": 2616, "build_faiss_bin_flat_1m": 1, "build_usearch_i8_1m": 24525}. Dev sweep rounds per point: 1; held-out rounds R = 5.
Times are machine-hours per AWS timing machine (intel, amd, arm each run the same rows); builds run once on `build` and are copied (index files are portable across CPUs; checked in S3a).

| Set | Model | Vectors | Builds | Build core-h | (B) dev points | (A) dev points | Dev h / machine | Held-out h / machine | GPU h |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gcsn | CodeRankEmbed | 6,918 | 67 | 0.9 | 657 | 264 | 0.9 | 1.5 | 0.00 |
| gcsn | jina-embeddings-v2-base-code | 6,918 | 67 | 0.9 | 657 | 264 | 0.9 | 1.5 | 0.00 |
| gcsn | bge-base-en-v1.5 | 6,918 | 67 | 0.9 | 657 | 264 | 0.9 | 1.5 | 0.00 |
| d20k | CodeRankEmbed | 20,000 | 67 | 3.0 | 665 | 264 | 1.0 | 1.6 | 0.00 |
| d20k | jina-embeddings-v2-base-code | 20,000 | 67 | 3.0 | 665 | 264 | 1.0 | 1.6 | 0.00 |
| d20k | bge-base-en-v1.5 | 20,000 | 67 | 3.0 | 665 | 264 | 1.0 | 1.6 | 0.00 |
| advtest | CodeRankEmbed | 21,731 | 67 | 3.3 | 665 | 264 | 0.9 | 1.6 | 0.00 |
| advtest | jina-embeddings-v2-base-code | 21,731 | 67 | 3.3 | 665 | 264 | 0.9 | 1.6 | 0.00 |
| advtest | bge-base-en-v1.5 | 21,731 | 67 | 3.3 | 665 | 264 | 0.9 | 1.6 | 0.00 |
| dall | CodeRankEmbed | 140,449 | 70 | 25.5 | 697 | 264 | 1.7 | 2.6 | 0.00 |
| dall | jina-embeddings-v2-base-code | 140,449 | 70 | 25.5 | 697 | 264 | 1.7 | 2.6 | 0.00 |
| dall | bge-base-en-v1.5 | 140,449 | 70 | 25.5 | 697 | 264 | 1.7 | 2.6 | 0.00 |
| csn1m | CodeRankEmbed | 1,004,739 | 70 | 222.1 | 705 | 264 | 5.8 | 8.4 | 0.00 |
| csn1m | jina-embeddings-v2-base-code | 1,004,739 | 70 | 222.1 | 705 | 264 | 5.8 | 8.4 | 0.00 |
| csn1m | bge-base-en-v1.5 | 1,004,739 | 70 | 222.1 | 705 | 264 | 5.8 | 8.4 | 0.00 |
| fiqa | CodeRankEmbed | 57,638 | 67 | 9.5 | 665 | 264 | 1.0 | 1.7 | 0.00 |
| fiqa | jina-embeddings-v2-base-code | 57,638 | 67 | 9.5 | 665 | 264 | 1.0 | 1.7 | 0.00 |
| fiqa | bge-base-en-v1.5 | 57,638 | 67 | 9.5 | 665 | 264 | 1.0 | 1.7 | 0.00 |
| quora | CodeRankEmbed | 522,931 | 70 | 108.3 | 705 | 264 | 4.0 | 5.6 | 0.00 |
| quora | jina-embeddings-v2-base-code | 522,931 | 70 | 108.3 | 705 | 264 | 4.0 | 5.6 | 0.00 |
| quora | bge-base-en-v1.5 | 522,931 | 70 | 108.3 | 705 | 264 | 4.0 | 5.6 | 0.00 |
| **total** | | | 1434 | 1118 | 14277 | 5544 | 46 | 69 | 0.0 |

Cost estimate at on-demand prices (intel 0.75, amd 0.75, arm 0.64, build 32 vCPU ~1.5, GPU 0.8 $/h): timing 115 h x 3 machines, build ~35 h wall, GPU 0.0 h -> about $299. Box and Mac rows run free (S6, S8).
