# Quality: descriptive additions (BEIR, fresh held-out; aggregates only)

## nDCG@10 by score source

| cell | BM25 order | S-clamp | Spre-b-noclamp | C-b-noclamp | C-a-f32-noclamp | C-a-bf16-noclamp | C-a-f16-noclamp |
|---|--:|--:|--:|--:|--:|--:|--:|
| scifact|colbertv2|k10 | 0.6617 | 0.6522 | 0.6522 | 0.6516 | 0.6516 | 0.6516 | 0.6516 |
| scifact|colbertv2|k25 | 0.6617 | 0.6552 | 0.6552 | 0.6547 | 0.6547 | 0.6547 | 0.6547 |
| scifact|colbertv2|k50 | 0.6617 | 0.6495 | 0.6495 | 0.6490 | 0.6490 | 0.6490 | 0.6490 |
| scifact|colbertv2|k100 | 0.6617 | 0.6451 | 0.6451 | 0.6446 | 0.6446 | 0.6446 | 0.6446 |
| scifact|colbertv2|k200 | 0.6617 | 0.6500 | 0.6500 | 0.6505 | 0.6505 | 0.6505 | 0.6505 |
| scifact|answersmall|k10 | 0.6617 | 0.6866 | 0.6866 | 0.6964 | 0.6964 | 0.6964 | 0.6964 |
| scifact|answersmall|k25 | 0.6617 | 0.7015 | 0.7015 | 0.7128 | 0.7128 | 0.7128 | 0.7128 |
| scifact|answersmall|k50 | 0.6617 | 0.7063 | 0.7063 | 0.7211 | 0.7211 | 0.7211 | 0.7211 |
| scifact|answersmall|k100 | 0.6617 | 0.6998 | 0.6998 | 0.7190 | 0.7190 | 0.7190 | 0.7190 |
| scifact|answersmall|k200 | 0.6617 | 0.7076 | 0.7076 | 0.7289 | 0.7289 | 0.7289 | 0.7289 |
| nfcorpus|colbertv2|k10 | 0.3064 | 0.3135 | 0.3135 | 0.3127 | 0.3127 | 0.3127 | 0.3127 |
| nfcorpus|colbertv2|k25 | 0.3064 | 0.3174 | 0.3174 | 0.3173 | 0.3173 | 0.3171 | 0.3173 |
| nfcorpus|colbertv2|k50 | 0.3064 | 0.3203 | 0.3203 | 0.3201 | 0.3201 | 0.3201 | 0.3201 |
| nfcorpus|colbertv2|k100 | 0.3064 | 0.3234 | 0.3234 | 0.3229 | 0.3229 | 0.3229 | 0.3229 |
| nfcorpus|colbertv2|k200 | 0.3064 | 0.3247 | 0.3247 | 0.3241 | 0.3241 | 0.3241 | 0.3241 |
| nfcorpus|answersmall|k10 | 0.3064 | 0.3017 | 0.3017 | 0.3196 | 0.3196 | 0.3196 | 0.3196 |
| nfcorpus|answersmall|k25 | 0.3064 | 0.2896 | 0.2896 | 0.3318 | 0.3318 | 0.3322 | 0.3317 |
| nfcorpus|answersmall|k50 | 0.3064 | 0.2802 | 0.2802 | 0.3342 | 0.3342 | 0.3340 | 0.3342 |
| nfcorpus|answersmall|k100 | 0.3064 | 0.2714 | 0.2714 | 0.3379 | 0.3379 | 0.3380 | 0.3380 |
| nfcorpus|answersmall|k200 | 0.3064 | 0.2637 | 0.2637 | 0.3425 | 0.3425 | 0.3426 | 0.3427 |

## Kernel scores across platforms

