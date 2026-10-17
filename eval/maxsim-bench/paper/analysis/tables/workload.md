# Workload shapes (unique calls; not a request-frequency distribution)

| set | calls | query tokens p10/p50/p90/max | pool p10/p50/p90/max | doc tokens per candidate p10/p50/p90 | stored doc tokens per call p50/p90/max | query > 32 tokens |
|---|--:|--:|--:|--:|--:|--:|
| agent-ho | 2004 | 11 / 15 / 19 / 45 | 9 / 25 / 25 / 1511 | 243 / 318 / 400 | 7044 / 9654 / 454917 | 0.2% |
| gcsn-ho | 2378 | 9 / 14 / 20 / 84 | 20 / 20 / 20 / 20 | 110 / 151 / 209 | 3020 / 4188 / 6883 | 0.9% |
| beir (20 sets) | 6230 | 32 / 32 / 32 / 32 | 10 / 50 / 200 / 200 | 154 / 166 / 245 | 9227 / 33227 / 50077 | 0.0% |
| sweep-ho (84 cells) | 2913 | 8 / 32 / 64 / 64 | 1 / 16 / 256 / 4096 | 32 / 128 / 512 | 2048 / 16742 / 2097152 | 33.3% |
