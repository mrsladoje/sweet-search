# Post-freeze experiments (held-out queries; reported apart from the pre-registered results)

## (A) stage clocks, C 400 / H 100

| CPU | Set | Generator | Build | Effort | Env | Rounds | conv µs | gen µs | shared µs | total µs | Retained |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| amd | advtest | ours_scan |  | {'ef': 400} |  | 5 | 3.8 | 44.3 | 41.6 | 92.7 | 0.9970 |
| amd | advtest | ours_walk |  | {'ef': 400} |  | 5 | 4.1 | 61.9 | 46.0 | 114.3 | 0.9966 |
| amd | advtest | ours_walk |  | {'ef': 400} | fixed | 5 | 4.1 | 96.2 | 49.3 | 153.5 | 0.9969 |
| amd | advtest | ours_walk |  | {'ef': 800} |  | 5 | 4.0 | 80.0 | 47.8 | 134.8 | 0.9969 |
| amd | advtest | ours_walk |  | {'ef': 800} | fixed | 5 | 4.1 | 154.7 | 51.9 | 213.3 | 0.9969 |
| amd | advtest | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 3.9 | 1685.5 | 166.4 | 1856.0 | 0.9994 |
| amd | advtest | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 4.4 | 2588.1 | 167.6 | 2760.5 | 1.0000 |
| amd | advtest | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 360.7 | 108.6 | 473.4 | 0.9958 |
| amd | advtest | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1048.4 | 166.1 | 1216.6 | 1.0000 |
| amd | advtest | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1065.0 | 167.8 | 1236.3 | 0.9995 |
| amd | advtest | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 249.2 | 111.2 | 365.0 | 0.9904 |
| amd | advtest | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 610.1 | 108.9 | 723.5 | 0.9969 |
| amd | advtest | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 4.0 | 1746.8 | 168.8 | 1920.5 | 1.0000 |
| amd | advtest | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 1783.3 | 169.6 | 1957.6 | 1.0000 |
| amd | advtest | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 454.1 | 113.3 | 571.6 | 0.9912 |
| amd | advtest | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 418.0 | 113.7 | 535.6 | 0.9965 |
| amd | advtest | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.7 | 1154.6 | 166.9 | 1322.2 | 0.9986 |
| amd | advtest | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1170.0 | 166.8 | 1341.9 | 0.9995 |
| amd | advtest | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 295.6 | 115.6 | 415.6 | 0.9889 |
| amd | advtest | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 670.7 | 116.1 | 794.9 | 0.9973 |
| amd | advtest | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 4.1 | 1886.9 | 168.6 | 2056.6 | 1.0000 |
| amd | advtest | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 1916.8 | 170.6 | 2088.0 | 1.0000 |
| amd | advtest | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 506.3 | 117.6 | 629.3 | 0.9896 |
| amd | advtest | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 9.1 | 323.2 | 233.2 | 567.4 | 1.0000 |
| amd | advtest | faiss_rabitq_ivf | {'nlist': 147} | {'nprobe': 18} |  | 5 | 3.4 | 97.0 | 103.2 | 204.2 | 0.7543 |
| amd | advtest | faiss_rabitq_ivf | {'nlist': 147} | {'nprobe': 9} |  | 5 | 3.4 | 68.6 | 102.6 | 174.7 | 0.6515 |
| amd | advtest | faiss_bin_flat |  | {} |  | 5 | 3.4 | 148.7 | 102.9 | 255.5 | 0.9972 |
| amd | advtest | faiss_rabitq_flat |  | {} |  | 5 | 3.4 | 327.3 | 103.0 | 434.2 | 1.0000 |
| amd | csn1m | ours_walk |  | {'ef': 400} |  | 5 | 3.9 | 179.5 | 5095.1 | 5577.7 | 0.9957 |
| amd | csn1m | ours_walk |  | {'ef': 400} | fixed | 5 | 3.8 | 439.8 | 52.5 | 511.9 | 0.9958 |
| amd | csn1m | ours_walk |  | {'ef': 800} |  | 5 | 4.0 | 284.7 | 52.6 | 349.5 | 0.9957 |
| amd | csn1m | ours_walk |  | {'ef': 800} | fixed | 5 | 4.0 | 814.8 | 53.3 | 889.5 | 0.9966 |
| amd | csn1m | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 3.7 | 4568.1 | 241.8 | 4815.9 | 0.9991 |
| amd | csn1m | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 4.4 | 8397.5 | 246.4 | 8652.2 | 0.9998 |
| amd | csn1m | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 1215.5 | 206.0 | 1421.5 | 0.9871 |
| amd | csn1m | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 2329.9 | 237.7 | 2574.2 | 0.9991 |
| amd | csn1m | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 2182.2 | 239.7 | 2423.0 | 0.9980 |
| amd | csn1m | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 1041.8 | 213.5 | 1259.1 | 0.9903 |
| amd | csn1m | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 2273.7 | 219.9 | 2483.4 | 0.9927 |
| amd | csn1m | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 4336.0 | 241.8 | 4584.0 | 1.0000 |
| amd | csn1m | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 4.0 | 4088.2 | 244.9 | 4314.1 | 0.9986 |
| amd | csn1m | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 2064.4 | 226.5 | 2291.4 | 0.9955 |
| amd | csn1m | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 2052.0 | 221.6 | 2279.3 | 0.9953 |
| amd | csn1m | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 3245.5 | 240.2 | 3491.2 | 0.9997 |
| amd | csn1m | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.9 | 3426.5 | 243.6 | 3642.0 | 0.9992 |
| amd | csn1m | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1708.4 | 225.3 | 1939.5 | 0.9966 |
| amd | csn1m | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 3801.9 | 230.4 | 4037.8 | 0.9974 |
| amd | csn1m | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 4.1 | 5997.3 | 247.5 | 6252.2 | 0.9998 |
| amd | csn1m | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 4.3 | 6233.7 | 246.3 | 6457.7 | 1.0000 |
| amd | csn1m | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 3362.5 | 232.8 | 3599.0 | 0.9964 |
| amd | csn1m | scann | {'leaves': 1002, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 2, 'reorder': 400} |  | 5 | 9.4 | 156.2 | 323.2 | 490.8 | 0.5740 |
| amd | csn1m | scann | {'leaves': 1002, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 9.3 | 185.9 | 339.8 | 535.7 | 0.6948 |
| amd | csn1m | faiss_rabitq_ivf | {'nlist': 1002} | {'nprobe': 2} |  | 5 | 3.5 | 130.6 | 194.6 | 333.3 | 0.5790 |
| amd | csn1m | faiss_rabitq_ivf | {'nlist': 1002} | {'nprobe': 4} |  | 5 | 3.5 | 166.6 | 203.7 | 374.2 | 0.7009 |
| amd | csn1m | faiss_bin_flat |  | {} |  | 5 | 3.9 | 2040.0 | 236.5 | 2269.4 | 0.9977 |
| amd | csn1m | faiss_rabitq_flat |  | {} |  | 5 | 4.4 | 11035.5 | 241.1 | 11275.0 | 1.0000 |
| amd | d20k | ours_scan |  | {'ef': 400} |  | 5 | 4.0 | 42.2 | 38.5 | 86.6 | 0.9979 |
| amd | d20k | ours_walk |  | {'ef': 400} |  | 5 | 3.8 | 56.2 | 43.2 | 105.8 | 0.9978 |
| amd | d20k | ours_walk |  | {'ef': 400} | fixed | 5 | 3.8 | 102.8 | 46.2 | 155.9 | 0.9978 |
| amd | d20k | ours_walk |  | {'ef': 800} |  | 5 | 3.8 | 73.0 | 44.9 | 124.9 | 0.9978 |
| amd | d20k | ours_walk |  | {'ef': 800} | fixed | 5 | 3.8 | 165.0 | 48.7 | 220.5 | 0.9978 |
| amd | d20k | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 3.8 | 1363.3 | 164.8 | 1531.9 | 1.0000 |
| amd | d20k | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 4.2 | 2124.1 | 166.6 | 2292.2 | 1.0000 |
| amd | d20k | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 340.0 | 102.0 | 445.9 | 0.9983 |
| amd | d20k | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 916.8 | 161.3 | 1082.3 | 1.0000 |
| amd | d20k | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 923.5 | 162.9 | 1090.1 | 1.0000 |
| amd | d20k | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 236.0 | 103.7 | 344.4 | 0.9957 |
| amd | d20k | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 575.6 | 102.6 | 683.2 | 0.9978 |
| amd | d20k | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.9 | 1562.3 | 163.4 | 1729.9 | 1.0000 |
| amd | d20k | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.8 | 1535.7 | 165.4 | 1705.4 | 1.0000 |
| amd | d20k | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 432.9 | 104.7 | 542.7 | 0.9961 |
| amd | d20k | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 381.8 | 106.3 | 492.3 | 0.9983 |
| amd | d20k | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1012.5 | 162.2 | 1176.6 | 0.9995 |
| amd | d20k | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1007.0 | 164.4 | 1175.1 | 1.0000 |
| amd | d20k | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 268.6 | 107.3 | 379.8 | 0.9953 |
| amd | d20k | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 618.8 | 107.8 | 731.1 | 0.9978 |
| amd | d20k | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.8 | 1653.4 | 164.2 | 1822.7 | 1.0000 |
| amd | d20k | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 1619.9 | 165.7 | 1788.9 | 1.0000 |
| amd | d20k | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 467.1 | 109.6 | 580.6 | 0.9953 |
| amd | d20k | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 8.9 | 298.5 | 217.2 | 526.4 | 1.0000 |
| amd | d20k | faiss_rabitq_ivf | {'nlist': 141} | {'nprobe': 18} |  | 5 | 3.4 | 103.6 | 96.1 | 204.1 | 0.8766 |
| amd | d20k | faiss_rabitq_ivf | {'nlist': 141} | {'nprobe': 9} |  | 5 | 3.5 | 72.7 | 95.0 | 172.1 | 0.7978 |
| amd | d20k | faiss_bin_flat |  | {} |  | 5 | 3.5 | 139.8 | 96.4 | 240.5 | 0.9978 |
| amd | d20k | faiss_rabitq_flat |  | {} |  | 5 | 3.5 | 299.2 | 96.4 | 399.4 | 1.0000 |
| amd | dall | ours_scan |  | {'ef': 400} |  | 5 | 4.1 | 204.6 | 69.4 | 280.2 | 0.9981 |
| amd | dall | ours_walk |  | {'ef': 400} |  | 5 | 4.1 | 88.0 | 71.3 | 166.3 | 0.9927 |
| amd | dall | ours_walk |  | {'ef': 400} | fixed | 5 | 4.1 | 165.6 | 72.2 | 244.8 | 0.9952 |
| amd | dall | ours_walk |  | {'ef': 800} |  | 5 | 4.1 | 131.6 | 72.0 | 210.0 | 0.9948 |
| amd | dall | ours_walk |  | {'ef': 800} | fixed | 5 | 4.1 | 285.7 | 73.4 | 366.6 | 0.9980 |
| amd | dall | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 3.7 | 2563.6 | 168.5 | 2733.1 | 0.9984 |
| amd | dall | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 4.3 | 4449.9 | 168.6 | 4619.1 | 0.9994 |
| amd | dall | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 463.8 | 155.5 | 623.1 | 0.9876 |
| amd | dall | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1345.5 | 161.1 | 1509.4 | 0.9979 |
| amd | dall | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1413.9 | 163.7 | 1579.2 | 0.9986 |
| amd | dall | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 420.1 | 158.5 | 581.9 | 0.9842 |
| amd | dall | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 836.8 | 160.1 | 1000.3 | 0.9969 |
| amd | dall | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 2458.0 | 162.5 | 2625.4 | 0.9994 |
| amd | dall | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 2555.0 | 165.2 | 2723.8 | 0.9993 |
| amd | dall | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 770.0 | 162.0 | 936.3 | 0.9944 |
| amd | dall | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 542.5 | 156.0 | 700.1 | 0.9913 |
| amd | dall | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1552.9 | 161.0 | 1719.3 | 0.9974 |
| amd | dall | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1588.1 | 163.7 | 1755.7 | 0.9996 |
| amd | dall | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 493.4 | 160.0 | 663.9 | 0.9879 |
| amd | dall | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 1016.9 | 160.9 | 1180.2 | 0.9968 |
| amd | dall | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.8 | 2823.0 | 163.7 | 2987.3 | 0.9990 |
| amd | dall | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 2853.4 | 165.0 | 3021.7 | 1.0001 |
| amd | dall | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 910.4 | 163.2 | 1077.5 | 0.9921 |
| amd | dall | scann | {'leaves': 374, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 8.9 | 110.5 | 256.7 | 377.7 | 0.2342 |
| amd | dall | scann | {'leaves': 374, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 8, 'reorder': 400} |  | 5 | 8.9 | 133.7 | 267.5 | 411.6 | 0.3020 |
| amd | dall | faiss_rabitq_ivf | {'nlist': 375} | {'nprobe': 4} |  | 5 | 3.5 | 80.4 | 136.0 | 220.2 | 0.5694 |
| amd | dall | faiss_rabitq_ivf | {'nlist': 375} | {'nprobe': 8} |  | 5 | 3.5 | 113.3 | 144.0 | 261.6 | 0.6689 |
| amd | dall | faiss_bin_flat |  | {} |  | 5 | 3.5 | 377.7 | 151.4 | 533.0 | 0.9982 |
| amd | dall | faiss_rabitq_flat |  | {} |  | 5 | 3.5 | 1626.0 | 153.9 | 1790.2 | 1.0001 |
| amd | fiqa | ours_scan |  | {'ef': 400} |  | 5 | 3.9 | 95.2 | 54.5 | 159.0 | 0.9967 |
| amd | fiqa | ours_walk |  | {'ef': 400} |  | 5 | 4.0 | 56.7 | 59.1 | 122.1 | 0.9994 |
| amd | fiqa | ours_walk |  | {'ef': 400} | fixed | 5 | 4.0 | 121.9 | 64.3 | 193.0 | 0.9968 |
| amd | fiqa | ours_walk |  | {'ef': 800} |  | 5 | 4.0 | 75.8 | 61.5 | 144.2 | 0.9995 |
| amd | fiqa | ours_walk |  | {'ef': 800} | fixed | 5 | 4.1 | 200.5 | 67.6 | 275.2 | 0.9968 |
| amd | fiqa | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 3.6 | 1372.9 | 175.5 | 1551.9 | 1.0000 |
| amd | fiqa | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 3.8 | 2260.4 | 173.2 | 2432.5 | 1.0000 |
| amd | fiqa | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.4 | 361.4 | 138.5 | 501.7 | 0.9876 |
| amd | fiqa | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 976.6 | 170.9 | 1154.0 | 1.0000 |
| amd | fiqa | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 969.7 | 172.3 | 1146.4 | 1.0000 |
| amd | fiqa | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.4 | 256.4 | 138.8 | 397.0 | 0.9967 |
| amd | fiqa | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 620.8 | 142.3 | 766.8 | 0.9969 |
| amd | fiqa | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 1689.3 | 172.6 | 1862.7 | 1.0000 |
| amd | fiqa | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 1658.9 | 173.8 | 1838.0 | 1.0000 |
| amd | fiqa | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 461.7 | 145.4 | 612.0 | 0.9950 |
| amd | fiqa | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.4 | 427.0 | 143.7 | 574.5 | 0.9903 |
| amd | fiqa | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1082.1 | 171.3 | 1256.9 | 1.0000 |
| amd | fiqa | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 1074.0 | 172.9 | 1252.7 | 1.0000 |
| amd | fiqa | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 320.7 | 140.4 | 464.6 | 0.9915 |
| amd | fiqa | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.4 | 723.2 | 148.5 | 876.7 | 0.9969 |
| amd | fiqa | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.7 | 1848.8 | 173.1 | 2026.7 | 1.0000 |
| amd | fiqa | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 1815.0 | 173.9 | 1990.3 | 1.0000 |
| amd | fiqa | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 542.4 | 147.1 | 691.9 | 0.9915 |
| amd | fiqa | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 9.4 | 732.0 | 285.9 | 1030.8 | 1.0000 |
| amd | fiqa | faiss_rabitq_ivf | {'nlist': 240} | {'nprobe': 10} |  | 5 | 3.4 | 103.1 | 127.6 | 236.9 | 0.9588 |
| amd | fiqa | faiss_rabitq_ivf | {'nlist': 240} | {'nprobe': 5} |  | 5 | 3.4 | 77.0 | 130.3 | 212.7 | 0.8618 |
| amd | fiqa | faiss_bin_flat |  | {} |  | 5 | 3.4 | 227.9 | 130.5 | 362.4 | 0.9969 |
| amd | fiqa | faiss_rabitq_flat |  | {} |  | 5 | 3.4 | 731.7 | 133.7 | 868.3 | 1.0000 |
| amd | gcsn | ours_scan |  | {'ef': 400} |  | 5 | 3.7 | 22.1 | 31.4 | 59.1 | 0.9996 |
| amd | gcsn | ours_walk |  | {'ef': 400} |  | 5 | 3.8 | 38.6 | 32.0 | 77.5 | 0.9997 |
| amd | gcsn | ours_walk |  | {'ef': 400} | fixed | 5 | 3.8 | 78.6 | 31.9 | 116.5 | 0.9997 |
| amd | gcsn | ours_walk |  | {'ef': 800} |  | 5 | 3.8 | 48.2 | 32.1 | 86.3 | 0.9997 |
| amd | gcsn | ours_walk |  | {'ef': 800} | fixed | 5 | 3.8 | 123.7 | 32.4 | 164.1 | 0.9997 |
| amd | gcsn | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 3.6 | 584.1 | 119.4 | 708.6 | 1.0000 |
| amd | gcsn | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 3.6 | 781.0 | 120.5 | 909.0 | 1.0000 |
| amd | gcsn | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.4 | 270.5 | 91.7 | 366.4 | 0.9996 |
| amd | gcsn | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 536.4 | 112.5 | 653.0 | 1.0000 |
| amd | gcsn | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 511.2 | 113.8 | 630.7 | 1.0000 |
| amd | gcsn | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.4 | 177.6 | 92.3 | 273.4 | 0.9963 |
| amd | gcsn | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.4 | 432.0 | 91.9 | 528.3 | 0.9996 |
| amd | gcsn | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 773.6 | 113.6 | 889.7 | 1.0000 |
| amd | gcsn | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 721.4 | 114.9 | 841.0 | 1.0000 |
| amd | gcsn | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.4 | 301.7 | 92.0 | 398.6 | 0.9963 |
| amd | gcsn | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.4 | 283.7 | 91.6 | 380.1 | 0.9996 |
| amd | gcsn | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 567.4 | 115.7 | 687.0 | 1.0000 |
| amd | gcsn | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 542.1 | 119.2 | 666.7 | 1.0000 |
| amd | gcsn | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.4 | 188.1 | 92.0 | 283.9 | 0.9943 |
| amd | gcsn | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.4 | 442.9 | 92.0 | 539.0 | 0.9996 |
| amd | gcsn | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 807.8 | 117.1 | 929.2 | 1.0000 |
| amd | gcsn | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.5 | 762.8 | 120.5 | 888.1 | 1.0000 |
| amd | gcsn | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.4 | 315.6 | 92.1 | 412.1 | 0.9942 |
| amd | gcsn | scann | {'mode': 'brute'} | {'reorder': 400} |  | 5 | 10.1 | 242.5 | 190.7 | 447.7 | 1.0000 |
| amd | gcsn | faiss_rabitq_ivf | {'nlist': 83} | {'nprobe': 15} |  | 5 | 3.4 | 71.2 | 91.1 | 166.0 | 0.9175 |
| amd | gcsn | faiss_rabitq_ivf | {'nlist': 83} | {'nprobe': 30} |  | 5 | 3.4 | 101.2 | 91.3 | 196.5 | 0.9669 |
| amd | gcsn | faiss_bin_flat |  | {} |  | 5 | 3.4 | 100.5 | 91.5 | 196.1 | 0.9996 |
| amd | gcsn | faiss_rabitq_flat |  | {} |  | 5 | 3.4 | 144.4 | 91.4 | 239.8 | 1.0000 |
| amd | quora | ours_walk |  | {'ef': 400} |  | 5 | 4.0 | 92.9 | 66.7 | 168.6 | 0.9999 |
| amd | quora | ours_walk |  | {'ef': 400} | fixed | 5 | 4.0 | 260.9 | 54.8 | 322.2 | 0.9999 |
| amd | quora | ours_walk |  | {'ef': 800} |  | 5 | 4.0 | 144.7 | 62.1 | 215.0 | 0.9999 |
| amd | quora | ours_walk |  | {'ef': 800} | fixed | 5 | 4.1 | 482.5 | 55.8 | 546.4 | 0.9999 |
| amd | quora | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 3.6 | 2496.8 | 220.7 | 2723.2 | 1.0000 |
| amd | quora | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 3.9 | 4444.2 | 222.2 | 4672.6 | 1.0000 |
| amd | quora | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 774.1 | 187.5 | 960.7 | 0.9999 |
| amd | quora | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1468.1 | 218.9 | 1663.1 | 1.0000 |
| amd | quora | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1519.9 | 222.2 | 1718.1 | 1.0000 |
| amd | quora | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 676.2 | 189.4 | 863.8 | 0.9991 |
| amd | quora | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 1436.7 | 192.6 | 1623.4 | 0.9999 |
| amd | quora | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 2684.1 | 222.2 | 2873.6 | 1.0000 |
| amd | quora | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 4.2 | 2763.1 | 222.2 | 2955.6 | 1.0000 |
| amd | quora | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 1304.5 | 203.8 | 1512.6 | 0.9991 |
| amd | quora | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.5 | 1005.7 | 192.4 | 1193.8 | 0.9999 |
| amd | quora | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 1780.1 | 221.3 | 2004.9 | 1.0000 |
| amd | quora | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.7 | 1950.3 | 223.7 | 2178.8 | 1.0000 |
| amd | quora | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 3.6 | 979.2 | 196.6 | 1179.4 | 0.9999 |
| amd | quora | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 1857.4 | 198.8 | 2060.8 | 0.9999 |
| amd | quora | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 3231.1 | 223.0 | 3452.0 | 1.0000 |
| amd | quora | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 4.0 | 3533.0 | 226.3 | 3762.7 | 1.0000 |
| amd | quora | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 3.6 | 1891.6 | 211.3 | 2106.5 | 0.9999 |
| amd | quora | scann | {'leaves': 723, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 2, 'reorder': 400} |  | 5 | 9.1 | 138.3 | 313.7 | 460.8 | 0.8422 |
| amd | quora | scann | {'leaves': 723, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 9.0 | 155.5 | 316.1 | 482.2 | 0.9306 |
| amd | quora | faiss_rabitq_ivf | {'nlist': 723} | {'nprobe': 2} |  | 5 | 3.5 | 98.2 | 179.1 | 282.6 | 0.9018 |
| amd | quora | faiss_rabitq_ivf | {'nlist': 723} | {'nprobe': 4} |  | 5 | 3.5 | 127.7 | 182.1 | 314.7 | 0.9616 |
| amd | quora | faiss_bin_flat |  | {} |  | 5 | 3.6 | 1098.5 | 222.3 | 1323.8 | 0.9999 |
| amd | quora | faiss_rabitq_flat |  | {} |  | 5 | 4.2 | 5809.5 | 226.0 | 6044.6 | 1.0000 |
| arm | advtest | ours_scan |  | {'ef': 400} |  | 5 | 4.5 | 60.9 | 91.7 | 163.2 | 0.9970 |
| arm | advtest | ours_walk |  | {'ef': 400} |  | 5 | 5.7 | 145.7 | 95.6 | 253.1 | 0.9966 |
| arm | advtest | ours_walk |  | {'ef': 400} | fixed | 5 | 5.8 | 217.4 | 96.7 | 328.1 | 0.9969 |
| arm | advtest | ours_walk |  | {'ef': 800} |  | 5 | 5.7 | 181.8 | 96.3 | 291.2 | 0.9969 |
| arm | advtest | ours_walk |  | {'ef': 800} | fixed | 5 | 5.9 | 321.7 | 97.8 | 433.2 | 0.9969 |
| arm | advtest | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 524.7 | 153.4 | 683.6 | 0.9958 |
| arm | advtest | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.4 | 2071.1 | 158.0 | 2235.2 | 1.0000 |
| arm | advtest | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 5535.3 | 158.8 | 5699.5 | 0.9995 |
| arm | advtest | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 453.2 | 152.8 | 612.3 | 0.9904 |
| arm | advtest | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1129.6 | 156.6 | 1291.4 | 0.9969 |
| arm | advtest | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.8 | 3703.4 | 161.0 | 3870.4 | 1.0000 |
| arm | advtest | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 8656.6 | 160.1 | 8822.6 | 1.0000 |
| arm | advtest | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 842.3 | 154.9 | 1002.2 | 0.9912 |
| arm | advtest | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 587.1 | 154.4 | 747.6 | 0.9965 |
| arm | advtest | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 2337.0 | 159.3 | 2503.1 | 0.9986 |
| arm | advtest | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.4 | 6071.1 | 159.0 | 6236.4 | 0.9995 |
| arm | advtest | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 530.4 | 152.1 | 688.4 | 0.9889 |
| arm | advtest | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1192.4 | 156.2 | 1354.1 | 0.9973 |
| arm | advtest | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 3883.2 | 159.6 | 4049.6 | 1.0000 |
| arm | advtest | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 9299.6 | 160.4 | 9465.8 | 1.0000 |
| arm | advtest | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 951.2 | 155.6 | 1113.3 | 0.9896 |
| arm | advtest | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 14.3 | 445.5 | 162.5 | 625.7 | 1.0000 |
| arm | advtest | faiss_rabitq_ivf | {'nlist': 147} | {'nprobe': 18} |  | 5 | 5.0 | 268.0 | 150.2 | 423.7 | 0.7543 |
| arm | advtest | faiss_rabitq_ivf | {'nlist': 147} | {'nprobe': 9} |  | 5 | 5.0 | 157.0 | 149.6 | 312.2 | 0.6515 |
| arm | advtest | faiss_bin_flat |  | {} |  | 5 | 5.0 | 146.5 | 151.3 | 303.7 | 0.9972 |
| arm | advtest | faiss_rabitq_flat |  | {} |  | 5 | 5.1 | 1163.6 | 154.3 | 1323.0 | 1.0000 |
| arm | csn1m | ours_walk |  | {'ef': 400} |  | 5 | 5.4 | 534.6 | 112.3 | 665.6 | 0.9957 |
| arm | csn1m | ours_walk |  | {'ef': 400} | fixed | 5 | 5.5 | 975.6 | 117.1 | 1107.6 | 0.9958 |
| arm | csn1m | ours_walk |  | {'ef': 800} |  | 5 | 4.9 | 872.7 | 115.8 | 1007.9 | 0.9957 |
| arm | csn1m | ours_walk |  | {'ef': 800} | fixed | 5 | 5.7 | 1779.2 | 127.9 | 1927.2 | 0.9966 |
| arm | csn1m | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.2 | 1166.6 | 192.3 | 1364.4 | 0.9871 |
| arm | csn1m | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.7 | 4320.0 | 200.2 | 4525.7 | 0.9991 |
| arm | csn1m | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 11121.4 | 204.4 | 11333.8 | 0.9980 |
| arm | csn1m | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1852.2 | 193.5 | 2051.9 | 0.9903 |
| arm | csn1m | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.2 | 2399.6 | 197.4 | 2603.0 | 0.9927 |
| arm | csn1m | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.8 | 8228.1 | 201.4 | 8436.9 | 1.0000 |
| arm | csn1m | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 20539.4 | 204.4 | 20749.6 | 0.9986 |
| arm | csn1m | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.3 | 3642.3 | 201.4 | 3849.5 | 0.9955 |
| arm | csn1m | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.2 | 1796.4 | 197.2 | 2003.3 | 0.9953 |
| arm | csn1m | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.8 | 6137.5 | 203.6 | 6345.4 | 0.9997 |
| arm | csn1m | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.7 | 18342.0 | 205.9 | 18553.1 | 0.9992 |
| arm | csn1m | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.3 | 3196.1 | 201.8 | 3403.9 | 0.9966 |
| arm | csn1m | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 3601.0 | 205.1 | 3812.9 | 0.9974 |
| arm | csn1m | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.8 | 11528.4 | 206.4 | 11742.3 | 0.9998 |
| arm | csn1m | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 33921.4 | 207.7 | 34144.2 | 1.0000 |
| arm | csn1m | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 6286.1 | 208.6 | 6503.1 | 0.9964 |
| arm | csn1m | scann | {'leaves': 1002, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 2, 'reorder': 400} |  | 5 | 14.4 | 268.5 | 199.9 | 488.2 | 0.5740 |
| arm | csn1m | scann | {'leaves': 1002, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 15.2 | 306.6 | 200.9 | 527.7 | 0.6948 |
| arm | csn1m | faiss_rabitq_ivf | {'nlist': 1002} | {'nprobe': 2} |  | 5 | 5.1 | 254.3 | 185.8 | 446.2 | 0.5790 |
| arm | csn1m | faiss_rabitq_ivf | {'nlist': 1002} | {'nprobe': 4} |  | 5 | 5.1 | 382.4 | 186.7 | 576.1 | 0.7009 |
| arm | csn1m | faiss_bin_flat |  | {} |  | 5 | 5.2 | 2834.4 | 196.9 | 3041.1 | 0.9977 |
| arm | csn1m | faiss_rabitq_flat |  | {} |  | 5 | 5.2 | 49283.8 | 198.5 | 49491.1 | 1.0000 |
| arm | d20k | ours_scan |  | {'ef': 400} |  | 5 | 5.5 | 58.8 | 91.0 | 161.4 | 0.9979 |
| arm | d20k | ours_walk |  | {'ef': 400} |  | 5 | 4.7 | 127.7 | 92.2 | 231.4 | 0.9978 |
| arm | d20k | ours_walk |  | {'ef': 400} | fixed | 5 | 4.7 | 198.4 | 93.0 | 303.6 | 0.9978 |
| arm | d20k | ours_walk |  | {'ef': 800} |  | 5 | 4.7 | 160.3 | 93.4 | 265.7 | 0.9978 |
| arm | d20k | ours_walk |  | {'ef': 800} | fixed | 5 | 4.8 | 304.5 | 96.4 | 414.2 | 0.9978 |
| arm | d20k | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 496.4 | 151.8 | 654.0 | 0.9983 |
| arm | d20k | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.3 | 1877.8 | 156.5 | 2039.5 | 1.0000 |
| arm | d20k | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 5109.1 | 158.3 | 5270.8 | 1.0000 |
| arm | d20k | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 420.8 | 151.1 | 578.6 | 0.9957 |
| arm | d20k | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1070.3 | 154.8 | 1231.0 | 0.9978 |
| arm | d20k | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 3203.6 | 157.9 | 3367.4 | 1.0000 |
| arm | d20k | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 7607.1 | 158.4 | 7773.6 | 1.0000 |
| arm | d20k | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 751.3 | 152.3 | 909.9 | 0.9961 |
| arm | d20k | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 544.1 | 151.3 | 701.2 | 0.9983 |
| arm | d20k | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.4 | 2063.8 | 157.2 | 2227.0 | 0.9995 |
| arm | d20k | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 5431.1 | 157.8 | 5593.9 | 1.0000 |
| arm | d20k | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 468.7 | 151.8 | 626.6 | 0.9953 |
| arm | d20k | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1122.7 | 153.2 | 1281.4 | 0.9978 |
| arm | d20k | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 3445.8 | 158.6 | 3610.2 | 1.0000 |
| arm | d20k | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 7992.7 | 158.8 | 8156.5 | 1.0000 |
| arm | d20k | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 841.2 | 154.0 | 1000.7 | 0.9953 |
| arm | d20k | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 14.5 | 412.4 | 160.2 | 590.9 | 1.0000 |
| arm | d20k | faiss_rabitq_ivf | {'nlist': 141} | {'nprobe': 18} |  | 5 | 5.1 | 276.5 | 147.6 | 429.7 | 0.8766 |
| arm | d20k | faiss_rabitq_ivf | {'nlist': 141} | {'nprobe': 9} |  | 5 | 5.1 | 163.2 | 145.8 | 314.8 | 0.7978 |
| arm | d20k | faiss_bin_flat |  | {} |  | 5 | 5.0 | 138.1 | 149.9 | 294.2 | 0.9978 |
| arm | d20k | faiss_rabitq_flat |  | {} |  | 5 | 5.1 | 1070.1 | 151.0 | 1227.6 | 1.0000 |
| arm | dall | ours_scan |  | {'ef': 400} |  | 5 | 5.6 | 271.2 | 99.1 | 382.6 | 0.9981 |
| arm | dall | ours_walk |  | {'ef': 400} |  | 5 | 5.7 | 419.6 | 103.2 | 536.4 | 0.9927 |
| arm | dall | ours_walk |  | {'ef': 400} | fixed | 5 | 5.8 | 655.6 | 108.8 | 783.5 | 0.9952 |
| arm | dall | ours_walk |  | {'ef': 800} |  | 5 | 5.9 | 637.1 | 105.5 | 757.0 | 0.9948 |
| arm | dall | ours_walk |  | {'ef': 800} | fixed | 5 | 5.9 | 1030.4 | 111.4 | 1157.7 | 0.9980 |
| arm | dall | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 858.0 | 153.0 | 1016.3 | 0.9876 |
| arm | dall | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 2665.5 | 157.5 | 2827.8 | 0.9979 |
| arm | dall | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 7389.2 | 159.1 | 7554.9 | 0.9986 |
| arm | dall | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.2 | 1231.7 | 155.1 | 1393.2 | 0.9842 |
| arm | dall | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.2 | 1836.6 | 157.7 | 2000.5 | 0.9969 |
| arm | dall | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 5041.7 | 158.9 | 5207.4 | 0.9994 |
| arm | dall | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 13058.2 | 159.0 | 13222.7 | 0.9993 |
| arm | dall | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.3 | 2319.8 | 157.3 | 2484.1 | 0.9944 |
| arm | dall | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1028.4 | 153.6 | 1188.1 | 0.9913 |
| arm | dall | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 3118.4 | 158.5 | 3282.2 | 0.9974 |
| arm | dall | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 8489.3 | 159.5 | 8654.1 | 0.9996 |
| arm | dall | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.2 | 1563.0 | 154.9 | 1723.7 | 0.9879 |
| arm | dall | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.2 | 2098.4 | 156.3 | 2259.8 | 0.9968 |
| arm | dall | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 5788.3 | 159.3 | 5952.9 | 0.9990 |
| arm | dall | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 14727.7 | 159.5 | 14891.7 | 1.0001 |
| arm | dall | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.3 | 2942.1 | 159.1 | 3106.2 | 0.9921 |
| arm | dall | scann | {'leaves': 374, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 13.8 | 189.2 | 158.4 | 365.9 | 0.2342 |
| arm | dall | scann | {'leaves': 374, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 8, 'reorder': 400} |  | 5 | 13.9 | 221.3 | 160.3 | 399.9 | 0.3020 |
| arm | dall | faiss_rabitq_ivf | {'nlist': 375} | {'nprobe': 4} |  | 5 | 5.1 | 157.4 | 148.1 | 311.7 | 0.5694 |
| arm | dall | faiss_rabitq_ivf | {'nlist': 375} | {'nprobe': 8} |  | 5 | 5.1 | 258.6 | 149.5 | 414.1 | 0.6689 |
| arm | dall | faiss_bin_flat |  | {} |  | 5 | 5.1 | 457.2 | 152.1 | 615.6 | 0.9982 |
| arm | dall | faiss_rabitq_flat |  | {} |  | 5 | 5.1 | 6993.6 | 155.4 | 7154.7 | 1.0001 |
| arm | fiqa | ours_scan |  | {'ef': 400} |  | 5 | 5.6 | 127.7 | 98.1 | 238.8 | 0.9967 |
| arm | fiqa | ours_walk |  | {'ef': 400} |  | 5 | 5.5 | 204.4 | 101.0 | 317.9 | 0.9994 |
| arm | fiqa | ours_walk |  | {'ef': 400} | fixed | 5 | 5.8 | 377.6 | 105.9 | 497.9 | 0.9968 |
| arm | fiqa | ours_walk |  | {'ef': 800} |  | 5 | 5.5 | 273.5 | 102.6 | 389.9 | 0.9995 |
| arm | fiqa | ours_walk |  | {'ef': 800} | fixed | 5 | 6.2 | 593.9 | 110.4 | 722.8 | 0.9968 |
| arm | fiqa | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 707.4 | 157.2 | 871.4 | 0.9876 |
| arm | fiqa | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.4 | 2051.7 | 162.7 | 2219.6 | 1.0000 |
| arm | fiqa | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 4990.5 | 163.9 | 5159.8 | 1.0000 |
| arm | fiqa | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 766.8 | 157.2 | 929.3 | 0.9967 |
| arm | fiqa | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1449.3 | 158.9 | 1616.7 | 0.9969 |
| arm | fiqa | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 3665.6 | 164.5 | 3837.6 | 1.0000 |
| arm | fiqa | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 8107.7 | 164.2 | 8276.9 | 1.0000 |
| arm | fiqa | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1402.5 | 159.0 | 1566.5 | 0.9950 |
| arm | fiqa | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 802.3 | 157.2 | 964.6 | 0.9903 |
| arm | fiqa | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 2278.8 | 163.0 | 2446.9 | 1.0000 |
| arm | fiqa | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 5680.5 | 163.7 | 5853.0 | 1.0000 |
| arm | fiqa | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 949.8 | 158.0 | 1113.9 | 0.9915 |
| arm | fiqa | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1617.5 | 159.8 | 1783.6 | 0.9969 |
| arm | fiqa | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.8 | 4024.5 | 164.8 | 4195.0 | 1.0000 |
| arm | fiqa | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 9093.5 | 164.4 | 9264.3 | 1.0000 |
| arm | fiqa | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1683.4 | 160.2 | 1852.9 | 0.9915 |
| arm | fiqa | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 16.4 | 929.5 | 168.4 | 1117.8 | 1.0000 |
| arm | fiqa | faiss_rabitq_ivf | {'nlist': 240} | {'nprobe': 10} |  | 5 | 5.0 | 260.6 | 155.2 | 420.8 | 0.9588 |
| arm | fiqa | faiss_rabitq_ivf | {'nlist': 240} | {'nprobe': 5} |  | 5 | 5.0 | 161.2 | 154.4 | 320.7 | 0.8618 |
| arm | fiqa | faiss_bin_flat |  | {} |  | 5 | 5.0 | 239.3 | 155.9 | 402.3 | 0.9969 |
| arm | fiqa | faiss_rabitq_flat |  | {} |  | 5 | 5.1 | 2938.7 | 159.5 | 3103.5 | 1.0000 |
| arm | gcsn | ours_scan |  | {'ef': 400} |  | 5 | 4.4 | 34.1 | 72.6 | 116.4 | 0.9996 |
| arm | gcsn | ours_walk |  | {'ef': 400} |  | 5 | 4.4 | 71.6 | 79.2 | 160.8 | 0.9997 |
| arm | gcsn | ours_walk |  | {'ef': 400} | fixed | 5 | 4.5 | 135.0 | 85.5 | 231.2 | 0.9997 |
| arm | gcsn | ours_walk |  | {'ef': 800} |  | 5 | 4.5 | 87.5 | 81.9 | 179.8 | 0.9997 |
| arm | gcsn | ours_walk |  | {'ef': 800} | fixed | 5 | 4.6 | 216.1 | 88.2 | 313.8 | 0.9997 |
| arm | gcsn | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 409.2 | 148.6 | 563.3 | 0.9996 |
| arm | gcsn | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.3 | 1407.5 | 157.4 | 1571.1 | 1.0000 |
| arm | gcsn | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.4 | 3705.6 | 157.9 | 3869.3 | 1.0000 |
| arm | gcsn | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 263.3 | 148.7 | 417.6 | 0.9963 |
| arm | gcsn | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 881.2 | 150.7 | 1037.0 | 0.9996 |
| arm | gcsn | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 2090.6 | 156.7 | 2252.6 | 1.0000 |
| arm | gcsn | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 4613.1 | 158.4 | 4776.9 | 1.0000 |
| arm | gcsn | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 454.1 | 148.7 | 608.3 | 0.9963 |
| arm | gcsn | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 430.8 | 148.2 | 584.9 | 0.9996 |
| arm | gcsn | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.3 | 1416.2 | 156.2 | 1578.1 | 1.0000 |
| arm | gcsn | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.4 | 3838.8 | 157.7 | 4002.0 | 1.0000 |
| arm | gcsn | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 287.9 | 148.5 | 442.0 | 0.9943 |
| arm | gcsn | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 919.1 | 149.9 | 1074.8 | 0.9996 |
| arm | gcsn | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 2155.2 | 157.0 | 2317.9 | 1.0000 |
| arm | gcsn | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.5 | 4675.7 | 158.4 | 4840.0 | 1.0000 |
| arm | gcsn | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 490.1 | 149.2 | 645.1 | 0.9942 |
| arm | gcsn | scann | {'mode': 'brute'} | {'reorder': 400} |  | 5 | 14.3 | 533.6 | 161.1 | 711.4 | 1.0000 |
| arm | gcsn | faiss_rabitq_ivf | {'nlist': 83} | {'nprobe': 15} |  | 5 | 5.0 | 181.3 | 143.0 | 329.4 | 0.9175 |
| arm | gcsn | faiss_rabitq_ivf | {'nlist': 83} | {'nprobe': 30} |  | 5 | 5.0 | 315.2 | 145.5 | 465.9 | 0.9669 |
| arm | gcsn | faiss_bin_flat |  | {} |  | 5 | 5.0 | 95.1 | 143.1 | 243.5 | 0.9996 |
| arm | gcsn | faiss_rabitq_flat |  | {} |  | 5 | 5.1 | 415.4 | 147.5 | 568.9 | 1.0000 |
| arm | quora | ours_walk |  | {'ef': 400} |  | 5 | 5.5 | 232.6 | 104.3 | 349.5 | 0.9999 |
| arm | quora | ours_walk |  | {'ef': 400} | fixed | 5 | 5.8 | 572.9 | 108.5 | 694.8 | 0.9999 |
| arm | quora | ours_walk |  | {'ef': 800} |  | 5 | 5.7 | 367.7 | 106.5 | 486.7 | 0.9999 |
| arm | quora | ours_walk |  | {'ef': 800} | fixed | 5 | 5.8 | 1035.5 | 111.2 | 1164.0 | 0.9999 |
| arm | quora | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 941.7 | 174.6 | 1101.9 | 0.9999 |
| arm | quora | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.5 | 2717.3 | 182.5 | 2883.2 | 1.0000 |
| arm | quora | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 7260.8 | 183.1 | 7431.5 | 1.0000 |
| arm | quora | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.2 | 1352.0 | 176.3 | 1513.1 | 0.9991 |
| arm | quora | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.2 | 1991.5 | 180.2 | 2156.4 | 0.9999 |
| arm | quora | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 5280.1 | 184.5 | 5450.5 | 1.0000 |
| arm | quora | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 13041.2 | 184.0 | 13213.1 | 1.0000 |
| arm | quora | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.2 | 2644.7 | 180.9 | 2810.3 | 0.9991 |
| arm | quora | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1203.5 | 176.3 | 1365.1 | 0.9999 |
| arm | quora | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 3307.1 | 183.4 | 3473.7 | 1.0000 |
| arm | quora | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.6 | 9305.8 | 183.6 | 9477.5 | 1.0000 |
| arm | quora | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.2 | 2068.6 | 179.1 | 2231.4 | 0.9999 |
| arm | quora | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.2 | 2461.0 | 181.4 | 2625.2 | 0.9999 |
| arm | quora | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.7 | 6264.3 | 184.8 | 6433.8 | 1.0000 |
| arm | quora | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.6 | 16539.1 | 184.5 | 16713.7 | 1.0000 |
| arm | quora | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.4 | 3864.7 | 183.7 | 4031.9 | 0.9999 |
| arm | quora | scann | {'leaves': 723, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 2, 'reorder': 400} |  | 5 | 14.4 | 233.3 | 175.8 | 416.6 | 0.8422 |
| arm | quora | scann | {'leaves': 723, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 14.4 | 259.8 | 175.2 | 442.5 | 0.9306 |
| arm | quora | faiss_rabitq_ivf | {'nlist': 723} | {'nprobe': 2} |  | 5 | 5.1 | 190.6 | 161.9 | 357.2 | 0.9018 |
| arm | quora | faiss_rabitq_ivf | {'nlist': 723} | {'nprobe': 4} |  | 5 | 5.1 | 282.7 | 162.9 | 449.8 | 0.9616 |
| arm | quora | faiss_bin_flat |  | {} |  | 5 | 5.1 | 1540.2 | 178.9 | 1700.9 | 0.9999 |
| arm | quora | faiss_rabitq_flat |  | {} |  | 5 | 5.2 | 25712.2 | 183.5 | 25895.9 | 1.0000 |
| intel | advtest | ours_scan |  | {'ef': 400} |  | 5 | 4.5 | 60.9 | 67.6 | 137.9 | 0.9970 |
| intel | advtest | ours_walk |  | {'ef': 400} |  | 5 | 5.1 | 103.9 | 67.7 | 184.8 | 0.9966 |
| intel | advtest | ours_walk |  | {'ef': 400} | fixed | 5 | 5.2 | 193.6 | 72.5 | 278.5 | 0.9969 |
| intel | advtest | ours_walk |  | {'ef': 800} |  | 5 | 5.2 | 137.3 | 68.6 | 218.8 | 0.9969 |
| intel | advtest | ours_walk |  | {'ef': 800} | fixed | 5 | 5.3 | 300.0 | 80.9 | 397.7 | 0.9969 |
| intel | advtest | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 5.1 | 1617.3 | 198.9 | 1821.6 | 0.9994 |
| intel | advtest | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 5.1 | 2399.6 | 206.2 | 2615.3 | 1.0000 |
| intel | advtest | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 444.9 | 156.3 | 606.1 | 0.9958 |
| intel | advtest | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1213.2 | 201.5 | 1420.3 | 1.0000 |
| intel | advtest | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1161.0 | 198.7 | 1360.9 | 0.9995 |
| intel | advtest | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 314.1 | 157.3 | 480.1 | 0.9904 |
| intel | advtest | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 733.2 | 154.1 | 895.0 | 0.9969 |
| intel | advtest | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1959.5 | 211.0 | 2178.8 | 1.0000 |
| intel | advtest | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1893.9 | 205.2 | 2107.8 | 1.0000 |
| intel | advtest | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 575.7 | 169.7 | 751.4 | 0.9912 |
| intel | advtest | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 508.8 | 138.4 | 656.3 | 0.9965 |
| intel | advtest | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1357.2 | 202.0 | 1566.0 | 0.9986 |
| intel | advtest | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1272.4 | 205.7 | 1473.5 | 0.9995 |
| intel | advtest | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 372.4 | 152.7 | 530.4 | 0.9889 |
| intel | advtest | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 815.0 | 157.1 | 976.1 | 0.9973 |
| intel | advtest | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 2125.4 | 216.5 | 2346.0 | 1.0000 |
| intel | advtest | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 2021.5 | 210.4 | 2241.7 | 1.0000 |
| intel | advtest | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 651.6 | 179.9 | 837.0 | 0.9896 |
| intel | advtest | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 18.5 | 709.2 | 295.3 | 1047.3 | 1.0000 |
| intel | advtest | faiss_rabitq_ivf | {'nlist': 147} | {'nprobe': 18} |  | 5 | 4.8 | 126.7 | 133.4 | 267.3 | 0.7543 |
| intel | advtest | faiss_rabitq_ivf | {'nlist': 147} | {'nprobe': 9} |  | 5 | 4.8 | 88.5 | 131.2 | 226.6 | 0.6515 |
| intel | advtest | faiss_bin_flat |  | {} |  | 5 | 4.8 | 182.1 | 143.2 | 328.6 | 0.9972 |
| intel | advtest | faiss_rabitq_flat |  | {} |  | 5 | 4.9 | 439.1 | 146.9 | 596.7 | 1.0000 |
| intel | csn1m | ours_walk |  | {'ef': 400} |  | 5 | 4.9 | 227.5 | 754.7 | 2830.3 | 0.9957 |
| intel | csn1m | ours_walk |  | {'ef': 400} | fixed | 5 | 4.9 | 590.2 | 103.2 | 727.4 | 0.9958 |
| intel | csn1m | ours_walk |  | {'ef': 800} |  | 5 | 5.0 | 351.9 | 101.6 | 474.4 | 0.9957 |
| intel | csn1m | ours_walk |  | {'ef': 800} | fixed | 5 | 5.0 | 1046.2 | 104.6 | 1166.5 | 0.9966 |
| intel | csn1m | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 5.2 | 5310.5 | 312.8 | 5631.0 | 0.9991 |
| intel | csn1m | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 5.2 | 9814.0 | 318.0 | 10139.5 | 0.9998 |
| intel | csn1m | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 937.4 | 276.4 | 1215.7 | 0.9871 |
| intel | csn1m | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 4142.8 | 319.4 | 4470.5 | 0.9991 |
| intel | csn1m | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 3913.9 | 321.4 | 4241.2 | 0.9980 |
| intel | csn1m | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 836.1 | 285.1 | 1125.4 | 0.9903 |
| intel | csn1m | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1638.9 | 278.2 | 1913.1 | 0.9927 |
| intel | csn1m | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 7743.9 | 322.6 | 8073.0 | 1.0000 |
| intel | csn1m | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 7355.8 | 323.8 | 7683.6 | 0.9986 |
| intel | csn1m | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1650.4 | 295.4 | 1955.1 | 0.9955 |
| intel | csn1m | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1300.4 | 271.8 | 1568.0 | 0.9953 |
| intel | csn1m | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 5869.0 | 321.0 | 6195.9 | 0.9997 |
| intel | csn1m | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 6321.3 | 323.7 | 6651.0 | 0.9992 |
| intel | csn1m | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1230.5 | 282.0 | 1519.6 | 0.9966 |
| intel | csn1m | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 2376.6 | 287.3 | 2661.1 | 0.9974 |
| intel | csn1m | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 10879.9 | 323.5 | 11207.7 | 0.9998 |
| intel | csn1m | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 11743.2 | 323.5 | 12069.0 | 1.0000 |
| intel | csn1m | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 2439.0 | 299.0 | 2741.3 | 0.9964 |
| intel | csn1m | scann | {'leaves': 1002, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 2, 'reorder': 400} |  | 5 | 19.0 | 332.5 | 326.9 | 695.6 | 0.5740 |
| intel | csn1m | scann | {'leaves': 1002, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 19.8 | 420.4 | 374.3 | 821.8 | 0.6948 |
| intel | csn1m | faiss_rabitq_ivf | {'nlist': 1002} | {'nprobe': 2} |  | 5 | 5.0 | 236.5 | 289.9 | 533.5 | 0.5790 |
| intel | csn1m | faiss_rabitq_ivf | {'nlist': 1002} | {'nprobe': 4} |  | 5 | 5.1 | 327.6 | 290.8 | 633.7 | 0.7009 |
| intel | csn1m | faiss_bin_flat |  | {} |  | 5 | 5.1 | 2679.1 | 313.7 | 2994.8 | 0.9977 |
| intel | csn1m | faiss_rabitq_flat |  | {} |  | 5 | 5.1 | 19678.6 | 271.1 | 19948.3 | 1.0000 |
| intel | d20k | ours_scan |  | {'ef': 400} |  | 5 | 4.5 | 52.8 | 64.6 | 128.5 | 0.9979 |
| intel | d20k | ours_walk |  | {'ef': 400} |  | 5 | 4.6 | 94.5 | 66.1 | 170.1 | 0.9978 |
| intel | d20k | ours_walk |  | {'ef': 400} | fixed | 5 | 4.7 | 163.8 | 71.4 | 256.4 | 0.9978 |
| intel | d20k | ours_walk |  | {'ef': 800} |  | 5 | 4.6 | 123.8 | 71.4 | 207.1 | 0.9978 |
| intel | d20k | ours_walk |  | {'ef': 800} | fixed | 5 | 4.9 | 287.9 | 78.8 | 379.0 | 0.9978 |
| intel | d20k | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 5.1 | 1377.4 | 201.2 | 1584.6 | 1.0000 |
| intel | d20k | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 5.1 | 1990.3 | 197.8 | 2191.9 | 1.0000 |
| intel | d20k | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 417.4 | 164.0 | 586.8 | 0.9983 |
| intel | d20k | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1093.6 | 209.0 | 1301.8 | 1.0000 |
| intel | d20k | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1083.2 | 204.7 | 1294.7 | 1.0000 |
| intel | d20k | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 299.6 | 162.9 | 470.2 | 0.9957 |
| intel | d20k | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 683.9 | 171.5 | 860.9 | 0.9978 |
| intel | d20k | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1732.4 | 202.5 | 1941.1 | 1.0000 |
| intel | d20k | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1660.8 | 202.0 | 1864.9 | 1.0000 |
| intel | d20k | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 544.0 | 167.2 | 715.6 | 0.9961 |
| intel | d20k | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 499.2 | 192.6 | 698.9 | 0.9983 |
| intel | d20k | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1240.9 | 209.5 | 1459.5 | 0.9995 |
| intel | d20k | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 1219.3 | 209.8 | 1434.9 | 1.0000 |
| intel | d20k | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 357.4 | 184.0 | 548.1 | 0.9953 |
| intel | d20k | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 781.2 | 191.7 | 979.6 | 0.9978 |
| intel | d20k | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1929.6 | 214.3 | 2167.0 | 1.0000 |
| intel | d20k | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1888.3 | 210.1 | 2107.5 | 1.0000 |
| intel | d20k | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 596.7 | 171.7 | 772.9 | 0.9953 |
| intel | d20k | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 18.4 | 578.5 | 286.4 | 849.1 | 1.0000 |
| intel | d20k | faiss_rabitq_ivf | {'nlist': 141} | {'nprobe': 18} |  | 5 | 4.8 | 132.1 | 131.5 | 271.0 | 0.8766 |
| intel | d20k | faiss_rabitq_ivf | {'nlist': 141} | {'nprobe': 9} |  | 5 | 4.9 | 92.2 | 131.2 | 230.9 | 0.7978 |
| intel | d20k | faiss_bin_flat |  | {} |  | 5 | 4.9 | 176.7 | 132.4 | 318.4 | 0.9978 |
| intel | d20k | faiss_rabitq_flat |  | {} |  | 5 | 4.9 | 397.6 | 140.8 | 546.2 | 1.0000 |
| intel | dall | ours_scan |  | {'ef': 400} |  | 5 | 5.3 | 328.1 | 87.3 | 430.4 | 0.9981 |
| intel | dall | ours_walk |  | {'ef': 400} |  | 5 | 5.3 | 160.1 | 77.5 | 250.3 | 0.9927 |
| intel | dall | ours_walk |  | {'ef': 400} | fixed | 5 | 5.4 | 382.2 | 94.7 | 492.1 | 0.9952 |
| intel | dall | ours_walk |  | {'ef': 800} |  | 5 | 5.3 | 239.2 | 82.5 | 334.8 | 0.9948 |
| intel | dall | ours_walk |  | {'ef': 800} | fixed | 5 | 5.4 | 597.9 | 97.0 | 704.8 | 0.9980 |
| intel | dall | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 5.1 | 2866.7 | 205.7 | 3081.2 | 0.9984 |
| intel | dall | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 5.1 | 5141.7 | 208.3 | 5360.5 | 0.9994 |
| intel | dall | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 549.0 | 179.6 | 733.5 | 0.9876 |
| intel | dall | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1984.8 | 212.0 | 2206.4 | 0.9979 |
| intel | dall | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 2106.9 | 215.4 | 2340.8 | 0.9986 |
| intel | dall | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 481.0 | 183.5 | 671.3 | 0.9842 |
| intel | dall | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 999.4 | 179.3 | 1183.7 | 0.9969 |
| intel | dall | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 3620.5 | 213.2 | 3840.3 | 0.9994 |
| intel | dall | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 3833.6 | 212.4 | 4054.4 | 0.9993 |
| intel | dall | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 936.1 | 185.6 | 1125.6 | 0.9944 |
| intel | dall | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 675.6 | 184.0 | 863.6 | 0.9913 |
| intel | dall | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 2272.0 | 211.8 | 2495.0 | 0.9974 |
| intel | dall | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 2355.5 | 212.0 | 2577.1 | 0.9996 |
| intel | dall | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 601.3 | 192.7 | 796.6 | 0.9879 |
| intel | dall | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 1254.7 | 205.4 | 1464.0 | 0.9968 |
| intel | dall | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 4211.0 | 213.4 | 4435.6 | 0.9990 |
| intel | dall | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 4329.3 | 212.9 | 4550.7 | 1.0001 |
| intel | dall | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1241.3 | 201.4 | 1447.1 | 0.9921 |
| intel | dall | scann | {'leaves': 374, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 16.8 | 186.3 | 253.8 | 461.5 | 0.2342 |
| intel | dall | scann | {'leaves': 374, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 8, 'reorder': 400} |  | 5 | 18.0 | 253.1 | 269.6 | 542.4 | 0.3020 |
| intel | dall | faiss_rabitq_ivf | {'nlist': 375} | {'nprobe': 4} |  | 5 | 4.8 | 103.5 | 142.4 | 252.4 | 0.5694 |
| intel | dall | faiss_rabitq_ivf | {'nlist': 375} | {'nprobe': 8} |  | 5 | 4.8 | 150.1 | 140.8 | 298.3 | 0.6689 |
| intel | dall | faiss_bin_flat |  | {} |  | 5 | 4.9 | 510.8 | 170.9 | 682.3 | 0.9982 |
| intel | dall | faiss_rabitq_flat |  | {} |  | 5 | 4.9 | 2502.5 | 164.9 | 2675.5 | 1.0001 |
| intel | fiqa | ours_scan |  | {'ef': 400} |  | 5 | 5.3 | 158.8 | 85.3 | 256.5 | 0.9967 |
| intel | fiqa | ours_walk |  | {'ef': 400} |  | 5 | 5.2 | 97.0 | 70.5 | 180.1 | 0.9994 |
| intel | fiqa | ours_walk |  | {'ef': 400} | fixed | 5 | 5.6 | 241.8 | 85.3 | 341.1 | 0.9968 |
| intel | fiqa | ours_walk |  | {'ef': 800} |  | 5 | 5.0 | 131.2 | 74.5 | 221.4 | 0.9995 |
| intel | fiqa | ours_walk |  | {'ef': 800} | fixed | 5 | 5.2 | 390.8 | 89.5 | 494.6 | 0.9968 |
| intel | fiqa | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 5.1 | 1470.3 | 216.7 | 1699.2 | 1.0000 |
| intel | fiqa | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 5.1 | 2441.9 | 219.9 | 2681.0 | 1.0000 |
| intel | fiqa | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 447.2 | 166.4 | 618.5 | 0.9876 |
| intel | fiqa | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1242.2 | 221.1 | 1469.1 | 1.0000 |
| intel | fiqa | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1153.7 | 214.0 | 1353.3 | 1.0000 |
| intel | fiqa | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 333.4 | 177.0 | 515.7 | 0.9967 |
| intel | fiqa | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 777.3 | 177.6 | 961.7 | 0.9969 |
| intel | fiqa | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 2076.7 | 223.9 | 2318.5 | 1.0000 |
| intel | fiqa | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 2000.6 | 220.3 | 2241.8 | 1.0000 |
| intel | fiqa | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 630.7 | 198.4 | 829.1 | 0.9950 |
| intel | fiqa | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 4.9 | 532.4 | 173.2 | 714.4 | 0.9903 |
| intel | fiqa | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1353.1 | 220.1 | 1575.4 | 1.0000 |
| intel | fiqa | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 1387.4 | 218.9 | 1601.2 | 1.0000 |
| intel | fiqa | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 424.4 | 195.2 | 626.8 | 0.9915 |
| intel | fiqa | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 903.1 | 185.5 | 1092.7 | 0.9969 |
| intel | fiqa | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 2279.4 | 223.3 | 2520.6 | 1.0000 |
| intel | fiqa | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 2290.5 | 220.9 | 2523.3 | 1.0000 |
| intel | fiqa | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 738.4 | 188.0 | 932.1 | 0.9915 |
| intel | fiqa | scann | {'mode': 'ah'} | {'reorder': 400} |  | 5 | 19.1 | 1581.3 | 346.5 | 1967.3 | 1.0000 |
| intel | fiqa | faiss_rabitq_ivf | {'nlist': 240} | {'nprobe': 10} |  | 5 | 4.6 | 137.7 | 147.0 | 293.8 | 0.9588 |
| intel | fiqa | faiss_rabitq_ivf | {'nlist': 240} | {'nprobe': 5} |  | 5 | 4.8 | 98.2 | 150.3 | 255.9 | 0.8618 |
| intel | fiqa | faiss_bin_flat |  | {} |  | 5 | 4.9 | 298.5 | 189.1 | 500.6 | 0.9969 |
| intel | fiqa | faiss_rabitq_flat |  | {} |  | 5 | 4.9 | 1066.2 | 175.5 | 1249.7 | 1.0000 |
| intel | gcsn | ours_scan |  | {'ef': 400} |  | 5 | 4.4 | 25.8 | 58.6 | 93.0 | 0.9996 |
| intel | gcsn | ours_walk |  | {'ef': 400} |  | 5 | 4.4 | 58.6 | 59.5 | 126.6 | 0.9997 |
| intel | gcsn | ours_walk |  | {'ef': 400} | fixed | 5 | 4.6 | 122.1 | 63.3 | 194.9 | 0.9997 |
| intel | gcsn | ours_walk |  | {'ef': 800} |  | 5 | 4.4 | 73.8 | 59.9 | 143.1 | 0.9997 |
| intel | gcsn | ours_walk |  | {'ef': 800} | fixed | 5 | 4.7 | 200.6 | 67.0 | 279.2 | 0.9997 |
| intel | gcsn | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 5.1 | 928.9 | 164.1 | 1095.2 | 1.0000 |
| intel | gcsn | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 5.1 | 1177.1 | 165.1 | 1348.9 | 1.0000 |
| intel | gcsn | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.8 | 318.2 | 128.5 | 455.0 | 0.9996 |
| intel | gcsn | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 838.5 | 153.0 | 997.8 | 1.0000 |
| intel | gcsn | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 802.3 | 155.0 | 965.1 | 1.0000 |
| intel | gcsn | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 4.8 | 211.5 | 127.2 | 346.9 | 0.9963 |
| intel | gcsn | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 4.8 | 483.5 | 130.5 | 621.8 | 0.9996 |
| intel | gcsn | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1146.1 | 169.2 | 1321.5 | 1.0000 |
| intel | gcsn | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1096.9 | 172.8 | 1265.2 | 1.0000 |
| intel | gcsn | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 4.9 | 358.3 | 128.7 | 496.2 | 0.9963 |
| intel | gcsn | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 4.8 | 339.4 | 128.9 | 477.6 | 0.9996 |
| intel | gcsn | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 879.3 | 158.7 | 1044.3 | 1.0000 |
| intel | gcsn | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 828.1 | 158.2 | 997.0 | 1.0000 |
| intel | gcsn | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 4.8 | 225.9 | 128.2 | 363.2 | 0.9943 |
| intel | gcsn | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 4.9 | 511.5 | 129.5 | 648.6 | 0.9996 |
| intel | gcsn | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1174.2 | 160.2 | 1339.3 | 1.0000 |
| intel | gcsn | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 1120.8 | 168.3 | 1283.7 | 1.0000 |
| intel | gcsn | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 4.9 | 376.4 | 129.3 | 515.9 | 0.9942 |
| intel | gcsn | scann | {'mode': 'brute'} | {'reorder': 400} |  | 5 | 18.4 | 784.4 | 234.3 | 1038.9 | 1.0000 |
| intel | gcsn | faiss_rabitq_ivf | {'nlist': 83} | {'nprobe': 15} |  | 5 | 4.8 | 90.4 | 126.8 | 223.5 | 0.9175 |
| intel | gcsn | faiss_rabitq_ivf | {'nlist': 83} | {'nprobe': 30} |  | 5 | 4.8 | 129.8 | 127.3 | 264.0 | 0.9669 |
| intel | gcsn | faiss_bin_flat |  | {} |  | 5 | 4.8 | 126.2 | 124.4 | 258.5 | 0.9996 |
| intel | gcsn | faiss_rabitq_flat |  | {} |  | 5 | 4.8 | 170.2 | 125.1 | 303.4 | 1.0000 |
| intel | quora | ours_walk |  | {'ef': 400} |  | 5 | 5.1 | 112.0 | 89.2 | 215.4 | 0.9999 |
| intel | quora | ours_walk |  | {'ef': 400} | fixed | 5 | 5.4 | 345.4 | 97.5 | 458.4 | 0.9999 |
| intel | quora | ours_walk |  | {'ef': 800} |  | 5 | 5.3 | 162.7 | 91.2 | 268.0 | 0.9999 |
| intel | quora | ours_walk |  | {'ef': 800} | fixed | 5 | 5.4 | 601.2 | 105.6 | 719.0 | 0.9999 |
| intel | quora | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 400} |  | 5 | 5.2 | 2904.2 | 268.6 | 3136.4 | 1.0000 |
| intel | quora | diskann_vamana | {'L': 200, 'R': 64, 'alpha': 1.2} | {'L': 800} |  | 5 | 5.2 | 5274.2 | 277.3 | 5510.9 | 1.0000 |
| intel | quora | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 672.4 | 242.7 | 909.1 | 0.9999 |
| intel | quora | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 2530.1 | 280.4 | 2769.1 | 1.0000 |
| intel | quora | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 2614.9 | 282.3 | 2855.4 | 1.0000 |
| intel | quora | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 528.6 | 244.0 | 768.2 | 0.9991 |
| intel | quora | faiss_bin_hnsw | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1213.4 | 246.2 | 1451.6 | 0.9999 |
| intel | quora | faiss_hnsw_flat | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 4615.2 | 286.7 | 4853.0 | 1.0000 |
| intel | quora | hnswlib_f32 | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 4739.3 | 286.0 | 4979.2 | 1.0000 |
| intel | quora | usearch_b1_rescore | {'M': 32, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1024.1 | 249.0 | 1264.0 | 0.9991 |
| intel | quora | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.0 | 860.9 | 245.4 | 1084.0 | 0.9999 |
| intel | quora | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 3098.5 | 282.4 | 3344.0 | 1.0000 |
| intel | quora | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 3302.6 | 285.1 | 3543.1 | 1.0000 |
| intel | quora | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 400} |  | 5 | 5.1 | 754.8 | 247.9 | 991.8 | 0.9999 |
| intel | quora | faiss_bin_hnsw | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.0 | 1598.0 | 249.7 | 1837.6 | 0.9999 |
| intel | quora | faiss_hnsw_flat | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 5624.4 | 287.0 | 5869.4 | 1.0000 |
| intel | quora | hnswlib_f32 | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 5998.1 | 287.4 | 6234.9 | 1.0000 |
| intel | quora | usearch_b1_rescore | {'M': 64, 'efC': 800} | {'ef': 800} |  | 5 | 5.1 | 1473.1 | 247.8 | 1709.4 | 0.9999 |
| intel | quora | scann | {'leaves': 723, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 2, 'reorder': 400} |  | 5 | 18.4 | 271.8 | 380.7 | 648.8 | 0.8422 |
| intel | quora | scann | {'leaves': 723, 'mode': 'tree_ah', 'soar': 0} | {'leaves_to_search': 4, 'reorder': 400} |  | 5 | 18.7 | 339.4 | 347.8 | 703.1 | 0.9306 |
| intel | quora | faiss_rabitq_ivf | {'nlist': 723} | {'nprobe': 2} |  | 5 | 4.9 | 162.0 | 244.0 | 403.1 | 0.9018 |
| intel | quora | faiss_rabitq_ivf | {'nlist': 723} | {'nprobe': 4} |  | 5 | 4.9 | 218.8 | 237.6 | 455.3 | 0.9616 |
| intel | quora | faiss_bin_flat |  | {} |  | 5 | 5.0 | 1467.3 | 239.9 | 1704.7 | 0.9999 |
| intel | quora | faiss_rabitq_flat |  | {} |  | 5 | 5.0 | 9182.1 | 199.8 | 9375.1 | 1.0000 |

## (B) Quora and csn1m, f = 0.99

| CPU | Set | Model | System | Kind | S1 | Rounds | µs | Slow rounds | Faults per round | Retained / native share |
|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| amd | csn1m | CodeRankEmbed | ours_cascade | native | 400 | 10 | 265.7 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.7974 |
| amd | csn1m | CodeRankEmbed | ours_cascade | timing | 400 | 10 | 265.2 | 0 | [2, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9957 |
| amd | csn1m | CodeRankEmbed | faiss_hnsw_sq8 | timing |  | 10 | 934.9 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9974 |
| amd | csn1m | bge-base-en-v1.5 | ours_cascade | native | 2000 | 10 | 677.2 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9172 |
| amd | csn1m | bge-base-en-v1.5 | ours_cascade | timing | 2000 | 10 | 673.1 | 0 | [0, 2, 0, 0, 0, 0, 0, 0, 0, 2] | 0.9945 |
| amd | csn1m | bge-base-en-v1.5 | ours_cascade | timing | 400 | 10 | 237.0 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9712 |
| amd | csn1m | bge-base-en-v1.5 | faiss_hnsw_sq8 | timing |  | 10 | 1458.0 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9970 |
| amd | csn1m | jina-v2-base-code | ours_cascade | native | 150 | 10 | 124.7 | 1 | [57620, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.6647 |
| amd | csn1m | jina-v2-base-code | ours_cascade | timing | 150 | 10 | 123.4 | 1 | [132422, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9954 |
| amd | csn1m | jina-v2-base-code | ours_cascade | timing | 400 | 10 | 188.1 | 1 | [134320, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9989 |
| amd | csn1m | jina-v2-base-code | faiss_hnsw_sq8 | timing |  | 10 | 304.6 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9919 |
| amd | quora | CodeRankEmbed | ours_cascade | timing | 400 | 10 | 189.8 | 1 | [2902, 0, 12327, 0, 0, 0, 0, 0, 0, 0] | 0.9996 |
| amd | quora | CodeRankEmbed | ours_cascade | native | 50 | 10 | 76.4 | 2 | [1358, 49222, 21694, 0, 0, 0, 0, 0, 0, 0] | 0.5922 |
| amd | quora | CodeRankEmbed | ours_cascade | timing | 50 | 10 | 74.4 | 2 | [1402, 96013, 106978, 0, 0, 0, 0, 0, 0, 0] | 0.9926 |
| amd | quora | CodeRankEmbed | usearch_b1_rescore | timing |  | 10 | 207.5 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9904 |
| amd | quora | bge-base-en-v1.5 | ours_cascade | timing | 400 | 10 | 165.4 | 1 | [0, 0, 21955, 0, 0, 0, 0, 1394, 0, 0] | 0.9999 |
| amd | quora | bge-base-en-v1.5 | ours_cascade | native | 50 | 10 | 69.0 | 1 | [0, 0, 14160, 0, 0, 0, 0, 0, 0, 0] | 0.5486 |
| amd | quora | bge-base-en-v1.5 | ours_cascade | timing | 50 | 10 | 68.3 | 3 | [60108, 0, 12306, 0, 0, 0, 0, 61029, 0, 0] | 0.9983 |
| amd | quora | bge-base-en-v1.5 | faiss_rabitq_hnsw | timing |  | 10 | 83.6 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9896 |
| amd | quora | jina-v2-base-code | ours_cascade | native | 100 | 10 | 81.3 | 1 | [72136, 4012, 0, 0, 0, 0, 0, 0, 0, 0] | 0.6084 |
| amd | quora | jina-v2-base-code | ours_cascade | timing | 100 | 10 | 79.9 | 3 | [70505, 92166, 0, 0, 0, 155083, 0, 0, 0, 0] | 0.9951 |
| amd | quora | jina-v2-base-code | ours_cascade | timing | 400 | 10 | 151.8 | 1 | [67428, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9987 |
| amd | quora | jina-v2-base-code | faiss_bin_hnsw | timing |  | 10 | 249.8 | 0 | [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] | 0.9939 |
| arm | csn1m | CodeRankEmbed | ours_cascade | native | 400 | 6 | 767.1 | 0 | [0, 0, 0, 0, 0, 0] | 0.8666 |
| arm | csn1m | CodeRankEmbed | ours_cascade | timing | 400 | 6 | 754.5 | 0 | [0, 0, 0, 0, 0, 0] | 0.9957 |
| arm | csn1m | CodeRankEmbed | faiss_bin_hnsw | timing |  | 6 | 2011.5 | 0 | [0, 0, 0, 0, 0, 0] | 0.9946 |
| arm | csn1m | bge-base-en-v1.5 | ours_cascade | native | 2000 | 6 | 1859.5 | 0 | [0, 0, 0, 0, 0, 0] | 0.9227 |
| arm | csn1m | bge-base-en-v1.5 | ours_cascade | timing | 2000 | 6 | 1854.2 | 0 | [0, 0, 0, 0, 0, 0] | 0.9945 |
| arm | csn1m | bge-base-en-v1.5 | ours_cascade | timing | 400 | 6 | 654.8 | 0 | [0, 0, 0, 0, 0, 0] | 0.9712 |
| arm | csn1m | bge-base-en-v1.5 | faiss_hnsw_flat | timing |  | 6 | 3524.9 | 0 | [0, 0, 0, 0, 0, 0] | 0.9970 |
| arm | csn1m | jina-v2-base-code | ours_cascade | native | 150 | 6 | 288.5 | 0 | [0, 0, 0, 0, 0, 0] | 0.7429 |
| arm | csn1m | jina-v2-base-code | ours_cascade | timing | 150 | 6 | 284.8 | 0 | [0, 0, 0, 0, 0, 0] | 0.9954 |
| arm | csn1m | jina-v2-base-code | ours_cascade | timing | 400 | 6 | 461.1 | 0 | [0, 0, 0, 0, 0, 0] | 0.9989 |
| arm | csn1m | jina-v2-base-code | usearch_b1_rescore | timing |  | 6 | 602.5 | 0 | [0, 0, 0, 0, 0, 0] | 0.9882 |
| arm | quora | CodeRankEmbed | ours_cascade | timing | 400 | 6 | 371.0 | 2 | [45081, 131868, 0, 0, 0, 0] | 0.9996 |
| arm | quora | CodeRankEmbed | ours_cascade | native | 50 | 6 | 143.9 | 1 | [0, 141749, 0, 0, 0, 0] | 0.6647 |
| arm | quora | CodeRankEmbed | ours_cascade | timing | 50 | 6 | 140.2 | 2 | [91004, 142561, 0, 0, 0, 0] | 0.9926 |
| arm | quora | CodeRankEmbed | faiss_bin_hnsw | timing |  | 6 | 218.8 | 0 | [0, 0, 0, 0, 0, 0] | 0.9920 |
| arm | quora | bge-base-en-v1.5 | ours_cascade | timing | 400 | 6 | 298.5 | 0 | [0, 1251, 0, 0, 0, 0] | 0.9999 |
| arm | quora | bge-base-en-v1.5 | ours_cascade | native | 50 | 6 | 132.4 | 0 | [0, 0, 0, 0, 0, 0] | 0.6248 |
| arm | quora | bge-base-en-v1.5 | ours_cascade | timing | 50 | 6 | 131.0 | 1 | [0, 163648, 0, 0, 0, 0] | 0.9983 |
| arm | quora | bge-base-en-v1.5 | faiss_bin_hnsw | timing |  | 6 | 96.6 | 0 | [0, 0, 0, 0, 0, 0] | 0.9944 |
| arm | quora | jina-v2-base-code | ours_cascade | native | 100 | 6 | 156.9 | 0 | [0, 0, 0, 0, 0, 0] | 0.6722 |
| arm | quora | jina-v2-base-code | ours_cascade | timing | 100 | 6 | 155.5 | 0 | [0, 0, 0, 0, 0, 0] | 0.9951 |
| arm | quora | jina-v2-base-code | ours_cascade | timing | 400 | 6 | 286.8 | 0 | [0, 0, 0, 0, 0, 0] | 0.9987 |
| arm | quora | jina-v2-base-code | faiss_bin_hnsw | timing |  | 6 | 298.1 | 0 | [0, 0, 0, 0, 0, 0] | 0.9939 |
| intel | csn1m | CodeRankEmbed | ours_cascade | native | 400 | 5 | 463.6 | 0 | [0, 0, 0, 0, 0] | 0.8201 |
| intel | csn1m | CodeRankEmbed | ours_cascade | timing | 400 | 5 | 456.1 | 0 | [2, 0, 0, 0, 0] | 0.9957 |
| intel | csn1m | CodeRankEmbed | svs_vamana_lvq | timing |  | 5 | 1670.4 | 0 | [6, 0, 0, 0, 0] | 0.9974 |
| intel | csn1m | bge-base-en-v1.5 | ours_cascade | native | 3000 | 5 | 1636.4 | 0 | [0, 0, 0, 0, 0] | 0.9384 |
| intel | csn1m | bge-base-en-v1.5 | ours_cascade | timing | 3000 | 5 | 1630.6 | 0 | [0, 0, 2, 0, 0] | 0.9971 |
| intel | csn1m | bge-base-en-v1.5 | ours_cascade | timing | 400 | 5 | 396.5 | 0 | [0, 0, 0, 0, 0] | 0.9712 |
| intel | csn1m | bge-base-en-v1.5 | faiss_hnsw_flat | timing |  | 5 | 3632.1 | 0 | [0, 0, 0, 0, 0] | 0.9970 |
| intel | csn1m | jina-v2-base-code | ours_cascade | native | 150 | 5 | 163.3 | 1 | [0, 43631, 0, 0, 0] | 0.6719 |
| intel | csn1m | jina-v2-base-code | ours_cascade | timing | 150 | 5 | 172.3 | 1 | [1844, 31637, 0, 2, 0] | 0.9954 |
| intel | csn1m | jina-v2-base-code | ours_cascade | timing | 400 | 5 | 246.9 | 1 | [0, 44335, 0, 0, 0] | 0.9989 |
| intel | csn1m | jina-v2-base-code | usearch_b1_rescore | timing |  | 5 | 226.9 | 0 | [0, 0, 0, 0, 0] | 0.9882 |
| intel | quora | CodeRankEmbed | ours_cascade | timing | 400 | 5 | 234.7 | 0 | [0, 0, 0, 0, 0] | 0.9996 |
| intel | quora | CodeRankEmbed | ours_cascade | native | 50 | 5 | 96.4 | 0 | [0, 0, 0, 0, 0] | 0.6147 |
| intel | quora | CodeRankEmbed | ours_cascade | timing | 50 | 5 | 97.1 | 0 | [0, 0, 0, 0, 0] | 0.9926 |
| intel | quora | CodeRankEmbed | usearch_b1_rescore | timing |  | 5 | 165.2 | 0 | [0, 0, 0, 0, 0] | 0.9904 |
| intel | quora | bge-base-en-v1.5 | ours_cascade | timing | 400 | 5 | 205.0 | 0 | [0, 0, 0, 0, 0] | 0.9999 |
| intel | quora | bge-base-en-v1.5 | ours_cascade | native | 50 | 5 | 89.7 | 0 | [0, 0, 0, 0, 0] | 0.5946 |
| intel | quora | bge-base-en-v1.5 | ours_cascade | timing | 50 | 5 | 91.6 | 0 | [0, 0, 0, 0, 0] | 0.9983 |
| intel | quora | bge-base-en-v1.5 | svs_vamana_leanvec | timing |  | 5 | 54.3 | 0 | [16, 0, 0, 0, 0] | 0.9938 |
| intel | quora | jina-v2-base-code | ours_cascade | native | 100 | 5 | 104.4 | 0 | [0, 0, 0, 0, 0] | 0.6276 |
| intel | quora | jina-v2-base-code | ours_cascade | timing | 100 | 5 | 100.4 | 0 | [0, 0, 0, 0, 0] | 0.9951 |
| intel | quora | jina-v2-base-code | ours_cascade | timing | 400 | 5 | 176.6 | 0 | [0, 0, 0, 0, 0] | 0.9987 |
| intel | quora | jina-v2-base-code | faiss_bin_hnsw | timing |  | 5 | 231.9 | 0 | [0, 0, 0, 0, 0] | 0.9940 |