| cell | pair | bit-equal scores | max abs diff | same ranking |
|---|---|--:|--:|--:|
| scifact|colbertv2|k10 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|colbertv2|k10 | arm vs intel | 62.17% | 1.2e-07 | 100.00% |
| scifact|colbertv2|k10 | m3max vs intel | 62.17% | 1.2e-07 | 100.00% |
| scifact|colbertv2|k25 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|colbertv2|k25 | arm vs intel | 61.52% | 1.2e-07 | 100.00% |
| scifact|colbertv2|k25 | m3max vs intel | 61.52% | 1.2e-07 | 100.00% |
| scifact|colbertv2|k50 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|colbertv2|k50 | arm vs intel | 62.41% | 1.5e-07 | 100.00% |
| scifact|colbertv2|k50 | m3max vs intel | 62.41% | 1.5e-07 | 100.00% |
| scifact|colbertv2|k100 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|colbertv2|k100 | arm vs intel | 62.21% | 1.8e-07 | 100.00% |
| scifact|colbertv2|k100 | m3max vs intel | 62.21% | 1.8e-07 | 100.00% |
| scifact|colbertv2|k200 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|colbertv2|k200 | arm vs intel | 62.38% | 1.8e-07 | 100.00% |
| scifact|colbertv2|k200 | m3max vs intel | 62.38% | 1.8e-07 | 100.00% |
| scifact|answersmall|k10 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|answersmall|k10 | arm vs intel | 59.97% | 3.0e-07 | 100.00% |
| scifact|answersmall|k10 | m3max vs intel | 59.97% | 3.0e-07 | 100.00% |
| scifact|answersmall|k25 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|answersmall|k25 | arm vs intel | 59.72% | 3.0e-07 | 100.00% |
| scifact|answersmall|k25 | m3max vs intel | 59.72% | 3.0e-07 | 100.00% |
| scifact|answersmall|k50 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|answersmall|k50 | arm vs intel | 59.37% | 3.0e-07 | 100.00% |
| scifact|answersmall|k50 | m3max vs intel | 59.37% | 3.0e-07 | 100.00% |
| scifact|answersmall|k100 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|answersmall|k100 | arm vs intel | 59.53% | 3.0e-07 | 99.00% |
| scifact|answersmall|k100 | m3max vs intel | 59.53% | 3.0e-07 | 99.00% |
| scifact|answersmall|k200 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| scifact|answersmall|k200 | arm vs intel | 59.42% | 3.0e-07 | 96.00% |
| scifact|answersmall|k200 | m3max vs intel | 59.42% | 3.0e-07 | 96.00% |
| nfcorpus|colbertv2|k10 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|colbertv2|k10 | arm vs intel | 61.30% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k10 | m3max vs intel | 61.30% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k25 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|colbertv2|k25 | arm vs intel | 60.20% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k25 | m3max vs intel | 60.20% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k50 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|colbertv2|k50 | arm vs intel | 59.30% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k50 | m3max vs intel | 59.30% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k100 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|colbertv2|k100 | arm vs intel | 58.86% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k100 | m3max vs intel | 58.86% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k200 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|colbertv2|k200 | arm vs intel | 58.16% | 1.8e-07 | 100.00% |
| nfcorpus|colbertv2|k200 | m3max vs intel | 58.16% | 1.8e-07 | 100.00% |
| nfcorpus|answersmall|k10 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|answersmall|k10 | arm vs intel | 59.13% | 2.4e-07 | 100.00% |
| nfcorpus|answersmall|k10 | m3max vs intel | 59.13% | 2.4e-07 | 100.00% |
| nfcorpus|answersmall|k25 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|answersmall|k25 | arm vs intel | 59.07% | 2.4e-07 | 100.00% |
| nfcorpus|answersmall|k25 | m3max vs intel | 59.07% | 2.4e-07 | 100.00% |
| nfcorpus|answersmall|k50 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|answersmall|k50 | arm vs intel | 58.94% | 3.0e-07 | 99.69% |
| nfcorpus|answersmall|k50 | m3max vs intel | 58.94% | 3.0e-07 | 99.69% |
| nfcorpus|answersmall|k100 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|answersmall|k100 | arm vs intel | 59.13% | 3.0e-07 | 99.07% |
| nfcorpus|answersmall|k100 | m3max vs intel | 59.13% | 3.0e-07 | 99.07% |
| nfcorpus|answersmall|k200 | amd vs intel | 100.00% | 0.0e+00 | 100.00% |
| nfcorpus|answersmall|k200 | arm vs intel | 59.23% | 3.0e-07 | 94.43% |
| nfcorpus|answersmall|k200 | m3max vs intel | 59.23% | 3.0e-07 | 94.43% |

## int4 diagnostic (100,000 evenly spaced doc tokens per model and dataset)

| data | dim | rel. error median / p90 | cosine median / p10 | stored norm p1 / median / p99 | decoded / stored norm p1 / p10 / median / p90 / p99 (sd) |
|---|--:|--:|--:|--:|--:|
| scifact|colbertv2 | 128 | 0.098 / 0.112 | 0.9953 / 0.9938 | 1.000 / 1.000 / 1.000 | 0.986 / 0.995 / 1.005 / 1.016 / 1.025 (0.0084) |
| scifact|answersmall | 96 | 0.094 / 0.105 | 0.9956 / 0.9946 | 1.000 / 1.000 / 1.000 | 0.984 / 0.993 / 1.005 / 1.017 / 1.026 (0.0091) |
| nfcorpus|colbertv2 | 128 | 0.098 / 0.112 | 0.9953 / 0.9938 | 1.000 / 1.000 / 1.000 | 0.986 / 0.995 / 1.005 / 1.016 / 1.025 (0.0083) |
| nfcorpus|answersmall | 96 | 0.093 / 0.103 | 0.9958 / 0.9948 | 1.000 / 1.000 / 1.000 | 0.984 / 0.993 / 1.005 / 1.016 / 1.026 (0.0089) |

## Score margins under F at k = 100 (median over queries)

| data | coefficient of variation of candidate scores | (top-1 - top-10) / top-1 |
|---|--:|--:|
| scifact|colbertv2 | 0.1872 | 0.2301 |
| scifact|answersmall | 0.0081 | 0.0214 |
| nfcorpus|colbertv2 | 0.3538 | 0.3068 |
| nfcorpus|answersmall | 0.0044 | 0.0084 |

## Post-hoc descriptive tests at k = 100 (same paired bootstrap as the primary test; not pre-registered)

| cell | contrast | mean diff | 95% CI | relative |
|---|---|--:|--:|--:|
| scifact|colbertv2|k100 | C-b - F | +0.0002 | [-0.0008, +0.0014] | +0.03% |
| scifact|colbertv2|k100 | S - F | +0.0006 | [-0.0006, +0.0021] | +0.10% |
| scifact|answersmall|k100 | C-b - F | -0.0092 | [-0.0185, -0.0006] | -1.27% |
| scifact|answersmall|k100 | S - F | -0.0285 | [-0.0497, -0.0088] | -3.91% |
| nfcorpus|colbertv2|k100 | C-b - F | -0.0011 | [-0.0028, +0.0005] | -0.35% |
| nfcorpus|colbertv2|k100 | S - F | -0.0007 | [-0.0021, +0.0007] | -0.21% |
| nfcorpus|answersmall|k100 | C-b - F | -0.0069 | [-0.0130, -0.0014] | -2.01% |
| nfcorpus|answersmall|k100 | S - F | -0.0734 | [-0.0890, -0.0586] | -21.29% |
