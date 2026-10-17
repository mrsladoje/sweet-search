# Speed tables (held-out; agent-ho, gcsn-ho and sweep-ho previously examined; BEIR fresh)

ratio = rival / sweet kernel, geometric mean over calls; > 1 = sweet faster. [workload 95% CI: cluster bootstrap, 10,000 resamples, seed 42] (execution spread: min–max over the R = 5 process repetitions).

## warm

### Intel — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.08 [1.07, 1.09] (1.06–1.08) | 98% | 1.7e-07 | 100.0% |
| previous production path | `node-legacy` | 2004 | 11 | 5.14 [4.98, 5.34] (5.12–5.18) | 100% | 1.7e-07 | 100.0% |
| NumPy, f32 | `numpy_packed@t8` | 2004 | 11 | 1.69 [1.67, 1.70] (1.68–1.70) | 100% | 1.0e-07 | 99.9% |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | — | not run | | | |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2004 | 11 | 1.39 [1.30, 1.46] (1.39–1.41) | 96% | 1.0e-07 | 99.9% |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 11 | 1.32 [1.18, 1.45] (1.32–1.34) | 81% | 9.3e-04 | 99.6% |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 11 | 2.33 [2.25, 2.44] (2.33–2.38) | 100% | 1.6e-07 | 99.9% |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 6.87 [6.67, 7.04] (6.87–6.94) | 100% | 1.6e-07 | 99.9% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 0.70 [0.65, 0.77] (0.74–0.76) | 18% | 3.7e-02 | 97.4% |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 0.62 [0.57, 0.68] (0.66–0.67) | 13% | 7.8e-02 | 86.0% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 0.64 [0.59, 0.70] (0.67–0.69) | 13% | 7.8e-02 | 86.0% |

### Intel — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.15 [1.15, 1.15] (1.14–1.17) | 100% | 2.4e-07 | 100.0% |
| previous production path | `node-legacy` | 2378 | 2378 | 6.52 [6.48, 6.56] (6.42–6.60) | 100% | 2.4e-07 | 100.0% |
| NumPy, f32 | `numpy_packed@t8` | 2378 | 2378 | 1.82 [1.81, 1.82] (1.78–1.85) | 100% | 1.1e-07 | 100.0% |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | — | not run | | | |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2378 | 2378 | 2.01 [1.99, 2.02] (2.01–2.04) | 100% | 1.1e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2378 | 2.16 [2.14, 2.17] (2.14–2.21) | 100% | 1.1e-03 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2378 | 2.70 [2.67, 2.72] (2.67–2.79) | 100% | 1.7e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 6.51 [6.43, 6.58] (6.20–6.98) | 100% | 2.0e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 0.88 [0.88, 0.89] (0.90–0.93) | 27% | 2.7e-02 | 98.7% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.72 [0.72, 0.73] (0.71–0.72) | 0% | 9.0e-02 | 94.5% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 0.90 [0.89, 0.91] (0.92–0.95) | 31% | 9.0e-02 | 94.6% |

### Intel — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.06 [1.06, 1.06] (1.05–1.06) | 97% | 3.4e-07 | 100.0% |
| NumPy, f32 | `numpy_packed` | 6230 | 623 | 1.71 [1.70, 1.71] (1.69–1.71) | 100% | 1.1e-07 | 100.0% |
| NumPy (MKL), f32 | `numpy_packed+mkl` | — | — | not run | | | |
| PyTorch, f32 | `torch_colbert_packed` | 6230 | 623 | 2.02 [2.02, 2.03] (2.02–2.05) | 90% | 1.9e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 6230 | 623 | 0.85 [0.85, 0.86] (0.85–0.86) | 39% | 2.6e-03 | 97.5% |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 6230 | 623 | 1.48 [1.48, 1.48] (1.48–1.49) | 100% | 3.2e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t8` | 6230 | 623 | 8.31 [8.28, 8.33] (8.16–8.23) | 100% | 3.2e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 0.35 [0.34, 0.35] (0.36–0.36) | 0% | 4.0e-02 | 78.2% |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 0.33 [0.33, 0.33] (0.34–0.35) | 0% | 2.1e-01 | 57.8% |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 0.34 [0.34, 0.34] (0.35–0.36) | 0% | 2.1e-01 | 57.7% |

### AMD — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.17 [1.14, 1.22] (1.16–1.19) | 99% | 1.7e-07 | 100.0% |
| previous production path | `node-legacy` | 2004 | 11 | 6.28 [6.07, 6.51] (6.20–6.35) | 100% | 1.7e-07 | 100.0% |
| NumPy, f32 | `numpy_packed` | 2004 | 11 | 4.46 [4.31, 4.60] (4.42–4.48) | 100% | 1.0e-07 | 99.9% |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2004 | 11 | 48.14 [45.41, 50.07] (47.62–48.38) | 100% | 9.5e-08 | 99.9% |
| PyTorch, f32 | `torch_pad_bmm` | 2004 | 11 | 3.28 [3.13, 3.45] (3.23–3.30) | 100% | 1.0e-07 | 99.9% |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 11 | 3.10 [2.86, 3.34] (3.06–3.14) | 100% | 9.3e-04 | 99.6% |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 11 | 4.13 [4.01, 4.25] (4.09–4.17) | 100% | 1.6e-07 | 99.9% |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 12.04 [11.49, 12.66] (11.91–12.14) | 100% | 1.6e-07 | 99.9% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 1.88 [1.74, 2.01] (1.92–1.97) | 97% | 8.0e-02 | 86.0% |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 1.85 [1.71, 1.97] (1.90–1.94) | 96% | 7.8e-02 | 86.2% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 1.73 [1.60, 1.85] (1.77–1.85) | 96% | 7.8e-02 | 86.0% |

### AMD — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.23 [1.23, 1.24] (1.22–1.26) | 100% | 2.4e-07 | 100.0% |
| previous production path | `node-legacy` | 2378 | 2378 | 7.10 [7.06, 7.14] (7.00–7.22) | 100% | 2.4e-07 | 100.0% |
| NumPy, f32 | `numpy_packed_t` | 2378 | 2378 | 4.30 [4.27, 4.33] (4.24–4.35) | 100% | 1.1e-07 | 100.0% |
| NumPy (BLIS), f32 | `numpy_packed+blis` | 2378 | 2378 | 36.80 [36.50, 37.11] (36.25–37.13) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm` | 2378 | 2378 | 4.50 [4.47, 4.53] (4.42–4.55) | 100% | 1.1e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2378 | 2378 | 4.25 [4.23, 4.28] (4.11–4.34) | 100% | 1.1e-03 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2378 | 4.53 [4.50, 4.56] (4.48–4.59) | 100% | 1.7e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 9.32 [9.16, 9.48] (8.49–9.73) | 100% | 2.0e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 1.53 [1.52, 1.54] (1.57–1.67) | 100% | 9.0e-02 | 94.4% |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 2378 | 1.49 [1.48, 1.49] (1.54–1.58) | 100% | 9.0e-02 | 94.5% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 1.41 [1.40, 1.41] (1.45–1.60) | 100% | 9.0e-02 | 94.6% |

### AMD — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.12 [1.12, 1.13] (1.05–1.06) | 94% | 3.4e-07 | 100.0% |
| NumPy, f32 | `numpy_packed` | 6230 | 623 | 4.39 [4.36, 4.42] (4.07–4.13) | 100% | 1.1e-07 | 100.0% |
| NumPy (BLIS), f32 | `numpy_packed+blis` | 6230 | 623 | 51.42 [51.06, 51.74] (47.52–48.65) | 100% | 9.5e-08 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm` | 6230 | 623 | 2.22 [2.20, 2.23] (2.05–2.09) | 100% | 1.1e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 6230 | 623 | 1.98 [1.96, 1.99] (1.81–1.87) | 100% | 2.6e-03 | 97.5% |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 6230 | 623 | 3.14 [3.13, 3.16] (2.92–3.00) | 100% | 3.2e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 16.04 [15.93, 16.14] (14.81–15.13) | 100% | 3.2e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 1.11 [1.10, 1.12] (1.05–1.08) | 50% | 2.1e-01 | 58.3% |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 1.08 [1.07, 1.09] (1.02–1.05) | 47% | 2.1e-01 | 57.8% |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 1.06 [1.05, 1.07] (1.01–1.03) | 44% | 2.1e-01 | 57.7% |

### Graviton4 — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.15 [1.14, 1.17] (1.14–1.16) | 100% | 1.7e-07 | 100.0% |
| previous production path | `node-legacy` | 2004 | 11 | 3.58 [3.39, 3.81] (3.54–3.61) | 100% | 1.7e-07 | 100.0% |
| NumPy, f32 | `numpy_packed` | 2004 | 11 | 1.65 [1.63, 1.68] (1.63–1.65) | 100% | 1.0e-07 | 99.9% |
| PyTorch, f32 | `torch_pad_flat` | 2004 | 11 | 3.02 [2.81, 3.27] (2.99–3.07) | 100% | 1.0e-07 | 99.9% |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 11 | 3.62 [3.27, 4.04] (3.55–3.64) | 100% | 9.3e-04 | 99.6% |
| NextPlaid, f32 | `nextplaid` | 2004 | 11 | 2.71 [2.57, 2.88] (2.66–2.72) | 100% | 1.6e-07 | 99.9% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 0.82 [0.74, 0.94] (0.81–0.83) | 23% | 8.0e-02 | 86.0% |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 0.85 [0.77, 0.98] (0.85–0.86) | 23% | 7.8e-02 | 86.2% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 0.86 [0.78, 0.98] (0.85–0.86) | 23% | 7.8e-02 | 86.0% |

### Graviton4 — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.22 [1.22, 1.22] (1.21–1.23) | 100% | 2.0e-07 | 100.0% |
| previous production path | `node-legacy` | 2378 | 2378 | 5.39 [5.35, 5.43] (5.36–5.40) | 100% | 2.0e-07 | 100.0% |
| NumPy, f32 | `numpy_packed` | 2378 | 2378 | 1.84 [1.83, 1.85] (1.83–1.86) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_flat` | 2378 | 2378 | 4.61 [4.58, 4.64] (4.61–4.65) | 100% | 1.1e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2378 | 5.19 [5.15, 5.24] (5.16–5.33) | 100% | 1.1e-03 | 100.0% |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 3.23 [3.19, 3.26] (3.18–3.27) | 100% | 2.0e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 0.90 [0.90, 0.91] (0.90–0.91) | 26% | 9.0e-02 | 94.4% |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 2378 | 0.94 [0.93, 0.94] (0.94–0.95) | 35% | 9.0e-02 | 94.5% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 0.95 [0.94, 0.95] (0.94–0.96) | 37% | 9.0e-02 | 94.6% |

### Graviton4 — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.09 [1.09, 1.09] (1.09–1.09) | 100% | 3.3e-07 | 100.0% |
| NumPy, f32 | `numpy_packed` | 6230 | 623 | 1.60 [1.59, 1.60] (1.59–1.59) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_flat` | 6230 | 623 | 1.61 [1.61, 1.62] (1.61–1.67) | 99% | 1.1e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 6230 | 623 | 1.18 [1.18, 1.19] (1.18–1.18) | 44% | 2.6e-03 | 97.5% |
| NextPlaid, f32 | `nextplaid` | 6230 | 623 | 1.56 [1.56, 1.57] (1.55–1.57) | 100% | 3.2e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 0.55 [0.55, 0.55] (0.55–0.55) | 20% | 2.1e-01 | 58.3% |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 0.58 [0.57, 0.58] (0.57–0.57) | 20% | 2.1e-01 | 57.8% |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 0.60 [0.60, 0.60] (0.60–0.60) | 20% | 2.1e-01 | 57.7% |

### M3 Max — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.08 [1.07, 1.10] (0.99–1.14) | 97% | 1.7e-07 | 100.0% |
| previous production path | `node-legacy` | 2004 | 11 | 3.44 [3.17, 3.70] (2.86–3.56) | 100% | 1.7e-07 | 100.0% |
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.74 [1.56, 1.92] (1.20–2.00) | 99% | 1.0e-07 | 99.9% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 3.68 [3.35, 4.00] (2.48–4.24) | 100% | 1.0e-07 | 99.9% |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2004 | 11 | 7.69 [7.02, 8.47] (5.78–8.67) | 100% | 9.3e-04 | 99.6% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 5.57 [4.99, 6.14] (3.73–6.47) | 99% | 4.1e-02 | 100.0% |
| NextPlaid, f32 | `nextplaid` | 2004 | 11 | 3.33 [3.04, 3.59] (2.64–3.74) | 100% | 1.6e-07 | 99.9% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 1.54 [1.40, 1.66] (1.21–1.82) | 88% | 8.0e-02 | 86.0% |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 1.52 [1.38, 1.64] (1.19–1.81) | 88% | 7.8e-02 | 86.2% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 1.52 [1.39, 1.64] (1.18–1.84) | 88% | 7.8e-02 | 86.0% |

### M3 Max — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.08 [1.08, 1.08] (1.07–1.09) | 100% | 2.0e-07 | 100.0% |
| previous production path | `node-legacy` | 2378 | 2378 | 4.80 [4.77, 4.84] (4.91–5.02) | 100% | 2.0e-07 | 100.0% |
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 2.14 [2.13, 2.16] (2.09–2.15) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_segment_reduce` | 2378 | 2378 | 5.31 [5.29, 5.32] (5.20–5.35) | 100% | 1.1e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2378 | 11.27 [11.19, 11.34] (11.01–11.33) | 100% | 1.1e-03 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 7.27 [7.22, 7.33] (7.11–7.31) | 100% | 3.4e-02 | 100.0% |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 5.20 [5.16, 5.24] (5.17–5.33) | 100% | 2.0e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 2.74 [2.71, 2.77] (2.90–3.00) | 100% | 9.0e-02 | 94.4% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 2.41 [2.39, 2.42] (2.37–2.44) | 100% | 9.0e-02 | 94.5% |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 2.74 [2.71, 2.77] (2.87–2.98) | 100% | 9.0e-02 | 94.6% |

### M3 Max — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.06 [1.05, 1.06] (1.05–1.08) | 99% | 3.3e-07 | 100.0% |
| NumPy, f32 | `numpy_packed@t12` | 6230 | 623 | 1.48 [1.47, 1.48] (1.41–1.47) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_colbert_packed` | 6230 | 623 | 2.57 [2.57, 2.58] (2.46–2.57) | 98% | 1.7e-07 | 100.0% |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 6230 | 623 | 4.29 [4.28, 4.30] (4.24–4.39) | 100% | 2.6e-03 | 97.5% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t12` | 6230 | 623 | 6.26 [6.23, 6.29] (5.99–6.24) | 100% | 7.6e-02 | 100.0% |
| NextPlaid, f32 | `nextplaid` | 6230 | 623 | 2.34 [2.33, 2.34] (2.29–2.36) | 100% | 3.2e-07 | 100.0% |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 0.99 [0.99, 0.99] (1.00–1.04) | 41% | 2.1e-01 | 58.3% |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 0.99 [0.98, 0.99] (1.00–1.04) | 41% | 2.1e-01 | 57.8% |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 1.00 [1.00, 1.00] (1.01–1.05) | 41% | 2.1e-01 | 57.7% |

## single

### Intel — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.14 [1.12, 1.15] (1.13–1.16) | 88% | 1.0e-07 | 99.9% |
| NumPy (MKL), f32 | `numpy_packed@t1+mkl` | — | — | not run | | | |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 1.40 [1.32, 1.48] (1.40–1.42) | 94% | 1.0e-07 | 99.9% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 1.55 [1.54, 1.57] (1.54–1.84) | 100% | 1.6e-07 | 99.9% |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.16 [1.11, 1.21] (1.16–1.19) | 93% | 1.6e-07 | 99.9% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.10 [0.10, 0.11] (0.10–0.11) | 0% | 7.8e-02 | 86.0% |

### Intel — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 1.26 [1.25, 1.27] (1.24–1.31) | 94% | 1.1e-07 | 100.0% |
| NumPy (MKL), f32 | `numpy_packed@t1+mkl` | — | — | not run | | | |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 2.67 [2.64, 2.70] (2.59–2.75) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 1.71 [1.71, 1.72] (1.67–2.14) | 100% | 1.7e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.63 [1.63, 1.64] (1.59–1.69) | 100% | 2.0e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.15 [0.15, 0.15] (0.14–0.16) | 0% | 9.0e-02 | 94.5% |

### Intel — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 0.83 [0.83, 0.83] (0.83–0.84) | 1% | 1.1e-07 | 100.0% |
| NumPy (MKL), f32 | `numpy_packed@t1+mkl` | — | — | not run | | | |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 0.85 [0.85, 0.85] (0.85–0.85) | 7% | 1.1e-07 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 6230 | 623 | 1.56 [1.55, 1.56] (1.56–1.59) | 100% | 3.2e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 1.37 [1.37, 1.37] (1.37–1.37) | 100% | 3.2e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.12 [0.12, 0.12] (0.12–0.12) | 0% | 2.1e-01 | 57.8% |

### AMD — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.08 [1.06, 1.10] (1.05–1.08) | 69% | 1.0e-07 | 99.9% |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2004 | 11 | 5.80 [5.73, 5.85] (5.67–5.80) | 100% | 9.5e-08 | 99.9% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 2.02 [1.91, 2.13] (1.98–2.02) | 100% | 1.0e-07 | 99.9% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 2.60 [2.57, 2.63] (2.51–2.61) | 100% | 1.6e-07 | 99.9% |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.45 [1.37, 1.51] (1.42–1.46) | 100% | 1.6e-07 | 99.9% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.48 [0.47, 0.48] (0.47–0.48) | 0% | 7.8e-02 | 86.2% |

### AMD — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 1.06 [1.05, 1.07] (1.05–1.15) | 55% | 1.1e-07 | 100.0% |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2378 | 2378 | 5.32 [5.31, 5.34] (5.27–5.87) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 3.08 [3.06, 3.11] (3.05–3.38) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 2.46 [2.45, 2.47] (2.43–2.69) | 100% | 1.7e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.56 [1.55, 1.56] (1.54–1.72) | 100% | 2.0e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.45 [0.45, 0.45] (0.45–0.49) | 0% | 9.0e-02 | 94.5% |

### AMD — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 0.77 [0.77, 0.77] (0.77–0.77) | 1% | 1.1e-07 | 100.0% |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 6230 | 623 | 5.41 [5.40, 5.42] (5.42–5.45) | 100% | 9.5e-08 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 1.42 [1.42, 1.43] (1.43–1.43) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 6230 | 623 | 2.87 [2.86, 2.87] (2.88–2.89) | 100% | 3.2e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 1.69 [1.68, 1.69] (1.69–1.70) | 100% | 3.2e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.55 [0.55, 0.55] (0.55–0.56) | 0% | 2.1e-01 | 57.8% |

### Graviton4 — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.16 [1.16, 1.16] (1.16–1.16) | 100% | 1.0e-07 | 99.9% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 1.54 [1.29, 1.81] (1.54–1.55) | 82% | 1.0e-07 | 99.9% |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.12 [1.10, 1.13] (1.11–1.12) | 94% | 1.6e-07 | 99.9% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.29 [0.29, 0.30] (0.30–0.30) | 0% | 7.8e-02 | 86.2% |

### Graviton4 — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 1.17 [1.17, 1.17] (1.17–1.17) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 2.86 [2.82, 2.91] (2.84–2.89) | 99% | 1.1e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.18 [1.17, 1.18] (1.17–1.18) | 99% | 2.0e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.31 [0.31, 0.31] (0.31–0.31) | 0% | 9.0e-02 | 94.5% |

### Graviton4 — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 1.29 [1.29, 1.29] (1.29–1.29) | 100% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 0.83 [0.83, 0.84] (0.83–0.83) | 19% | 1.1e-07 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 0.98 [0.98, 0.98] (0.98–0.98) | 16% | 3.2e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.32 [0.32, 0.32] (0.32–0.32) | 0% | 2.1e-01 | 57.8% |

### M3 Max — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 0.24 [0.23, 0.25] (0.24–0.25) | 0% | 1.0e-07 | 99.9% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 0.51 [0.47, 0.55] (0.51–0.51) | 2% | 1.0e-07 | 99.9% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 0.77 [0.75, 0.80] (0.77–0.78) | 9% | 4.1e-02 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.25 [1.24, 1.27] (1.25–1.54) | 100% | 1.6e-07 | 99.9% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.30 [0.29, 0.30] (0.29–0.32) | 0% | 7.8e-02 | 86.2% |

### M3 Max — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 0.28 [0.28, 0.28] (0.28–0.28) | 0% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 0.91 [0.90, 0.92] (0.90–0.91) | 39% | 1.1e-07 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 0.95 [0.94, 0.96] (0.94–0.95) | 41% | 3.4e-02 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.34 [1.34, 1.35] (1.33–1.34) | 100% | 2.0e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.31 [0.31, 0.32] (0.31–0.32) | 0% | 9.0e-02 | 94.5% |

### M3 Max — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 0.16 [0.16, 0.16] (0.16–0.16) | 0% | 1.1e-07 | 100.0% |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 0.31 [0.31, 0.31] (0.31–0.31) | 0% | 1.1e-07 | 100.0% |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 6230 | 623 | 0.50 [0.50, 0.50] (0.50–0.50) | 0% | 7.6e-02 | 100.0% |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 1.06 [1.06, 1.06] (1.06–1.07) | 100% | 3.2e-07 | 100.0% |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.26 [0.26, 0.26] (0.26–0.27) | 0% | 2.1e-01 | 57.8% |

## int4

### Intel — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 20.82 [20.24, 21.28] (20.53–21.01) | 100% | 1.0e-07 | 99.9% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2004 | 11 | 25.15 [24.53, 25.54] (25.01–25.36) | 100% | 1.6e-07 | 99.9% |

### Intel — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 19.36 [19.22, 19.51] (19.12–19.61) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2378 | 2378 | 23.30 [23.13, 23.48] (22.98–23.74) | 100% | 1.7e-07 | 100.0% |

### Intel — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 12.69 [12.64, 12.73] (12.58–12.66) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 6230 | 623 | 13.17 [13.14, 13.20] (13.07–13.16) | 100% | 3.2e-07 | 100.0% |

### AMD — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 34.69 [33.45, 35.66] (34.22–35.26) | 100% | 1.0e-07 | 99.9% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2004 | 11 | 37.60 [36.34, 38.63] (36.98–37.73) | 100% | 1.6e-07 | 99.9% |

### AMD — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 30.60 [30.44, 30.77] (30.03–31.11) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2378 | 2378 | 32.64 [32.46, 32.82] (31.87–32.85) | 100% | 1.7e-07 | 100.0% |

### AMD — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 22.65 [22.50, 22.79] (20.95–21.48) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 6230 | 623 | 22.11 [21.97, 22.24] (20.45–20.95) | 100% | 3.2e-07 | 100.0% |

### Graviton4 — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 22.10 [21.73, 22.33] (21.83–22.03) | 100% | 1.0e-07 | 99.9% |

### Graviton4 — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 21.47 [21.33, 21.62] (21.31–21.57) | 100% | 1.1e-07 | 100.0% |

### Graviton4 — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 14.20 [14.16, 14.25] (14.12–14.15) | 100% | 1.1e-07 | 100.0% |

### M3 Max — agent-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 18.12 [16.17, 20.18] (12.21–20.86) | 100% | 1.0e-07 | 99.9% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2004 | 11 | 26.87 [24.13, 29.53] (20.80–30.68) | 100% | 4.1e-02 | 100.0% |

### M3 Max — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 19.97 [19.81, 20.13] (19.48–20.05) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2378 | 2378 | 39.23 [38.89, 39.58] (38.12–39.32) | 100% | 3.4e-02 | 100.0% |

### M3 Max — beir
| config | arm | calls | clusters | ratio [CI] (spread) | sweet faster on | max err | top-1 = S |
|---|---|--:|--:|--:|--:|--:|--:|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 12.44 [12.42, 12.46] (11.93–12.38) | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 6230 | 623 | 18.90 [18.86, 18.94] (18.17–18.82) | 100% | 7.6e-02 | 100.0% |

## pool-parked (5 ms busy gap before each call)

### Intel — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.03 [1.02, 1.04] (1.02–1.04) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 0.62 [0.61, 0.63] (0.62–0.64) |
| NumPy, f32 | `numpy_packed@t8` | 2004 | 0.61 [0.58, 0.64] (0.62–0.62) |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | not run |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2004 | 1.69 [1.61, 1.77] (1.66–1.74) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 1.65 [1.55, 1.75] (1.65–1.69) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 2.22 [2.17, 2.29] (2.23–2.27) |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 2.50 [2.39, 2.58] (2.50–2.55) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 1.12 [0.99, 1.24] (1.01–1.18) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 0.86 [0.77, 0.97] (0.78–0.96) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 1.07 [0.97, 1.16] (0.91–1.08) |

### Intel — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.01 [1.00, 1.02] (1.00–1.04) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 0.63 [0.62, 0.63] (0.62–0.63) |
| NumPy, f32 | `numpy_packed@t8` | 2378 | 0.50 [0.50, 0.50] (0.49–0.51) |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | not run |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2378 | 2.10 [2.08, 2.12] (2.07–2.13) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2.15 [2.13, 2.18] (2.13–2.18) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2.47 [2.46, 2.49] (2.42–2.49) |
| NextPlaid, f32 | `nextplaid` | 2378 | 2.01 [1.99, 2.02] (1.98–2.02) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 1.35 [1.33, 1.37] (1.16–1.28) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 0.21 [0.21, 0.21] (0.21–0.22) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 1.27 [1.24, 1.29] (1.09–1.25) |

### Intel — beir (8 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2492 | 1.03 [1.03, 1.03] (1.03–1.04) |
| sweet, production path + prewarm | `node-prewarm` | 2492 | 0.70 [0.70, 0.70] (0.70–0.71) |
| NumPy, f32 | `numpy_packed` | 2492 | 0.91 [0.91, 0.92] (0.92–0.92) |
| NumPy (MKL), f32 | `numpy_packed+mkl` | — | not run |
| PyTorch, f32 | `torch_colbert_packed` | 2492 | 1.18 [1.18, 1.19] (1.23–1.25) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2492 | 1.12 [1.12, 1.12] (1.13–1.13) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2492 | 1.70 [1.70, 1.71] (1.69–1.70) |
| NextPlaid, f32 | `nextplaid@t8` | 2492 | 4.35 [4.34, 4.36] (4.38–4.48) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2492 | 0.78 [0.77, 0.79] (0.73–0.79) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2492 | 0.80 [0.79, 0.80] (0.71–0.80) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2492 | 0.82 [0.81, 0.82] (0.77–0.82) |

### AMD — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.11 [1.09, 1.12] (1.07–1.14) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 0.88 [0.86, 0.90] (0.87–0.90) |
| NumPy, f32 | `numpy_packed` | 2004 | 1.59 [1.54, 1.64] (1.57–1.61) |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2004 | 16.38 [14.98, 17.70] (16.15–16.66) |
| PyTorch, f32 | `torch_pad_bmm` | 2004 | 1.50 [1.47, 1.55] (1.48–1.51) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 1.48 [1.42, 1.55] (1.45–1.51) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 2.38 [2.33, 2.44] (2.34–2.43) |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 4.20 [3.94, 4.41] (4.14–4.26) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 1.43 [1.38, 1.48] (1.42–1.46) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 1.44 [1.39, 1.50] (1.43–1.47) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 1.44 [1.39, 1.48] (1.41–1.48) |

### AMD — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.11 [1.11, 1.11] (1.08–1.13) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 0.91 [0.91, 0.91] (0.89–0.97) |
| NumPy, f32 | `numpy_packed_t` | 2378 | 1.34 [1.33, 1.35] (1.31–1.37) |
| NumPy (BLIS), f32 | `numpy_packed+blis` | 2378 | 11.16 [11.05, 11.29] (10.96–11.47) |
| PyTorch, f32 | `torch_pad_bmm` | 2378 | 1.83 [1.82, 1.84] (1.80–1.89) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2378 | 1.84 [1.84, 1.85] (1.80–1.90) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2.63 [2.62, 2.64] (2.56–2.70) |
| NextPlaid, f32 | `nextplaid` | 2378 | 3.23 [3.19, 3.28] (3.23–3.35) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 1.78 [1.77, 1.79] (1.75–1.83) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 1.78 [1.77, 1.79] (1.75–1.83) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 1.78 [1.77, 1.79] (1.73–1.87) |

### AMD — beir (8 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2492 | 1.17 [1.16, 1.17] (1.15–1.18) |
| sweet, production path + prewarm | `node-prewarm` | 2492 | 0.90 [0.89, 0.90] (0.90–0.91) |
| NumPy, f32 | `numpy_packed` | 2492 | 2.06 [2.05, 2.07] (2.05–2.10) |
| NumPy (BLIS), f32 | `numpy_packed+blis` | 2492 | 25.24 [25.11, 25.37] (24.95–25.67) |
| PyTorch, f32 | `torch_pad_bmm` | 2492 | 1.27 [1.27, 1.28] (1.26–1.30) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2492 | 1.18 [1.18, 1.19] (1.16–1.20) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2492 | 2.07 [2.06, 2.08] (2.05–2.12) |
| NextPlaid, f32 | `nextplaid@t1` | 2492 | 7.82 [7.78, 7.85] (7.75–7.93) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2492 | 1.12 [1.11, 1.12] (1.10–1.13) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2492 | 1.13 [1.13, 1.13] (1.12–1.15) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2492 | 1.15 [1.14, 1.15] (1.13–1.19) |

### Graviton4 — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.16 [1.15, 1.17] (1.15–1.17) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 1.02 [1.01, 1.02] (1.01–1.02) |
| NumPy, f32 | `numpy_packed` | 2004 | 0.94 [0.91, 0.97] (0.94–0.95) |
| PyTorch, f32 | `torch_pad_flat` | 2004 | 2.26 [2.18, 2.33] (2.24–2.26) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 2.61 [2.46, 2.75] (2.58–2.64) |
| NextPlaid, f32 | `nextplaid` | 2004 | 1.68 [1.65, 1.71] (1.67–1.70) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 0.97 [0.93, 1.01] (0.96–0.98) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 0.98 [0.93, 1.02] (0.97–0.99) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 0.98 [0.94, 1.03] (0.98–1.00) |

### Graviton4 — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.19 [1.19, 1.19] (1.18–1.20) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 1.00 [1.00, 1.00] (0.99–1.01) |
| NumPy, f32 | `numpy_packed` | 2378 | 0.82 [0.82, 0.83] (0.82–0.83) |
| PyTorch, f32 | `torch_pad_flat` | 2378 | 2.65 [2.64, 2.66] (2.63–2.66) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2.90 [2.89, 2.91] (2.87–2.92) |
| NextPlaid, f32 | `nextplaid` | 2378 | 1.76 [1.76, 1.77] (1.75–1.78) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 1.15 [1.14, 1.15] (1.14–1.17) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 1.16 [1.16, 1.17] (1.16–1.18) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 1.17 [1.16, 1.17] (1.16–1.18) |

### Graviton4 — beir (8 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2492 | 1.12 [1.12, 1.13] (1.12–1.13) |
| sweet, production path + prewarm | `node-prewarm` | 2492 | 1.04 [1.04, 1.04] (1.04–1.05) |
| NumPy, f32 | `numpy_packed` | 2492 | 1.28 [1.28, 1.28] (1.28–1.29) |
| PyTorch, f32 | `torch_pad_flat` | 2492 | 1.62 [1.61, 1.62] (1.62–1.63) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2492 | 1.29 [1.28, 1.29] (1.29–1.30) |
| NextPlaid, f32 | `nextplaid` | 2492 | 1.33 [1.33, 1.34] (1.34–1.35) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2492 | 0.66 [0.66, 0.66] (0.66–0.66) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2492 | 0.67 [0.67, 0.67] (0.68–0.68) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2492 | 0.69 [0.69, 0.69] (0.69–0.69) |

### M3 Max — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.03 [1.03, 1.04] (1.03–1.04) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 0.69 [0.69, 0.70] (0.69–0.71) |
| NumPy, f32 | `numpy_packed@t1` | 2004 | 0.92 [0.88, 0.97] (0.92–0.93) |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 1.95 [1.89, 2.01] (1.94–1.96) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2004 | 4.37 [4.21, 4.58] (4.23–4.27) |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 2.97 [2.82, 3.09] (2.92–2.97) |
| NextPlaid, f32 | `nextplaid` | 2004 | 2.44 [2.38, 2.51] (2.39–2.43) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 1.88 [1.78, 1.98] (1.85–1.88) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 1.88 [1.78, 1.98] (1.85–1.87) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 1.87 [1.78, 1.97] (1.84–1.87) |

### M3 Max — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.04 [1.04, 1.04] (1.04–1.05) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 0.69 [0.69, 0.70] (0.69–0.73) |
| NumPy, f32 | `numpy_packed@t1` | 2378 | 0.74 [0.73, 0.74] (0.73–0.74) |
| PyTorch, f32 | `torch_segment_reduce` | 2378 | 1.92 [1.91, 1.93] (1.90–1.92) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 4.83 [4.81, 4.85] (4.63–4.66) |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2.70 [2.68, 2.71] (2.64–2.67) |
| NextPlaid, f32 | `nextplaid` | 2378 | 3.10 [3.07, 3.12] (3.03–3.07) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2.86 [2.84, 2.89] (2.81–2.83) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 0.88 [0.87, 0.89] (0.88–0.88) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2.88 [2.85, 2.90] (2.81–2.83) |

## replica host-to-host

| platform | set | config | ratio shard host | ratio replica host | relative difference |
|---|---|---|--:|--:|--:|
| Intel | agent-ho | sweet, production path (Node) | 1.082 | 1.100 | +1.6% |
| Intel | agent-ho | previous production path | 5.138 | 5.210 | +1.4% |
| Intel | agent-ho | NumPy, f32 | 1.687 | 1.713 | +1.6% |
| Intel | agent-ho | PyTorch, f32 | 1.389 | 1.403 | +1.0% |
| Intel | agent-ho | PyTorch, bf16 | 1.317 | 1.330 | +1.0% |
| Intel | agent-ho | maxsim-cpu, f32 | 2.332 | 2.321 | -0.5% |
| Intel | agent-ho | NextPlaid, f32 | 6.866 | 6.958 | +1.3% |
| Intel | agent-ho | NumKong (approx.), bf16 | 0.700 | 0.696 | -0.5% |
| Intel | agent-ho | NumKong (approx.), f16 | 0.617 | 0.618 | +0.2% |
| Intel | agent-ho | NumKong (approx.), f32 | 0.636 | 0.633 | -0.4% |
| Intel | agent-ho | sweet kernel p50 ms (shard / replica) | 0.0690 | 0.0677 | -1.8% (geomean) |
| Intel | gcsn-ho | sweet, production path (Node) | 1.147 | 1.142 | -0.5% |
| Intel | gcsn-ho | previous production path | 6.517 | 6.331 | -2.8% |
| Intel | gcsn-ho | NumPy, f32 | 1.818 | 1.780 | -2.1% |
| Intel | gcsn-ho | PyTorch, f32 | 2.006 | 1.966 | -2.0% |
| Intel | gcsn-ho | PyTorch, bf16 | 2.159 | 2.093 | -3.1% |
| Intel | gcsn-ho | maxsim-cpu, f32 | 2.699 | 2.610 | -3.3% |
| Intel | gcsn-ho | NextPlaid, f32 | 6.507 | 6.048 | -7.0% |
| Intel | gcsn-ho | NumKong (approx.), bf16 | 0.884 | 0.876 | -0.9% |
| Intel | gcsn-ho | NumKong (approx.), f16 | 0.723 | 0.713 | -1.4% |
| Intel | gcsn-ho | NumKong (approx.), f32 | 0.897 | 0.882 | -1.7% |
| Intel | gcsn-ho | sweet kernel p50 ms (shard / replica) | 0.0342 | 0.0351 | +2.7% (geomean) |
| AMD | agent-ho | sweet, production path (Node) | 1.174 | 1.187 | +1.1% |
| AMD | agent-ho | previous production path | 6.281 | 6.280 | -0.0% |
| AMD | agent-ho | NumPy, f32 | 4.464 | 4.460 | -0.1% |
| AMD | agent-ho | NumPy (BLIS), f32 | 48.145 | 48.555 | +0.9% |
| AMD | agent-ho | PyTorch, f32 | 3.281 | 3.328 | +1.4% |
| AMD | agent-ho | PyTorch, bf16 | 3.104 | 3.136 | +1.0% |
| AMD | agent-ho | maxsim-cpu, f32 | 4.129 | 4.204 | +1.8% |
| AMD | agent-ho | NextPlaid, f32 | 12.039 | 12.139 | +0.8% |
| AMD | agent-ho | NumKong (approx.), bf16 | 1.877 | 1.800 | -4.1% |
| AMD | agent-ho | NumKong (approx.), f16 | 1.852 | 1.745 | -5.8% |
| AMD | agent-ho | NumKong (approx.), f32 | 1.735 | 1.652 | -4.8% |
| AMD | agent-ho | sweet kernel p50 ms (shard / replica) | 0.0266 | 0.0262 | -0.7% (geomean) |
| AMD | gcsn-ho | sweet, production path (Node) | 1.231 | 1.243 | +1.0% |
| AMD | gcsn-ho | previous production path | 7.099 | 7.175 | +1.1% |
| AMD | gcsn-ho | NumPy, f32 | 4.302 | 4.295 | -0.2% |
| AMD | gcsn-ho | NumPy (BLIS), f32 | 36.799 | 36.921 | +0.3% |
| AMD | gcsn-ho | PyTorch, f32 | 4.500 | 4.516 | +0.3% |
| AMD | gcsn-ho | PyTorch, bf16 | 4.252 | 4.260 | +0.2% |
| AMD | gcsn-ho | maxsim-cpu, f32 | 4.532 | 4.562 | +0.7% |
| AMD | gcsn-ho | NextPlaid, f32 | 9.321 | 10.546 | +13.1% |
| AMD | gcsn-ho | NumKong (approx.), bf16 | 1.527 | 1.539 | +0.8% |
| AMD | gcsn-ho | NumKong (approx.), f16 | 1.486 | 1.518 | +2.1% |
| AMD | gcsn-ho | NumKong (approx.), f32 | 1.405 | 1.415 | +0.7% |
| AMD | gcsn-ho | sweet kernel p50 ms (shard / replica) | 0.0161 | 0.0161 | -0.1% (geomean) |
| Graviton4 | agent-ho | sweet, production path (Node) | 1.150 | 1.154 | +0.3% |
| Graviton4 | agent-ho | previous production path | 3.584 | 3.553 | -0.9% |
| Graviton4 | agent-ho | NumPy, f32 | 1.653 | 1.658 | +0.3% |
| Graviton4 | agent-ho | PyTorch, f32 | 3.023 | 3.086 | +2.1% |
| Graviton4 | agent-ho | PyTorch, bf16 | 3.623 | 3.732 | +3.0% |
| Graviton4 | agent-ho | NextPlaid, f32 | 2.707 | 2.699 | -0.3% |
| Graviton4 | agent-ho | NumKong (approx.), bf16 | 0.821 | 0.814 | -0.9% |
| Graviton4 | agent-ho | NumKong (approx.), f16 | 0.854 | 0.833 | -2.5% |
| Graviton4 | agent-ho | NumKong (approx.), f32 | 0.859 | 0.853 | -0.7% |
| Graviton4 | agent-ho | sweet kernel p50 ms (shard / replica) | 0.0544 | 0.0543 | -0.4% (geomean) |
| Graviton4 | gcsn-ho | sweet, production path (Node) | 1.219 | 1.208 | -0.9% |
| Graviton4 | gcsn-ho | previous production path | 5.390 | 5.405 | +0.3% |
| Graviton4 | gcsn-ho | NumPy, f32 | 1.840 | 1.833 | -0.4% |
| Graviton4 | gcsn-ho | PyTorch, f32 | 4.608 | 4.651 | +0.9% |
| Graviton4 | gcsn-ho | PyTorch, bf16 | 5.194 | 5.300 | +2.0% |
| Graviton4 | gcsn-ho | NextPlaid, f32 | 3.226 | 3.289 | +2.0% |
| Graviton4 | gcsn-ho | NumKong (approx.), bf16 | 0.902 | 0.902 | +0.0% |
| Graviton4 | gcsn-ho | NumKong (approx.), f16 | 0.937 | 0.929 | -0.9% |
| Graviton4 | gcsn-ho | NumKong (approx.), f32 | 0.946 | 0.942 | -0.4% |
| Graviton4 | gcsn-ho | sweet kernel p50 ms (shard / replica) | 0.0279 | 0.0276 | -1.0% (geomean) |

## losses: 799 (platform, mode, set or cell, configuration) cases with ratio < 1

| platform | mode | where | config | ratio [CI] (spread) | CI below 1 |
|---|---|---|---|--:|---|
| AMD | one thread | agent-ho | NumKong (approx.), f16 | 0.48 [0.47, 0.48] (0.47–0.48) | yes |
| AMD | one thread | beir | NumKong (approx.), f16 | 0.55 [0.55, 0.55] (0.55–0.56) | yes |
| AMD | one thread | beir | NumPy, f32 | 0.77 [0.77, 0.77] (0.77–0.77) | yes |
| AMD | one thread | gcsn-ho | NumKong (approx.), f16 | 0.45 [0.45, 0.45] (0.45–0.49) | yes |
| AMD | warm sweep | q32-d1024-len128 | NumKong (approx.), bf16 | 0.39 [0.36, 0.43] (0.37–0.43) | yes |
| AMD | warm sweep | q32-d1024-len128 | NumKong (approx.), f16 | 0.40 [0.37, 0.45] (0.38–0.42) | yes |
| AMD | warm sweep | q32-d1024-len128 | NumKong (approx.), f32 | 0.44 [0.41, 0.48] (0.40–0.48) | yes |
| AMD | warm sweep | q32-d1024-len128 | PyTorch, bf16 | 0.61 [0.53, 0.68] (0.57–0.66) | yes |
| AMD | warm sweep | q32-d1024-len128 | PyTorch, f32 | 0.95 [0.83, 1.07] (0.88–1.02) | no |
| AMD | warm sweep | q32-d1024-len32 | NumKong (approx.), bf16 | 0.42 [0.39, 0.47] (0.35–0.47) | yes |
| AMD | warm sweep | q32-d1024-len32 | NumKong (approx.), f16 | 0.44 [0.40, 0.49] (0.39–0.45) | yes |
| AMD | warm sweep | q32-d1024-len32 | NumKong (approx.), f32 | 0.50 [0.45, 0.56] (0.43–0.55) | yes |
| AMD | warm sweep | q32-d1024-len32 | PyTorch, f32 | 0.81 [0.72, 0.89] (0.69–0.87) | yes |
| AMD | warm sweep | q32-d1024-len32 | NextPlaid, f32 | 0.95 [0.85, 1.07] (0.83–0.98) | no |
| AMD | warm sweep | q32-d1024-len512 | NumKong (approx.), f16 | 0.60 [0.58, 0.64] (0.58–0.62) | yes |
| AMD | warm sweep | q32-d1024-len512 | NumKong (approx.), bf16 | 0.61 [0.58, 0.65] (0.58–0.62) | yes |
| AMD | warm sweep | q32-d1024-len512 | NumKong (approx.), f32 | 0.64 [0.61, 0.69] (0.61–0.65) | yes |
| AMD | warm sweep | q32-d1024-lennat | NumKong (approx.), bf16 | 0.57 [0.54, 0.62] (0.53–0.59) | yes |
| AMD | warm sweep | q32-d1024-lennat | NumKong (approx.), f16 | 0.59 [0.55, 0.64] (0.54–0.61) | yes |
| AMD | warm sweep | q32-d1024-lennat | NumKong (approx.), f32 | 0.63 [0.58, 0.68] (0.58–0.65) | yes |
| AMD | warm sweep | q32-d16-len128 | NumKong (approx.), bf16 | 0.87 [0.79, 0.98] (0.72–0.85) | yes |
| AMD | warm sweep | q32-d16-len128 | NumKong (approx.), f16 | 0.93 [0.83, 1.05] (0.74–0.86) | no |
| AMD | warm sweep | q32-d16-len128 | NumKong (approx.), f32 | 0.97 [0.86, 1.09] (0.74–0.91) | no |
| AMD | warm sweep | q32-d16-len512 | NumKong (approx.), f32 | 0.86 [0.78, 0.96] (0.61–0.73) | yes |
| AMD | warm sweep | q32-d16-len512 | NumKong (approx.), f16 | 0.91 [0.84, 0.99] (0.60–0.79) | yes |
| AMD | warm sweep | q32-d16-len512 | NumKong (approx.), bf16 | 0.93 [0.85, 1.02] (0.64–0.82) | no |
| AMD | warm sweep | q32-d256-len128 | NumKong (approx.), f16 | 0.37 [0.31, 0.43] (0.31–0.43) | yes |
| AMD | warm sweep | q32-d256-len128 | NumKong (approx.), bf16 | 0.37 [0.32, 0.43] (0.29–0.40) | yes |
| AMD | warm sweep | q32-d256-len128 | NumKong (approx.), f32 | 0.39 [0.33, 0.45] (0.32–0.41) | yes |
| AMD | warm sweep | q32-d256-len128 | PyTorch, bf16 | 0.57 [0.47, 0.68] (0.47–0.56) | yes |
| AMD | warm sweep | q32-d256-len128 | PyTorch, f32 | 0.65 [0.53, 0.78] (0.55–0.64) | yes |
| AMD | warm sweep | q32-d256-len32 | NumKong (approx.), f32 | 0.61 [0.54, 0.70] (0.58–0.63) | yes |
| AMD | warm sweep | q32-d256-len32 | NumKong (approx.), bf16 | 0.62 [0.53, 0.71] (0.54–0.63) | yes |
| AMD | warm sweep | q32-d256-len32 | NumKong (approx.), f16 | 0.62 [0.54, 0.71] (0.57–0.62) | yes |
| AMD | warm sweep | q32-d256-len32 | PyTorch, f32 | 0.78 [0.70, 0.86] (0.70–0.78) | yes |
| AMD | warm sweep | q32-d256-len32 | NextPlaid, f32 | 0.92 [0.83, 1.02] (0.82–0.95) | no |
| AMD | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.34 [0.30, 0.39] (0.34–0.39) | yes |
| AMD | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.35 [0.30, 0.40] (0.34–0.39) | yes |
| AMD | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.41 [0.34, 0.48] (0.39–0.45) | yes |
| AMD | warm sweep | q32-d256-len512 | PyTorch, bf16 | 0.59 [0.48, 0.69] (0.58–0.67) | yes |
| AMD | warm sweep | q32-d256-len512 | PyTorch, f32 | 0.87 [0.76, 1.00] (0.87–0.99) | yes |
| AMD | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.29 [0.27, 0.31] (0.26–0.34) | yes |
| AMD | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.30 [0.28, 0.32] (0.25–0.36) | yes |
| AMD | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.31 [0.28, 0.34] (0.27–0.37) | yes |
| AMD | warm sweep | q32-d256-lennat | PyTorch, bf16 | 0.90 [0.81, 1.00] (0.77–1.17) | no |
| AMD | warm sweep | q32-d4096-len128 | NumKong (approx.), bf16 | 0.66 [0.63, 0.69] (0.64–0.67) | yes |
| AMD | warm sweep | q32-d4096-len128 | NumKong (approx.), f16 | 0.68 [0.65, 0.71] (0.66–0.69) | yes |
| AMD | warm sweep | q32-d4096-len128 | NumKong (approx.), f32 | 0.72 [0.69, 0.76] (0.71–0.73) | yes |
| AMD | warm sweep | q32-d4096-len32 | NumKong (approx.), bf16 | 0.52 [0.49, 0.54] (0.51–0.56) | yes |
| AMD | warm sweep | q32-d4096-len32 | NumKong (approx.), f16 | 0.56 [0.53, 0.58] (0.55–0.60) | yes |
| AMD | warm sweep | q32-d4096-len32 | NumKong (approx.), f32 | 0.67 [0.64, 0.68] (0.65–0.69) | yes |
| AMD | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.55 [0.53, 0.57] (0.54–0.55) | yes |
| AMD | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.56 [0.54, 0.58] (0.55–0.56) | yes |
| AMD | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.58 [0.57, 0.61] (0.57–0.59) | yes |
| AMD | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.64 [0.61, 0.67] (0.62–0.65) | yes |
| AMD | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.66 [0.62, 0.69] (0.64–0.67) | yes |
| AMD | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.69 [0.65, 0.74] (0.67–0.70) | yes |
| AMD | warm sweep | q32-d64-len128 | NumKong (approx.), f16 | 0.43 [0.37, 0.51] (0.37–0.42) | yes |
| AMD | warm sweep | q32-d64-len128 | NumKong (approx.), bf16 | 0.44 [0.38, 0.52] (0.38–0.41) | yes |
| AMD | warm sweep | q32-d64-len128 | NumKong (approx.), f32 | 0.45 [0.39, 0.53] (0.37–0.43) | yes |
| AMD | warm sweep | q32-d64-len128 | PyTorch, f32 | 0.71 [0.64, 0.80] (0.59–0.64) | yes |
| AMD | warm sweep | q32-d64-len128 | PyTorch, bf16 | 0.85 [0.76, 0.96] (0.71–0.75) | yes |
| AMD | warm sweep | q32-d64-len32 | NumKong (approx.), bf16 | 0.46 [0.42, 0.51] (0.42–0.51) | yes |
| AMD | warm sweep | q32-d64-len32 | NumKong (approx.), f16 | 0.48 [0.43, 0.54] (0.39–0.54) | yes |
| AMD | warm sweep | q32-d64-len32 | NumKong (approx.), f32 | 0.53 [0.47, 0.60] (0.45–0.64) | yes |
| AMD | warm sweep | q32-d64-len32 | PyTorch, f32 | 0.67 [0.64, 0.71] (0.57–0.71) | yes |
| AMD | warm sweep | q32-d64-len32 | NextPlaid, f32 | 0.90 [0.80, 1.02] (0.75–1.01) | no |
| AMD | warm sweep | q32-d64-len512 | NumKong (approx.), bf16 | 0.41 [0.36, 0.47] (0.31–0.45) | yes |
| AMD | warm sweep | q32-d64-len512 | NumKong (approx.), f16 | 0.45 [0.37, 0.58] (0.36–0.49) | yes |
| AMD | warm sweep | q32-d64-len512 | NumKong (approx.), f32 | 0.49 [0.36, 0.77] (0.38–0.48) | yes |
| AMD | warm sweep | q32-d64-len512 | PyTorch, bf16 | 0.55 [0.49, 0.61] (0.46–0.55) | yes |
| AMD | warm sweep | q32-d64-len512 | PyTorch, f32 | 0.62 [0.55, 0.69] (0.53–0.62) | yes |
| AMD | warm sweep | q32-d64-lennat | NumKong (approx.), bf16 | 0.42 [0.35, 0.52] (0.31–0.46) | yes |
| AMD | warm sweep | q32-d64-lennat | NumKong (approx.), f16 | 0.42 [0.35, 0.52] (0.38–0.47) | yes |
| AMD | warm sweep | q32-d64-lennat | NumKong (approx.), f32 | 0.42 [0.36, 0.52] (0.38–0.50) | yes |
| AMD | warm sweep | q32-d64-lennat | PyTorch, bf16 | 0.77 [0.69, 0.87] (0.61–0.86) | yes |
| AMD | warm sweep | q32-d64-lennat | PyTorch, f32 | 0.88 [0.79, 0.98] (0.70–0.95) | yes |
| AMD | warm sweep | q64-d1024-len128 | NumKong (approx.), bf16 | 0.44 [0.36, 0.50] (0.41–0.46) | yes |
| AMD | warm sweep | q64-d1024-len128 | NumKong (approx.), f16 | 0.45 [0.38, 0.52] (0.43–0.46) | yes |
| AMD | warm sweep | q64-d1024-len128 | NumKong (approx.), f32 | 0.49 [0.44, 0.54] (0.47–0.51) | yes |
| AMD | warm sweep | q64-d1024-len32 | NumKong (approx.), bf16 | 0.39 [0.37, 0.42] (0.35–0.43) | yes |
| AMD | warm sweep | q64-d1024-len32 | NumKong (approx.), f16 | 0.40 [0.37, 0.44] (0.37–0.48) | yes |
| AMD | warm sweep | q64-d1024-len32 | NumKong (approx.), f32 | 0.47 [0.43, 0.50] (0.43–0.54) | yes |
| AMD | warm sweep | q64-d1024-len32 | PyTorch, f32 | 0.80 [0.68, 0.91] (0.74–0.82) | yes |
| AMD | warm sweep | q64-d1024-len512 | NumKong (approx.), bf16 | 0.53 [0.52, 0.54] (0.52–0.55) | yes |
| AMD | warm sweep | q64-d1024-len512 | NumKong (approx.), f16 | 0.54 [0.53, 0.55] (0.53–0.54) | yes |
| AMD | warm sweep | q64-d1024-len512 | NumKong (approx.), f32 | 0.55 [0.54, 0.56] (0.54–0.56) | yes |
| AMD | warm sweep | q64-d1024-lennat | NumKong (approx.), bf16 | 0.57 [0.53, 0.61] (0.53–0.59) | yes |
| AMD | warm sweep | q64-d1024-lennat | NumKong (approx.), f16 | 0.58 [0.54, 0.63] (0.56–0.60) | yes |
| AMD | warm sweep | q64-d1024-lennat | NumKong (approx.), f32 | 0.60 [0.55, 0.65] (0.55–0.63) | yes |
| AMD | warm sweep | q64-d16-len128 | NumKong (approx.), bf16 | 0.83 [0.74, 0.95] (0.66–0.82) | yes |
| AMD | warm sweep | q64-d16-len128 | NumKong (approx.), f32 | 0.85 [0.77, 0.96] (0.72–0.82) | yes |
| AMD | warm sweep | q64-d16-len128 | NumKong (approx.), f16 | 0.90 [0.80, 1.02] (0.78–0.90) | no |
| AMD | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.77 [0.69, 0.85] (0.57–0.67) | yes |
| AMD | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.84 [0.75, 0.94] (0.58–0.73) | yes |
| AMD | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.88 [0.78, 0.98] (0.61–0.79) | yes |
| AMD | warm sweep | q64-d16-len512 | PyTorch, bf16 | 0.91 [0.82, 1.00] (0.65–0.82) | yes |
| AMD | warm sweep | q64-d256-len128 | NumKong (approx.), f16 | 0.30 [0.25, 0.35] (0.27–0.36) | yes |
| AMD | warm sweep | q64-d256-len128 | NumKong (approx.), bf16 | 0.31 [0.26, 0.36] (0.27–0.38) | yes |
| AMD | warm sweep | q64-d256-len128 | NumKong (approx.), f32 | 0.32 [0.27, 0.38] (0.29–0.40) | yes |
| AMD | warm sweep | q64-d256-len128 | PyTorch, bf16 | 0.39 [0.32, 0.48] (0.35–0.46) | yes |
| AMD | warm sweep | q64-d256-len128 | PyTorch, f32 | 0.57 [0.47, 0.70] (0.51–0.68) | yes |
| AMD | warm sweep | q64-d256-len32 | NumKong (approx.), bf16 | 0.51 [0.47, 0.55] (0.44–0.51) | yes |
| AMD | warm sweep | q64-d256-len32 | NumKong (approx.), f16 | 0.53 [0.49, 0.56] (0.47–0.51) | yes |
| AMD | warm sweep | q64-d256-len32 | NumKong (approx.), f32 | 0.56 [0.52, 0.60] (0.47–0.56) | yes |
| AMD | warm sweep | q64-d256-len32 | PyTorch, f32 | 0.81 [0.74, 0.87] (0.69–0.79) | yes |
| AMD | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.41 [0.34, 0.48] (0.37–0.44) | yes |
| AMD | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.41 [0.34, 0.48] (0.36–0.45) | yes |
| AMD | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.47 [0.43, 0.50] (0.43–0.49) | yes |
| AMD | warm sweep | q64-d256-len512 | PyTorch, bf16 | 0.57 [0.53, 0.62] (0.51–0.66) | yes |
| AMD | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.33 [0.26, 0.41] (0.30–0.37) | yes |
| AMD | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.33 [0.27, 0.42] (0.31–0.36) | yes |
| AMD | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.34 [0.28, 0.43] (0.30–0.37) | yes |
| AMD | warm sweep | q64-d256-lennat | PyTorch, bf16 | 0.83 [0.66, 1.06] (0.83–1.28) | no |
| AMD | warm sweep | q64-d4096-len128 | NumKong (approx.), bf16 | 0.60 [0.57, 0.63] (0.58–0.61) | yes |
| AMD | warm sweep | q64-d4096-len128 | NumKong (approx.), f16 | 0.61 [0.58, 0.64] (0.60–0.61) | yes |
| AMD | warm sweep | q64-d4096-len128 | NumKong (approx.), f32 | 0.65 [0.62, 0.69] (0.64–0.66) | yes |
| AMD | warm sweep | q64-d4096-len32 | NumKong (approx.), bf16 | 0.45 [0.42, 0.48] (0.44–0.46) | yes |
| AMD | warm sweep | q64-d4096-len32 | NumKong (approx.), f16 | 0.48 [0.46, 0.51] (0.46–0.50) | yes |
| AMD | warm sweep | q64-d4096-len32 | NumKong (approx.), f32 | 0.58 [0.56, 0.61] (0.56–0.62) | yes |
| AMD | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.53 [0.51, 0.55] (0.52–0.54) | yes |
| AMD | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.53 [0.52, 0.55] (0.52–0.54) | yes |
| AMD | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.54 [0.53, 0.58] (0.53–0.56) | yes |
| AMD | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.57 [0.54, 0.60] (0.55–0.58) | yes |
| AMD | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.57 [0.55, 0.61] (0.56–0.58) | yes |
| AMD | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.60 [0.57, 0.63] (0.57–0.60) | yes |
| AMD | warm sweep | q64-d64-len128 | NumKong (approx.), bf16 | 0.47 [0.41, 0.54] (0.39–0.47) | yes |
| AMD | warm sweep | q64-d64-len128 | NumKong (approx.), f16 | 0.48 [0.41, 0.57] (0.39–0.53) | yes |
| AMD | warm sweep | q64-d64-len128 | NumKong (approx.), f32 | 0.48 [0.43, 0.55] (0.37–0.52) | yes |
| AMD | warm sweep | q64-d64-len128 | PyTorch, bf16 | 0.66 [0.58, 0.74] (0.51–0.66) | yes |
| AMD | warm sweep | q64-d64-len128 | PyTorch, f32 | 0.72 [0.64, 0.81] (0.56–0.72) | yes |
| AMD | warm sweep | q64-d64-len32 | NumKong (approx.), bf16 | 0.40 [0.35, 0.46] (0.39–0.43) | yes |
| AMD | warm sweep | q64-d64-len32 | NumKong (approx.), f16 | 0.41 [0.37, 0.47] (0.38–0.51) | yes |
| AMD | warm sweep | q64-d64-len32 | NumKong (approx.), f32 | 0.48 [0.42, 0.55] (0.46–0.51) | yes |
| AMD | warm sweep | q64-d64-len32 | PyTorch, f32 | 0.57 [0.53, 0.62] (0.53–0.58) | yes |
| AMD | warm sweep | q64-d64-len32 | PyTorch, bf16 | 0.74 [0.69, 0.80] (0.68–0.77) | yes |
| AMD | warm sweep | q64-d64-len512 | NumKong (approx.), bf16 | 0.37 [0.31, 0.45] (0.33–0.43) | yes |
| AMD | warm sweep | q64-d64-len512 | NumKong (approx.), f16 | 0.38 [0.33, 0.44] (0.33–0.45) | yes |
| AMD | warm sweep | q64-d64-len512 | PyTorch, bf16 | 0.44 [0.37, 0.54] (0.39–0.49) | yes |
| AMD | warm sweep | q64-d64-len512 | NumKong (approx.), f32 | 0.44 [0.36, 0.57] (0.39–0.52) | yes |
| AMD | warm sweep | q64-d64-len512 | PyTorch, f32 | 0.65 [0.54, 0.79] (0.56–0.72) | yes |
| AMD | warm sweep | q64-d64-lennat | NumKong (approx.), bf16 | 0.44 [0.36, 0.58] (0.41–0.44) | yes |
| AMD | warm sweep | q64-d64-lennat | NumKong (approx.), f16 | 0.46 [0.36, 0.65] (0.42–0.49) | yes |
| AMD | warm sweep | q64-d64-lennat | NumKong (approx.), f32 | 0.50 [0.37, 0.78] (0.44–0.49) | yes |
| AMD | warm sweep | q64-d64-lennat | PyTorch, bf16 | 0.63 [0.54, 0.73] (0.56–0.65) | yes |
| AMD | warm sweep | q64-d64-lennat | PyTorch, f32 | 0.99 [0.85, 1.17] (0.87–1.01) | no |
| AMD | warm sweep | q8-d1024-len128 | NumKong (approx.), f16 | 0.42 [0.33, 0.54] (0.39–0.47) | yes |
| AMD | warm sweep | q8-d1024-len128 | NumKong (approx.), f32 | 0.45 [0.35, 0.58] (0.41–0.51) | yes |
| AMD | warm sweep | q8-d1024-len128 | NumKong (approx.), bf16 | 0.48 [0.35, 0.65] (0.41–0.54) | yes |
| AMD | warm sweep | q8-d1024-len128 | PyTorch, bf16 | 0.71 [0.55, 0.91] (0.63–0.81) | yes |
| AMD | warm sweep | q8-d1024-len128 | PyTorch, f32 | 0.87 [0.67, 1.11] (0.82–0.95) | no |
| AMD | warm sweep | q8-d1024-len32 | NumKong (approx.), bf16 | 0.51 [0.40, 0.63] (0.36–0.53) | yes |
| AMD | warm sweep | q8-d1024-len32 | NumKong (approx.), f32 | 0.52 [0.44, 0.62] (0.40–0.58) | yes |
| AMD | warm sweep | q8-d1024-len32 | NumKong (approx.), f16 | 0.53 [0.42, 0.64] (0.37–0.59) | yes |
| AMD | warm sweep | q8-d1024-len32 | PyTorch, f32 | 0.59 [0.50, 0.67] (0.44–0.58) | yes |
| AMD | warm sweep | q8-d1024-len32 | NextPlaid, f32 | 0.79 [0.68, 0.90] (0.55–1.11) | yes |
| AMD | warm sweep | q8-d1024-len32 | PyTorch, bf16 | 0.96 [0.82, 1.10] (0.70–0.95) | no |
| AMD | warm sweep | q8-d1024-lennat | NumKong (approx.), bf16 | 0.80 [0.71, 0.88] (0.65–0.94) | yes |
| AMD | warm sweep | q8-d1024-lennat | NumKong (approx.), f16 | 0.83 [0.78, 0.89] (0.68–0.94) | yes |
| AMD | warm sweep | q8-d1024-lennat | NumKong (approx.), f32 | 0.85 [0.76, 0.93] (0.68–0.96) | yes |
| AMD | warm sweep | q8-d256-len128 | NumKong (approx.), f16 | 0.33 [0.28, 0.41] (0.31–0.43) | yes |
| AMD | warm sweep | q8-d256-len128 | NumKong (approx.), bf16 | 0.34 [0.28, 0.41] (0.29–0.38) | yes |
| AMD | warm sweep | q8-d256-len128 | NumKong (approx.), f32 | 0.36 [0.27, 0.52] (0.32–0.42) | yes |
| AMD | warm sweep | q8-d256-len128 | PyTorch, f32 | 0.48 [0.40, 0.58] (0.43–0.54) | yes |
| AMD | warm sweep | q8-d256-len128 | PyTorch, bf16 | 0.68 [0.60, 0.79] (0.62–0.86) | yes |
| AMD | warm sweep | q8-d256-len128 | NextPlaid, f32 | 0.78 [0.59, 1.13] (0.70–0.89) | no |
| AMD | warm sweep | q8-d256-len32 | NumKong (approx.), bf16 | 0.65 [0.57, 0.73] (0.60–0.70) | yes |
| AMD | warm sweep | q8-d256-len32 | NumKong (approx.), f16 | 0.65 [0.58, 0.73] (0.56–0.72) | yes |
| AMD | warm sweep | q8-d256-len32 | NumKong (approx.), f32 | 0.67 [0.61, 0.75] (0.63–0.69) | yes |
| AMD | warm sweep | q8-d256-len32 | PyTorch, f32 | 0.77 [0.68, 0.87] (0.65–0.80) | yes |
| AMD | warm sweep | q8-d256-len32 | NextPlaid, f32 | 0.93 [0.85, 1.02] (0.80–0.99) | no |
| AMD | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.39 [0.33, 0.45] (0.30–0.52) | yes |
| AMD | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.40 [0.31, 0.49] (0.31–0.47) | yes |
| AMD | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.40 [0.33, 0.47] (0.32–0.49) | yes |
| AMD | warm sweep | q8-d256-len512 | PyTorch, bf16 | 0.71 [0.58, 0.87] (0.57–0.86) | yes |
| AMD | warm sweep | q8-d256-len512 | PyTorch, f32 | 0.82 [0.67, 1.01] (0.67–1.02) | no |
| AMD | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.37 [0.28, 0.47] (0.29–0.49) | yes |
| AMD | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.38 [0.30, 0.51] (0.31–0.49) | yes |
| AMD | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.39 [0.30, 0.52] (0.31–0.52) | yes |
| AMD | warm sweep | q8-d4096-len32 | NumKong (approx.), f16 | 0.75 [0.70, 0.78] (0.65–0.77) | yes |
| AMD | warm sweep | q8-d4096-len32 | NumKong (approx.), bf16 | 0.80 [0.74, 0.86] (0.72–0.79) | yes |
| AMD | warm sweep | q8-d4096-len32 | NumKong (approx.), f32 | 0.91 [0.85, 0.99] (0.81–0.96) | yes |
| AMD | warm sweep | q8-d64-len128 | NumKong (approx.), f16 | 0.39 [0.37, 0.43] (0.37–0.49) | yes |
| AMD | warm sweep | q8-d64-len128 | NumKong (approx.), f32 | 0.40 [0.36, 0.45] (0.39–0.44) | yes |
| AMD | warm sweep | q8-d64-len128 | NumKong (approx.), bf16 | 0.41 [0.38, 0.44] (0.38–0.48) | yes |
| AMD | warm sweep | q8-d64-len128 | PyTorch, f32 | 0.61 [0.58, 0.65] (0.55–0.69) | yes |
| AMD | warm sweep | q8-d64-len128 | NextPlaid, f32 | 0.73 [0.65, 0.83] (0.67–0.99) | yes |
| AMD | warm sweep | q8-d64-len128 | PyTorch, bf16 | 0.89 [0.84, 0.94] (0.80–0.98) | yes |
| AMD | warm sweep | q8-d64-len32 | NumKong (approx.), f16 | 0.80 [0.75, 0.85] (0.68–0.86) | yes |
| AMD | warm sweep | q8-d64-len32 | NumKong (approx.), bf16 | 0.80 [0.75, 0.85] (0.65–0.88) | yes |
| AMD | warm sweep | q8-d64-len32 | NumKong (approx.), f32 | 0.83 [0.78, 0.88] (0.69–0.90) | yes |
| AMD | warm sweep | q8-d64-len32 | PyTorch, f32 | 0.88 [0.84, 0.92] (0.73–0.89) | yes |
| AMD | warm sweep | q8-d64-len512 | NumKong (approx.), f32 | 0.44 [0.36, 0.56] (0.36–0.56) | yes |
| AMD | warm sweep | q8-d64-len512 | NumKong (approx.), f16 | 0.45 [0.38, 0.54] (0.37–0.59) | yes |
| AMD | warm sweep | q8-d64-len512 | NumKong (approx.), bf16 | 0.45 [0.38, 0.54] (0.37–0.55) | yes |
| AMD | warm sweep | q8-d64-len512 | PyTorch, f32 | 0.66 [0.59, 0.73] (0.54–0.77) | yes |
| AMD | warm sweep | q8-d64-len512 | PyTorch, bf16 | 0.81 [0.68, 0.94] (0.67–0.95) | yes |
| AMD | warm sweep | q8-d64-lennat | NumKong (approx.), bf16 | 0.37 [0.33, 0.42] (0.38–0.46) | yes |
| AMD | warm sweep | q8-d64-lennat | NumKong (approx.), f16 | 0.38 [0.34, 0.43] (0.38–0.58) | yes |
| AMD | warm sweep | q8-d64-lennat | NumKong (approx.), f32 | 0.40 [0.34, 0.51] (0.36–0.52) | yes |
| AMD | warm sweep | q8-d64-lennat | PyTorch, f32 | 0.94 [0.88, 1.01] (0.81–1.04) | no |
| Graviton4 | one thread | agent-ho | NumKong (approx.), f16 | 0.29 [0.29, 0.30] (0.30–0.30) | yes |
| Graviton4 | one thread | beir | NumKong (approx.), f16 | 0.32 [0.32, 0.32] (0.32–0.32) | yes |
| Graviton4 | one thread | beir | PyTorch, f32 | 0.83 [0.83, 0.84] (0.83–0.83) | yes |
| Graviton4 | one thread | beir | NextPlaid, f32 | 0.98 [0.98, 0.98] (0.98–0.98) | yes |
| Graviton4 | one thread | gcsn-ho | NumKong (approx.), f16 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| Graviton4 | pool-parked | agent-ho | NumPy, f32 | 0.94 [0.91, 0.97] (0.94–0.95) | yes |
| Graviton4 | pool-parked | agent-ho | NumKong (approx.), bf16 | 0.97 [0.93, 1.01] (0.96–0.98) | no |
| Graviton4 | pool-parked | agent-ho | NumKong (approx.), f16 | 0.98 [0.93, 1.02] (0.97–0.99) | no |
| Graviton4 | pool-parked | agent-ho | NumKong (approx.), f32 | 0.98 [0.94, 1.03] (0.98–1.00) | no |
| Graviton4 | pool-parked | beir | NumKong (approx.), bf16 | 0.66 [0.66, 0.66] (0.66–0.66) | yes |
| Graviton4 | pool-parked | beir | NumKong (approx.), f16 | 0.67 [0.67, 0.67] (0.68–0.68) | yes |
| Graviton4 | pool-parked | beir | NumKong (approx.), f32 | 0.69 [0.69, 0.69] (0.69–0.69) | yes |
| Graviton4 | pool-parked | gcsn-ho | NumPy, f32 | 0.82 [0.82, 0.83] (0.82–0.83) | yes |
| Graviton4 | warm | agent-ho | NumKong (approx.), bf16 | 0.82 [0.74, 0.94] (0.81–0.83) | yes |
| Graviton4 | warm | agent-ho | NumKong (approx.), f16 | 0.85 [0.77, 0.98] (0.85–0.86) | yes |
| Graviton4 | warm | agent-ho | NumKong (approx.), f32 | 0.86 [0.78, 0.98] (0.85–0.86) | yes |
| Graviton4 | warm | beir | NumKong (approx.), bf16 | 0.55 [0.55, 0.55] (0.55–0.55) | yes |
| Graviton4 | warm | beir | NumKong (approx.), f16 | 0.58 [0.57, 0.58] (0.57–0.57) | yes |
| Graviton4 | warm | beir | NumKong (approx.), f32 | 0.60 [0.60, 0.60] (0.60–0.60) | yes |
| Graviton4 | warm | gcsn-ho | NumKong (approx.), bf16 | 0.90 [0.90, 0.91] (0.90–0.91) | yes |
| Graviton4 | warm | gcsn-ho | NumKong (approx.), f16 | 0.94 [0.93, 0.94] (0.94–0.95) | yes |
| Graviton4 | warm | gcsn-ho | NumKong (approx.), f32 | 0.95 [0.94, 0.95] (0.94–0.96) | yes |
| Graviton4 | warm sweep | q32-d1-len128 | NumPy, f32 | 0.97 [0.95, 0.99] (0.78–0.99) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | NumKong (approx.), bf16 | 0.36 [0.35, 0.36] (0.34–0.35) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.39] (0.37–0.39) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | NumKong (approx.), f32 | 0.43 [0.43, 0.44] (0.41–0.44) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | PyTorch, bf16 | 0.60 [0.59, 0.60] (0.59–0.64) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | NumKong (approx.), bf16 | 0.41 [0.39, 0.43] (0.40–0.41) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | NumKong (approx.), f16 | 0.49 [0.47, 0.51] (0.48–0.50) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | PyTorch, bf16 | 0.55 [0.53, 0.57] (0.54–0.55) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | NumKong (approx.), f32 | 0.60 [0.57, 0.62] (0.58–0.61) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | NumKong (approx.), bf16 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.36] (0.36–0.36) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | NumKong (approx.), f32 | 0.37 [0.36, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | PyTorch, bf16 | 0.55 [0.55, 0.55] (0.54–0.55) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | PyTorch, f32 | 0.88 [0.88, 0.88] (0.88–0.89) | yes |
| Graviton4 | warm sweep | q32-d1024-lennat | NumKong (approx.), bf16 | 0.37 [0.36, 0.37] (0.36–0.37) | yes |
| Graviton4 | warm sweep | q32-d1024-lennat | NumKong (approx.), f16 | 0.39 [0.39, 0.39] (0.39–0.39) | yes |
| Graviton4 | warm sweep | q32-d1024-lennat | NumKong (approx.), f32 | 0.41 [0.41, 0.41] (0.41–0.41) | yes |
| Graviton4 | warm sweep | q32-d16-len128 | NumKong (approx.), bf16 | 0.62 [0.59, 0.65] (0.44–0.63) | yes |
| Graviton4 | warm sweep | q32-d16-len128 | NumKong (approx.), f16 | 0.66 [0.63, 0.69] (0.48–0.68) | yes |
| Graviton4 | warm sweep | q32-d16-len128 | NumKong (approx.), f32 | 0.67 [0.64, 0.70] (0.47–0.72) | yes |
| Graviton4 | warm sweep | q32-d16-len32 | NumKong (approx.), bf16 | 0.91 [0.88, 0.94] (0.69–0.94) | yes |
| Graviton4 | warm sweep | q32-d16-len32 | NumKong (approx.), f16 | 0.99 [0.96, 1.02] (0.78–1.01) | no |
| Graviton4 | warm sweep | q32-d16-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.36] (0.29–0.39) | yes |
| Graviton4 | warm sweep | q32-d16-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.38] (0.30–0.40) | yes |
| Graviton4 | warm sweep | q32-d16-len512 | NumKong (approx.), f32 | 0.37 [0.36, 0.39] (0.31–0.41) | yes |
| Graviton4 | warm sweep | q32-d16-len512 | PyTorch, bf16 | 0.95 [0.93, 0.96] (0.78–1.01) | yes |
| Graviton4 | warm sweep | q32-d16-lennat | NumKong (approx.), f32 | 0.90 [0.85, 0.95] (0.66–0.98) | yes |
| Graviton4 | warm sweep | q32-d16-lennat | NumKong (approx.), bf16 | 0.91 [0.86, 0.97] (0.69–0.99) | yes |
| Graviton4 | warm sweep | q32-d16-lennat | NumKong (approx.), f16 | 0.99 [0.93, 1.06] (0.63–1.09) | no |
| Graviton4 | warm sweep | q32-d256-len128 | NumKong (approx.), bf16 | 0.39 [0.38, 0.39] (0.35–0.39) | yes |
| Graviton4 | warm sweep | q32-d256-len128 | NumKong (approx.), f16 | 0.42 [0.41, 0.42] (0.38–0.42) | yes |
| Graviton4 | warm sweep | q32-d256-len128 | NumKong (approx.), f32 | 0.44 [0.44, 0.45] (0.41–0.45) | yes |
| Graviton4 | warm sweep | q32-d256-len128 | PyTorch, bf16 | 0.58 [0.57, 0.58] (0.54–0.59) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | NumKong (approx.), bf16 | 0.46 [0.45, 0.47] (0.46–0.47) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | NumKong (approx.), f16 | 0.54 [0.53, 0.55] (0.54–0.55) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | NumKong (approx.), f32 | 0.66 [0.64, 0.67] (0.65–0.68) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | PyTorch, bf16 | 0.99 [0.97, 1.01] (0.97–1.01) | no |
| Graviton4 | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.31 [0.27, 0.34] (0.30–0.31) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.32 [0.28, 0.35] (0.31–0.32) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.33 [0.29, 0.36] (0.32–0.33) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | PyTorch, bf16 | 0.53 [0.47, 0.59] (0.52–0.54) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | NextPlaid, f32 | 0.96 [0.85, 1.07] (0.93–0.98) | no |
| Graviton4 | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.37 [0.36, 0.38] (0.35–0.38) | yes |
| Graviton4 | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.38 [0.38, 0.39] (0.35–0.39) | yes |
| Graviton4 | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.40 [0.39, 0.41] (0.37–0.41) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | NumKong (approx.), bf16 | 0.35 [0.35, 0.36] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.39] (0.38–0.39) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.41, 0.43] (0.42–0.42) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | PyTorch, bf16 | 0.55 [0.55, 0.55] (0.55–0.55) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | PyTorch, f32 | 0.87 [0.86, 0.88] (0.87–0.88) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | NumKong (approx.), bf16 | 0.41 [0.40, 0.41] (0.40–0.41) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | NumKong (approx.), f16 | 0.50 [0.49, 0.50] (0.49–0.50) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | PyTorch, bf16 | 0.55 [0.55, 0.55] (0.55–0.56) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | NumKong (approx.), f32 | 0.65 [0.64, 0.65] (0.64–0.65) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.33 [0.32, 0.33] (0.32–0.33) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | PyTorch, bf16 | 0.52 [0.52, 0.52] (0.51–0.52) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | PyTorch, f32 | 0.80 [0.79, 0.80] (0.79–0.81) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NextPlaid, f32 | 0.99 [0.99, 0.99] (0.99–1.01) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.33 [0.32, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.37 [0.36, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | PyTorch, f32 | 0.80 [0.80, 0.80] (0.80–0.80) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | PyTorch, bf16 | 0.98 [0.98, 0.99] (0.98–0.99) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | NextPlaid, f32 | 0.99 [0.99, 1.00] (0.99–0.99) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | NumKong (approx.), bf16 | 0.36 [0.35, 0.38] (0.34–0.40) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.41] (0.36–0.43) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | NumKong (approx.), f32 | 0.43 [0.41, 0.45] (0.40–0.46) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | PyTorch, bf16 | 0.89 [0.86, 0.92] (0.83–0.98) | yes |
| Graviton4 | warm sweep | q32-d64-len32 | NumKong (approx.), bf16 | 0.85 [0.84, 0.87] (0.74–0.89) | yes |
| Graviton4 | warm sweep | q32-d64-len32 | NumKong (approx.), f16 | 0.93 [0.92, 0.95] (0.82–0.95) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.37] (0.29–0.38) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.38] (0.31–0.38) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | NumKong (approx.), f32 | 0.38 [0.37, 0.40] (0.32–0.40) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | PyTorch, bf16 | 0.54 [0.52, 0.56] (0.46–0.57) | yes |
| Graviton4 | warm sweep | q32-d64-lennat | NumKong (approx.), bf16 | 0.46 [0.44, 0.48] (0.39–0.48) | yes |
| Graviton4 | warm sweep | q32-d64-lennat | NumKong (approx.), f16 | 0.50 [0.47, 0.52] (0.42–0.50) | yes |
| Graviton4 | warm sweep | q32-d64-lennat | NumKong (approx.), f32 | 0.51 [0.49, 0.53] (0.43–0.52) | yes |
| Graviton4 | warm sweep | q64-d1-len128 | NumPy, f32 | 0.84 [0.82, 0.85] (0.70–0.83) | yes |
| Graviton4 | warm sweep | q64-d1-len128 | NumKong (approx.), bf16 | 0.98 [0.95, 1.00] (0.84–1.03) | yes |
| Graviton4 | warm sweep | q64-d1-lennat | NumPy, f32 | 0.89 [0.81, 0.96] (0.78–0.86) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | NumKong (approx.), bf16 | 0.36 [0.36, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | NumKong (approx.), f16 | 0.39 [0.39, 0.39] (0.39–0.39) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | NumKong (approx.), f32 | 0.44 [0.44, 0.45] (0.44–0.45) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | PyTorch, bf16 | 0.51 [0.51, 0.51] (0.51–0.52) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | NumKong (approx.), bf16 | 0.39 [0.38, 0.39] (0.38–0.39) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | PyTorch, bf16 | 0.45 [0.45, 0.45] (0.44–0.46) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | NumKong (approx.), f16 | 0.48 [0.48, 0.48] (0.47–0.49) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | NumKong (approx.), f32 | 0.62 [0.62, 0.62] (0.61–0.62) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NumKong (approx.), bf16 | 0.34 [0.33, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NumKong (approx.), f16 | 0.35 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NumKong (approx.), f32 | 0.36 [0.36, 0.36] (0.36–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | PyTorch, bf16 | 0.46 [0.46, 0.46] (0.46–0.46) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | PyTorch, f32 | 0.96 [0.96, 0.97] (0.96–0.97) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NextPlaid, f32 | 0.97 [0.97, 0.98] (0.97–0.97) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | NumKong (approx.), bf16 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | NumKong (approx.), f16 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | NumKong (approx.), f32 | 0.40 [0.40, 0.40] (0.40–0.40) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | PyTorch, bf16 | 0.94 [0.93, 0.95] (0.94–0.94) | yes |
| Graviton4 | warm sweep | q64-d16-len128 | NumKong (approx.), bf16 | 0.46 [0.43, 0.48] (0.33–0.50) | yes |
| Graviton4 | warm sweep | q64-d16-len128 | NumKong (approx.), f16 | 0.49 [0.46, 0.52] (0.35–0.54) | yes |
| Graviton4 | warm sweep | q64-d16-len128 | NumKong (approx.), f32 | 0.51 [0.48, 0.53] (0.38–0.60) | yes |
| Graviton4 | warm sweep | q64-d16-len32 | NumKong (approx.), bf16 | 0.82 [0.78, 0.87] (0.53–0.87) | yes |
| Graviton4 | warm sweep | q64-d16-len32 | NumKong (approx.), f16 | 0.89 [0.85, 0.93] (0.58–0.94) | yes |
| Graviton4 | warm sweep | q64-d16-len32 | NumKong (approx.), f32 | 0.96 [0.92, 1.00] (0.65–1.04) | yes |
| Graviton4 | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.34 [0.32, 0.36] (0.29–0.35) | yes |
| Graviton4 | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.35 [0.33, 0.37] (0.31–0.36) | yes |
| Graviton4 | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.36 [0.34, 0.38] (0.32–0.36) | yes |
| Graviton4 | warm sweep | q64-d16-len512 | PyTorch, bf16 | 0.62 [0.59, 0.66] (0.54–0.63) | yes |
| Graviton4 | warm sweep | q64-d16-lennat | NumKong (approx.), bf16 | 0.83 [0.77, 0.89] (0.66–0.87) | yes |
| Graviton4 | warm sweep | q64-d16-lennat | NumKong (approx.), f16 | 0.87 [0.81, 0.93] (0.72–0.90) | yes |
| Graviton4 | warm sweep | q64-d16-lennat | NumKong (approx.), f32 | 0.87 [0.82, 0.93] (0.70–0.92) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | NumKong (approx.), bf16 | 0.35 [0.35, 0.36] (0.32–0.36) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | NumKong (approx.), f16 | 0.38 [0.37, 0.38] (0.34–0.38) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | NumKong (approx.), f32 | 0.41 [0.40, 0.41] (0.37–0.41) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | PyTorch, bf16 | 0.46 [0.45, 0.46] (0.41–0.49) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | NumKong (approx.), bf16 | 0.44 [0.43, 0.44] (0.43–0.45) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | NumKong (approx.), f16 | 0.53 [0.52, 0.54] (0.52–0.53) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | NumKong (approx.), f32 | 0.67 [0.66, 0.68] (0.66–0.68) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | PyTorch, bf16 | 0.69 [0.68, 0.70] (0.68–0.81) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.32 [0.28, 0.34] (0.31–0.32) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.33 [0.29, 0.35] (0.32–0.33) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.34 [0.30, 0.36] (0.33–0.34) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | PyTorch, bf16 | 0.45 [0.40, 0.48] (0.43–0.45) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NextPlaid, f32 | 0.96 [0.85, 1.03] (0.93–0.96) | no |
| Graviton4 | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.38 [0.38, 0.39] (0.35–0.39) | yes |
| Graviton4 | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.40 [0.40, 0.41] (0.36–0.41) | yes |
| Graviton4 | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.42 [0.42, 0.43] (0.38–0.43) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NumKong (approx.), bf16 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NumKong (approx.), f16 | 0.37 [0.37, 0.38] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.42, 0.42] (0.42–0.42) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | PyTorch, bf16 | 0.44 [0.44, 0.45] (0.44–0.45) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | PyTorch, f32 | 0.95 [0.94, 0.95] (0.94–0.96) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NextPlaid, f32 | 0.99 [0.99, 0.99] (0.99–0.99) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | NumKong (approx.), bf16 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | PyTorch, bf16 | 0.44 [0.44, 0.44] (0.44–0.45) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | NumKong (approx.), f16 | 0.47 [0.47, 0.47] (0.47–0.48) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | NumKong (approx.), f32 | 0.61 [0.61, 0.62] (0.61–0.62) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.33 [0.33, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.35 [0.34, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | PyTorch, bf16 | 0.44 [0.44, 0.44] (0.44–0.44) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | PyTorch, f32 | 0.92 [0.92, 0.93] (0.92–0.94) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NextPlaid, f32 | 0.96 [0.96, 0.97] (0.96–0.97) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.33 [0.33, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | PyTorch, bf16 | 0.85 [0.85, 0.86] (0.85–0.85) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | PyTorch, f32 | 0.92 [0.92, 0.93] (0.92–0.94) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NextPlaid, f32 | 0.97 [0.97, 0.97] (0.97–0.97) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | NumKong (approx.), bf16 | 0.38 [0.37, 0.39] (0.36–0.40) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | NumKong (approx.), f16 | 0.43 [0.41, 0.44] (0.40–0.44) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | NumKong (approx.), f32 | 0.45 [0.44, 0.47] (0.42–0.47) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | PyTorch, bf16 | 0.66 [0.64, 0.68] (0.64–0.69) | yes |
| Graviton4 | warm sweep | q64-d64-len32 | NumKong (approx.), bf16 | 0.63 [0.62, 0.65] (0.59–0.64) | yes |
| Graviton4 | warm sweep | q64-d64-len32 | NumKong (approx.), f16 | 0.73 [0.71, 0.74] (0.69–0.74) | yes |
| Graviton4 | warm sweep | q64-d64-len32 | NumKong (approx.), f32 | 0.84 [0.83, 0.86] (0.77–0.86) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.35] (0.31–0.35) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.36] (0.33–0.37) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | NumKong (approx.), f32 | 0.36 [0.36, 0.37] (0.33–0.37) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | PyTorch, bf16 | 0.46 [0.45, 0.48] (0.42–0.47) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | NumKong (approx.), bf16 | 0.43 [0.39, 0.46] (0.37–0.43) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | NumKong (approx.), f16 | 0.46 [0.41, 0.50] (0.39–0.46) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | NumKong (approx.), f32 | 0.47 [0.43, 0.52] (0.40–0.49) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | PyTorch, bf16 | 0.76 [0.67, 0.83] (0.65–0.77) | yes |
| Graviton4 | warm sweep | q8-d1024-len128 | NumKong (approx.), bf16 | 0.35 [0.34, 0.36] (0.33–0.37) | yes |
| Graviton4 | warm sweep | q8-d1024-len128 | NumKong (approx.), f16 | 0.37 [0.36, 0.37] (0.36–0.40) | yes |
| Graviton4 | warm sweep | q8-d1024-len128 | NumKong (approx.), f32 | 0.40 [0.40, 0.41] (0.40–0.42) | yes |
| Graviton4 | warm sweep | q8-d1024-len32 | NumKong (approx.), bf16 | 0.50 [0.49, 0.51] (0.50–0.52) | yes |
| Graviton4 | warm sweep | q8-d1024-len32 | NumKong (approx.), f16 | 0.55 [0.53, 0.56] (0.54–0.57) | yes |
| Graviton4 | warm sweep | q8-d1024-len32 | NumKong (approx.), f32 | 0.65 [0.64, 0.66] (0.65–0.70) | yes |
| Graviton4 | warm sweep | q8-d1024-len512 | NumKong (approx.), bf16 | 0.32 [0.32, 0.32] (0.32–0.32) | yes |
| Graviton4 | warm sweep | q8-d1024-len512 | NumKong (approx.), f16 | 0.34 [0.33, 0.34] (0.33–0.34) | yes |
| Graviton4 | warm sweep | q8-d1024-len512 | NumKong (approx.), f32 | 0.35 [0.34, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d1024-lennat | NumKong (approx.), bf16 | 0.35 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q8-d1024-lennat | NumKong (approx.), f16 | 0.37 [0.37, 0.37] (0.37–0.38) | yes |
| Graviton4 | warm sweep | q8-d1024-lennat | NumKong (approx.), f32 | 0.39 [0.39, 0.40] (0.39–0.40) | yes |
| Graviton4 | warm sweep | q8-d16-len128 | NumKong (approx.), bf16 | 0.91 [0.83, 0.98] (0.69–0.96) | yes |
| Graviton4 | warm sweep | q8-d16-len128 | NumKong (approx.), f16 | 0.92 [0.85, 0.99] (0.68–0.99) | yes |
| Graviton4 | warm sweep | q8-d16-len128 | NumKong (approx.), f32 | 0.92 [0.85, 0.99] (0.74–1.03) | yes |
| Graviton4 | warm sweep | q8-d16-len512 | NumKong (approx.), bf16 | 0.50 [0.48, 0.52] (0.39–0.55) | yes |
| Graviton4 | warm sweep | q8-d16-len512 | NumKong (approx.), f16 | 0.51 [0.49, 0.52] (0.41–0.53) | yes |
| Graviton4 | warm sweep | q8-d16-len512 | NumKong (approx.), f32 | 0.51 [0.50, 0.53] (0.42–0.57) | yes |
| Graviton4 | warm sweep | q8-d16-lennat | NumKong (approx.), bf16 | 0.79 [0.74, 0.84] (0.56–0.78) | yes |
| Graviton4 | warm sweep | q8-d16-lennat | NumKong (approx.), f16 | 0.80 [0.75, 0.85] (0.57–0.78) | yes |
| Graviton4 | warm sweep | q8-d16-lennat | NumKong (approx.), f32 | 0.81 [0.76, 0.85] (0.59–0.82) | yes |
| Graviton4 | warm sweep | q8-d256-len128 | NumKong (approx.), bf16 | 0.32 [0.30, 0.33] (0.27–0.33) | yes |
| Graviton4 | warm sweep | q8-d256-len128 | NumKong (approx.), f16 | 0.33 [0.32, 0.35] (0.29–0.35) | yes |
| Graviton4 | warm sweep | q8-d256-len128 | NumKong (approx.), f32 | 0.35 [0.33, 0.37] (0.32–0.36) | yes |
| Graviton4 | warm sweep | q8-d256-len32 | NumKong (approx.), bf16 | 0.74 [0.72, 0.76] (0.71–0.74) | yes |
| Graviton4 | warm sweep | q8-d256-len32 | NumKong (approx.), f16 | 0.78 [0.76, 0.79] (0.75–0.78) | yes |
| Graviton4 | warm sweep | q8-d256-len32 | NumKong (approx.), f32 | 0.82 [0.80, 0.84] (0.80–0.81) | yes |
| Graviton4 | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.28 [0.24, 0.32] (0.26–0.29) | yes |
| Graviton4 | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.30 [0.25, 0.34] (0.28–0.30) | yes |
| Graviton4 | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.30 [0.26, 0.34] (0.29–0.30) | yes |
| Graviton4 | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.27 [0.25, 0.29] (0.24–0.30) | yes |
| Graviton4 | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.27 [0.25, 0.29] (0.25–0.30) | yes |
| Graviton4 | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.29 [0.26, 0.31] (0.27–0.33) | yes |
| Graviton4 | warm sweep | q8-d4096-len128 | NumKong (approx.), bf16 | 0.35 [0.34, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d4096-len128 | NumKong (approx.), f16 | 0.38 [0.37, 0.39] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q8-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.40, 0.43] (0.41–0.42) | yes |
| Graviton4 | warm sweep | q8-d4096-len32 | NumKong (approx.), bf16 | 0.45 [0.43, 0.47] (0.44–0.45) | yes |
| Graviton4 | warm sweep | q8-d4096-len32 | NumKong (approx.), f16 | 0.51 [0.49, 0.53] (0.49–0.50) | yes |
| Graviton4 | warm sweep | q8-d4096-len32 | NumKong (approx.), f32 | 0.63 [0.60, 0.67] (0.62–0.64) | yes |
| Graviton4 | warm sweep | q8-d4096-len512 | NumKong (approx.), bf16 | 0.30 [0.30, 0.30] (0.30–0.30) | yes |
| Graviton4 | warm sweep | q8-d4096-len512 | NumKong (approx.), f16 | 0.32 [0.31, 0.32] (0.32–0.32) | yes |
| Graviton4 | warm sweep | q8-d4096-len512 | NumKong (approx.), f32 | 0.33 [0.32, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q8-d4096-lennat | NumKong (approx.), bf16 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| Graviton4 | warm sweep | q8-d4096-lennat | NumKong (approx.), f16 | 0.34 [0.33, 0.34] (0.33–0.34) | yes |
| Graviton4 | warm sweep | q8-d4096-lennat | NumKong (approx.), f32 | 0.35 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q8-d64-len128 | NumKong (approx.), bf16 | 0.66 [0.65, 0.67] (0.58–0.68) | yes |
| Graviton4 | warm sweep | q8-d64-len128 | NumKong (approx.), f16 | 0.68 [0.67, 0.70] (0.59–0.71) | yes |
| Graviton4 | warm sweep | q8-d64-len128 | NumKong (approx.), f32 | 0.70 [0.69, 0.71] (0.62–0.71) | yes |
| Graviton4 | warm sweep | q8-d64-len32 | NumKong (approx.), bf16 | 0.98 [0.84, 1.12] (0.95–1.03) | no |
| Graviton4 | warm sweep | q8-d64-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.36] (0.28–0.37) | yes |
| Graviton4 | warm sweep | q8-d64-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.36] (0.28–0.37) | yes |
| Graviton4 | warm sweep | q8-d64-len512 | NumKong (approx.), f32 | 0.38 [0.36, 0.40] (0.30–0.42) | yes |
| Graviton4 | warm sweep | q8-d64-lennat | NumKong (approx.), bf16 | 0.37 [0.32, 0.41] (0.24–0.39) | yes |
| Graviton4 | warm sweep | q8-d64-lennat | NumKong (approx.), f16 | 0.38 [0.33, 0.42] (0.24–0.38) | yes |
| Graviton4 | warm sweep | q8-d64-lennat | NumKong (approx.), f32 | 0.39 [0.33, 0.43] (0.27–0.39) | yes |
| Intel | one thread | agent-ho | NumKong (approx.), f16 | 0.10 [0.10, 0.11] (0.10–0.11) | yes |
| Intel | one thread | beir | NumKong (approx.), f16 | 0.12 [0.12, 0.12] (0.12–0.12) | yes |
| Intel | one thread | beir | NumPy, f32 | 0.83 [0.83, 0.83] (0.83–0.84) | yes |
| Intel | one thread | beir | PyTorch, f32 | 0.85 [0.85, 0.85] (0.85–0.85) | yes |
| Intel | one thread | gcsn-ho | NumKong (approx.), f16 | 0.15 [0.15, 0.15] (0.14–0.16) | yes |
| Intel | pool-parked | agent-ho | NumPy, f32 | 0.61 [0.58, 0.64] (0.62–0.62) | yes |
| Intel | pool-parked | agent-ho | NumKong (approx.), f16 | 0.86 [0.77, 0.97] (0.78–0.96) | yes |
| Intel | pool-parked | beir | NumKong (approx.), bf16 | 0.78 [0.77, 0.79] (0.73–0.79) | yes |
| Intel | pool-parked | beir | NumKong (approx.), f16 | 0.80 [0.79, 0.80] (0.71–0.80) | yes |
| Intel | pool-parked | beir | NumKong (approx.), f32 | 0.82 [0.81, 0.82] (0.77–0.82) | yes |
| Intel | pool-parked | beir | NumPy, f32 | 0.91 [0.91, 0.92] (0.92–0.92) | yes |
| Intel | pool-parked | gcsn-ho | NumKong (approx.), f16 | 0.21 [0.21, 0.21] (0.21–0.22) | yes |
| Intel | pool-parked | gcsn-ho | NumPy, f32 | 0.50 [0.50, 0.50] (0.49–0.51) | yes |
| Intel | warm | agent-ho | NumKong (approx.), f16 | 0.62 [0.57, 0.68] (0.66–0.67) | yes |
| Intel | warm | agent-ho | NumKong (approx.), f32 | 0.64 [0.59, 0.70] (0.67–0.69) | yes |
| Intel | warm | agent-ho | NumKong (approx.), bf16 | 0.70 [0.65, 0.77] (0.74–0.76) | yes |
| Intel | warm | beir | NumKong (approx.), f16 | 0.33 [0.33, 0.33] (0.34–0.35) | yes |
| Intel | warm | beir | NumKong (approx.), f32 | 0.34 [0.34, 0.34] (0.35–0.36) | yes |
| Intel | warm | beir | NumKong (approx.), bf16 | 0.35 [0.34, 0.35] (0.36–0.36) | yes |
| Intel | warm | beir | PyTorch, bf16 | 0.85 [0.85, 0.86] (0.85–0.86) | yes |
| Intel | warm | gcsn-ho | NumKong (approx.), f16 | 0.72 [0.72, 0.73] (0.71–0.72) | yes |
| Intel | warm | gcsn-ho | NumKong (approx.), bf16 | 0.88 [0.88, 0.89] (0.90–0.93) | yes |
| Intel | warm | gcsn-ho | NumKong (approx.), f32 | 0.90 [0.89, 0.91] (0.92–0.95) | yes |
| Intel | warm sweep | q32-d1-len128 | NumKong (approx.), bf16 | 0.93 [0.90, 0.97] (0.62–1.40) | yes |
| Intel | warm sweep | q32-d1-len128 | NumKong (approx.), f16 | 0.95 [0.93, 0.98] (0.61–1.27) | yes |
| Intel | warm sweep | q32-d1-len128 | NumKong (approx.), f32 | 0.99 [0.97, 1.02] (0.67–1.35) | no |
| Intel | warm sweep | q32-d1-len512 | NumKong (approx.), bf16 | 0.82 [0.76, 0.87] (0.53–0.87) | yes |
| Intel | warm sweep | q32-d1-len512 | NumKong (approx.), f32 | 0.85 [0.79, 0.90] (0.55–0.68) | yes |
| Intel | warm sweep | q32-d1-len512 | NumKong (approx.), f16 | 0.86 [0.80, 0.91] (0.49–0.95) | yes |
| Intel | warm sweep | q32-d1-lennat | NumKong (approx.), bf16 | 0.81 [0.75, 0.88] (0.61–1.01) | yes |
| Intel | warm sweep | q32-d1024-len128 | NumKong (approx.), f16 | 0.19 [0.18, 0.20] (0.18–0.19) | yes |
| Intel | warm sweep | q32-d1024-len128 | NumKong (approx.), bf16 | 0.20 [0.19, 0.21] (0.19–0.20) | yes |
| Intel | warm sweep | q32-d1024-len128 | NumKong (approx.), f32 | 0.22 [0.21, 0.23] (0.21–0.22) | yes |
| Intel | warm sweep | q32-d1024-len128 | PyTorch, bf16 | 0.57 [0.49, 0.69] (0.50–0.59) | yes |
| Intel | warm sweep | q32-d1024-len128 | PyTorch, f32 | 0.78 [0.74, 0.83] (0.69–1.06) | yes |
| Intel | warm sweep | q32-d1024-len32 | NumKong (approx.), bf16 | 0.25 [0.24, 0.25] (0.23–0.26) | yes |
| Intel | warm sweep | q32-d1024-len32 | NumKong (approx.), f16 | 0.30 [0.30, 0.31] (0.29–0.31) | yes |
| Intel | warm sweep | q32-d1024-len32 | NumKong (approx.), f32 | 0.39 [0.38, 0.40] (0.38–0.40) | yes |
| Intel | warm sweep | q32-d1024-len32 | PyTorch, bf16 | 0.80 [0.78, 0.83] (0.79–0.87) | yes |
| Intel | warm sweep | q32-d1024-len32 | PyTorch, f32 | 0.96 [0.95, 0.98] (0.91–1.13) | yes |
| Intel | warm sweep | q32-d1024-len512 | NumKong (approx.), f16 | 0.14 [0.13, 0.15] (0.14–0.14) | yes |
| Intel | warm sweep | q32-d1024-len512 | NumKong (approx.), f32 | 0.15 [0.14, 0.16] (0.15–0.15) | yes |
| Intel | warm sweep | q32-d1024-len512 | NumKong (approx.), bf16 | 0.19 [0.18, 0.20] (0.19–0.19) | yes |
| Intel | warm sweep | q32-d1024-len512 | PyTorch, bf16 | 0.90 [0.86, 0.95] (0.89–0.93) | yes |
| Intel | warm sweep | q32-d1024-lennat | NumKong (approx.), f16 | 0.15 [0.15, 0.16] (0.15–0.15) | yes |
| Intel | warm sweep | q32-d1024-lennat | NumKong (approx.), f32 | 0.16 [0.16, 0.17] (0.16–0.16) | yes |
| Intel | warm sweep | q32-d1024-lennat | NumKong (approx.), bf16 | 0.19 [0.18, 0.20] (0.18–0.19) | yes |
| Intel | warm sweep | q32-d1024-lennat | PyTorch, f32 | 0.93 [0.79, 1.18] (0.90–1.04) | no |
| Intel | warm sweep | q32-d16-len128 | NumKong (approx.), f16 | 0.61 [0.58, 0.65] (0.43–0.52) | yes |
| Intel | warm sweep | q32-d16-len128 | NumKong (approx.), bf16 | 0.62 [0.58, 0.65] (0.41–0.53) | yes |
| Intel | warm sweep | q32-d16-len128 | NumKong (approx.), f32 | 0.66 [0.63, 0.69] (0.46–0.54) | yes |
| Intel | warm sweep | q32-d16-len32 | NumKong (approx.), bf16 | 0.86 [0.74, 0.98] (0.55–0.69) | yes |
| Intel | warm sweep | q32-d16-len32 | NumKong (approx.), f16 | 1.00 [0.86, 1.12] (0.68–0.84) | no |
| Intel | warm sweep | q32-d16-len512 | NumKong (approx.), f16 | 0.25 [0.23, 0.27] (0.22–0.27) | yes |
| Intel | warm sweep | q32-d16-len512 | NumKong (approx.), f32 | 0.25 [0.24, 0.27] (0.22–0.28) | yes |
| Intel | warm sweep | q32-d16-len512 | NumKong (approx.), bf16 | 0.29 [0.27, 0.31] (0.26–0.31) | yes |
| Intel | warm sweep | q32-d16-len512 | PyTorch, bf16 | 0.43 [0.39, 0.46] (0.35–0.46) | yes |
| Intel | warm sweep | q32-d16-lennat | NumKong (approx.), f16 | 0.45 [0.41, 0.47] (0.36–0.44) | yes |
| Intel | warm sweep | q32-d16-lennat | NumKong (approx.), f32 | 0.45 [0.41, 0.47] (0.37–0.44) | yes |
| Intel | warm sweep | q32-d16-lennat | NumKong (approx.), bf16 | 0.47 [0.44, 0.50] (0.37–0.48) | yes |
| Intel | warm sweep | q32-d16-lennat | PyTorch, bf16 | 0.86 [0.78, 0.93] (0.72–0.79) | yes |
| Intel | warm sweep | q32-d256-len128 | NumKong (approx.), f16 | 0.17 [0.15, 0.19] (0.17–0.18) | yes |
| Intel | warm sweep | q32-d256-len128 | NumKong (approx.), f32 | 0.19 [0.17, 0.21] (0.19–0.21) | yes |
| Intel | warm sweep | q32-d256-len128 | NumKong (approx.), bf16 | 0.20 [0.18, 0.23] (0.20–0.23) | yes |
| Intel | warm sweep | q32-d256-len128 | PyTorch, bf16 | 0.37 [0.34, 0.39] (0.40–0.43) | yes |
| Intel | warm sweep | q32-d256-len128 | PyTorch, f32 | 0.94 [0.82, 1.02] (0.92–0.96) | no |
| Intel | warm sweep | q32-d256-len32 | NumKong (approx.), bf16 | 0.37 [0.36, 0.38] (0.37–0.41) | yes |
| Intel | warm sweep | q32-d256-len32 | NumKong (approx.), f16 | 0.43 [0.42, 0.44] (0.43–0.47) | yes |
| Intel | warm sweep | q32-d256-len32 | NumKong (approx.), f32 | 0.50 [0.49, 0.52] (0.50–0.55) | yes |
| Intel | warm sweep | q32-d256-len32 | PyTorch, bf16 | 0.77 [0.76, 0.79] (0.74–0.82) | yes |
| Intel | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.14 [0.13, 0.14] (0.14–0.14) | yes |
| Intel | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.17 [0.17, 0.18] (0.17–0.18) | yes |
| Intel | warm sweep | q32-d256-len512 | PyTorch, bf16 | 0.38 [0.37, 0.40] (0.38–0.43) | yes |
| Intel | warm sweep | q32-d256-len512 | PyTorch, f32 | 0.67 [0.66, 0.69] (0.66–0.70) | yes |
| Intel | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.14 [0.12, 0.16] (0.13–0.15) | yes |
| Intel | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.15 [0.13, 0.17] (0.14–0.16) | yes |
| Intel | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.19 [0.15, 0.21] (0.17–0.21) | yes |
| Intel | warm sweep | q32-d256-lennat | PyTorch, f32 | 0.67 [0.56, 0.74] (0.62–0.71) | yes |
| Intel | warm sweep | q32-d256-lennat | PyTorch, bf16 | 0.85 [0.80, 0.92] (0.78–0.99) | yes |
| Intel | warm sweep | q32-d256-lennat | maxsim-cpu, f32 | 1.00 [0.86, 1.10] (0.92–1.07) | no |
| Intel | warm sweep | q32-d4-len128 | NumKong (approx.), bf16 | 0.74 [0.70, 0.77] (0.48–0.57) | yes |
| Intel | warm sweep | q32-d4-len128 | NumKong (approx.), f32 | 0.95 [0.91, 0.99] (0.62–0.86) | yes |
| Intel | warm sweep | q32-d4-len512 | NumKong (approx.), bf16 | 0.82 [0.74, 0.90] (0.53–0.75) | yes |
| Intel | warm sweep | q32-d4-len512 | NumKong (approx.), f32 | 0.94 [0.83, 1.06] (0.69–0.99) | no |
| Intel | warm sweep | q32-d4-len512 | NumKong (approx.), f16 | 0.99 [0.87, 1.12] (0.74–0.88) | no |
| Intel | warm sweep | q32-d4-lennat | NumKong (approx.), bf16 | 0.86 [0.79, 0.92] (0.53–0.76) | yes |
| Intel | warm sweep | q32-d4-lennat | NumKong (approx.), f32 | 0.96 [0.87, 1.05] (0.60–0.80) | no |
| Intel | warm sweep | q32-d4-lennat | NumKong (approx.), f16 | 1.00 [0.90, 1.10] (0.57–0.87) | no |
| Intel | warm sweep | q32-d4096-len128 | NumKong (approx.), f16 | 0.18 [0.17, 0.19] (0.18–0.18) | yes |
| Intel | warm sweep | q32-d4096-len128 | NumKong (approx.), bf16 | 0.20 [0.19, 0.21] (0.20–0.20) | yes |
| Intel | warm sweep | q32-d4096-len128 | NumKong (approx.), f32 | 0.21 [0.20, 0.22] (0.21–0.22) | yes |
| Intel | warm sweep | q32-d4096-len32 | NumKong (approx.), bf16 | 0.20 [0.19, 0.20] (0.19–0.20) | yes |
| Intel | warm sweep | q32-d4096-len32 | NumKong (approx.), f16 | 0.27 [0.26, 0.27] (0.26–0.27) | yes |
| Intel | warm sweep | q32-d4096-len32 | NumKong (approx.), f32 | 0.35 [0.35, 0.36] (0.35–0.36) | yes |
| Intel | warm sweep | q32-d4096-len32 | PyTorch, f32 | 0.63 [0.57, 0.77] (0.62–0.79) | yes |
| Intel | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.16 [0.15, 0.16] (0.16–0.16) | yes |
| Intel | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.17 [0.16, 0.18] (0.17–0.17) | yes |
| Intel | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.20 [0.20, 0.22] (0.20–0.21) | yes |
| Intel | warm sweep | q32-d4096-len512 | PyTorch, bf16 | 0.96 [0.94, 1.01] (0.95–0.97) | no |
| Intel | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.17 [0.16, 0.18] (0.17–0.17) | yes |
| Intel | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.19 [0.18, 0.20] (0.19–0.20) | yes |
| Intel | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.21 [0.20, 0.22] (0.21–0.21) | yes |
| Intel | warm sweep | q32-d64-len128 | NumKong (approx.), f16 | 0.29 [0.28, 0.30] (0.27–0.31) | yes |
| Intel | warm sweep | q32-d64-len128 | NumKong (approx.), bf16 | 0.31 [0.30, 0.32] (0.30–0.33) | yes |
| Intel | warm sweep | q32-d64-len128 | NumKong (approx.), f32 | 0.31 [0.30, 0.33] (0.29–0.34) | yes |
| Intel | warm sweep | q32-d64-len128 | PyTorch, bf16 | 0.46 [0.43, 0.49] (0.42–0.48) | yes |
| Intel | warm sweep | q32-d64-len32 | NumKong (approx.), bf16 | 0.61 [0.55, 0.67] (0.44–0.57) | yes |
| Intel | warm sweep | q32-d64-len32 | NumKong (approx.), f16 | 0.67 [0.61, 0.73] (0.47–0.62) | yes |
| Intel | warm sweep | q32-d64-len32 | NumKong (approx.), f32 | 0.70 [0.64, 0.76] (0.49–0.69) | yes |
| Intel | warm sweep | q32-d64-len512 | NumKong (approx.), f16 | 0.16 [0.14, 0.18] (0.14–0.16) | yes |
| Intel | warm sweep | q32-d64-len512 | NumKong (approx.), f32 | 0.18 [0.15, 0.21] (0.16–0.20) | yes |
| Intel | warm sweep | q32-d64-len512 | NumKong (approx.), bf16 | 0.23 [0.19, 0.27] (0.20–0.24) | yes |
| Intel | warm sweep | q32-d64-len512 | PyTorch, bf16 | 0.31 [0.27, 0.35] (0.25–0.51) | yes |
| Intel | warm sweep | q32-d64-lennat | NumKong (approx.), f16 | 0.18 [0.16, 0.20] (0.15–0.18) | yes |
| Intel | warm sweep | q32-d64-lennat | NumKong (approx.), f32 | 0.19 [0.17, 0.22] (0.17–0.21) | yes |
| Intel | warm sweep | q32-d64-lennat | NumKong (approx.), bf16 | 0.24 [0.20, 0.29] (0.20–0.25) | yes |
| Intel | warm sweep | q32-d64-lennat | PyTorch, bf16 | 0.49 [0.42, 0.55] (0.40–0.61) | yes |
| Intel | warm sweep | q64-d1-len128 | NumKong (approx.), f16 | 0.63 [0.62, 0.65] (0.40–0.77) | yes |
| Intel | warm sweep | q64-d1-len128 | NumKong (approx.), bf16 | 0.65 [0.64, 0.67] (0.46–0.70) | yes |
| Intel | warm sweep | q64-d1-len128 | NumKong (approx.), f32 | 0.71 [0.69, 0.72] (0.46–0.78) | yes |
| Intel | warm sweep | q64-d1-len512 | NumKong (approx.), f32 | 0.65 [0.61, 0.68] (0.44–0.62) | yes |
| Intel | warm sweep | q64-d1-len512 | NumKong (approx.), f16 | 0.72 [0.65, 0.82] (0.42–0.68) | yes |
| Intel | warm sweep | q64-d1-len512 | NumKong (approx.), bf16 | 0.78 [0.66, 0.95] (0.36–0.67) | yes |
| Intel | warm sweep | q64-d1-len512 | NumPy, f32 | 0.98 [0.93, 1.02] (0.62–0.80) | no |
| Intel | warm sweep | q64-d1-lennat | NumKong (approx.), bf16 | 0.63 [0.59, 0.67] (0.41–0.72) | yes |
| Intel | warm sweep | q64-d1-lennat | NumKong (approx.), f32 | 0.70 [0.65, 0.75] (0.46–0.90) | yes |
| Intel | warm sweep | q64-d1-lennat | NumKong (approx.), f16 | 0.78 [0.67, 0.97] (0.50–0.84) | yes |
| Intel | warm sweep | q64-d1-lennat | NumPy, f32 | 0.95 [0.90, 1.00] (0.59–0.84) | no |
| Intel | warm sweep | q64-d1024-len128 | NumKong (approx.), bf16 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d1024-len128 | NumKong (approx.), f16 | 0.13 [0.13, 0.14] (0.13–0.14) | yes |
| Intel | warm sweep | q64-d1024-len128 | NumKong (approx.), f32 | 0.16 [0.15, 0.16] (0.15–0.16) | yes |
| Intel | warm sweep | q64-d1024-len128 | PyTorch, bf16 | 0.87 [0.76, 1.00] (0.69–1.05) | yes |
| Intel | warm sweep | q64-d1024-len32 | NumKong (approx.), bf16 | 0.15 [0.15, 0.16] (0.15–0.16) | yes |
| Intel | warm sweep | q64-d1024-len32 | NumKong (approx.), f16 | 0.22 [0.21, 0.22] (0.21–0.23) | yes |
| Intel | warm sweep | q64-d1024-len32 | NumKong (approx.), f32 | 0.32 [0.31, 0.32] (0.31–0.32) | yes |
| Intel | warm sweep | q64-d1024-len32 | PyTorch, bf16 | 0.69 [0.68, 0.69] (0.67–0.73) | yes |
| Intel | warm sweep | q64-d1024-len32 | PyTorch, f32 | 0.73 [0.72, 0.73] (0.71–0.88) | yes |
| Intel | warm sweep | q64-d1024-len512 | NumKong (approx.), f16 | 0.11 [0.10, 0.11] (0.11–0.11) | yes |
| Intel | warm sweep | q64-d1024-len512 | NumKong (approx.), f32 | 0.11 [0.11, 0.12] (0.11–0.11) | yes |
| Intel | warm sweep | q64-d1024-len512 | NumKong (approx.), bf16 | 0.13 [0.13, 0.14] (0.13–0.14) | yes |
| Intel | warm sweep | q64-d1024-len512 | PyTorch, bf16 | 0.73 [0.71, 0.77] (0.72–0.74) | yes |
| Intel | warm sweep | q64-d1024-lennat | NumKong (approx.), f16 | 0.12 [0.11, 0.12] (0.11–0.12) | yes |
| Intel | warm sweep | q64-d1024-lennat | NumKong (approx.), f32 | 0.13 [0.12, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d1024-lennat | NumKong (approx.), bf16 | 0.14 [0.14, 0.15] (0.14–0.15) | yes |
| Intel | warm sweep | q64-d16-len128 | NumKong (approx.), f16 | 0.40 [0.37, 0.43] (0.31–0.36) | yes |
| Intel | warm sweep | q64-d16-len128 | NumKong (approx.), bf16 | 0.42 [0.39, 0.47] (0.32–0.37) | yes |
| Intel | warm sweep | q64-d16-len128 | NumKong (approx.), f32 | 0.44 [0.41, 0.47] (0.36–0.40) | yes |
| Intel | warm sweep | q64-d16-len128 | PyTorch, bf16 | 0.68 [0.63, 0.73] (0.52–0.58) | yes |
| Intel | warm sweep | q64-d16-len32 | NumKong (approx.), bf16 | 0.68 [0.61, 0.75] (0.44–0.54) | yes |
| Intel | warm sweep | q64-d16-len32 | NumKong (approx.), f16 | 0.76 [0.69, 0.84] (0.46–0.62) | yes |
| Intel | warm sweep | q64-d16-len32 | NumKong (approx.), f32 | 0.88 [0.78, 0.97] (0.59–0.63) | yes |
| Intel | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.18 [0.17, 0.19] (0.17–0.20) | yes |
| Intel | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.19 [0.18, 0.20] (0.19–0.20) | yes |
| Intel | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.22 [0.21, 0.24] (0.22–0.24) | yes |
| Intel | warm sweep | q64-d16-len512 | PyTorch, bf16 | 0.34 [0.32, 0.36] (0.32–0.41) | yes |
| Intel | warm sweep | q64-d16-lennat | NumKong (approx.), f16 | 0.31 [0.29, 0.33] (0.26–0.34) | yes |
| Intel | warm sweep | q64-d16-lennat | NumKong (approx.), f32 | 0.32 [0.30, 0.34] (0.27–0.33) | yes |
| Intel | warm sweep | q64-d16-lennat | NumKong (approx.), bf16 | 0.35 [0.33, 0.38] (0.30–0.37) | yes |
| Intel | warm sweep | q64-d16-lennat | PyTorch, bf16 | 0.69 [0.64, 0.74] (0.54–0.69) | yes |
| Intel | warm sweep | q64-d256-len128 | NumKong (approx.), f16 | 0.14 [0.13, 0.16] (0.14–0.15) | yes |
| Intel | warm sweep | q64-d256-len128 | NumKong (approx.), bf16 | 0.16 [0.14, 0.17] (0.16–0.17) | yes |
| Intel | warm sweep | q64-d256-len128 | NumKong (approx.), f32 | 0.16 [0.15, 0.18] (0.16–0.18) | yes |
| Intel | warm sweep | q64-d256-len128 | PyTorch, bf16 | 0.41 [0.37, 0.45] (0.37–0.52) | yes |
| Intel | warm sweep | q64-d256-len128 | PyTorch, f32 | 0.80 [0.71, 0.87] (0.76–0.89) | yes |
| Intel | warm sweep | q64-d256-len32 | NumKong (approx.), bf16 | 0.23 [0.22, 0.23] (0.23–0.24) | yes |
| Intel | warm sweep | q64-d256-len32 | NumKong (approx.), f16 | 0.29 [0.29, 0.30] (0.29–0.30) | yes |
| Intel | warm sweep | q64-d256-len32 | NumKong (approx.), f32 | 0.37 [0.37, 0.38] (0.37–0.39) | yes |
| Intel | warm sweep | q64-d256-len32 | PyTorch, bf16 | 0.67 [0.67, 0.68] (0.67–0.71) | yes |
| Intel | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.10 [0.10, 0.11] (0.10–0.10) | yes |
| Intel | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.11 [0.10, 0.11] (0.11–0.11) | yes |
| Intel | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.13 [0.12, 0.13] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d256-len512 | PyTorch, bf16 | 0.33 [0.28, 0.43] (0.32–0.37) | yes |
| Intel | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.12 [0.12, 0.13] (0.11–0.13) | yes |
| Intel | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.14 [0.13, 0.14] (0.13–0.15) | yes |
| Intel | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.15 [0.14, 0.15] (0.15–0.16) | yes |
| Intel | warm sweep | q64-d256-lennat | PyTorch, f32 | 0.66 [0.65, 0.67] (0.64–0.89) | yes |
| Intel | warm sweep | q64-d256-lennat | PyTorch, bf16 | 0.71 [0.60, 0.93] (0.71–0.83) | yes |
| Intel | warm sweep | q64-d4-len128 | NumKong (approx.), bf16 | 0.60 [0.56, 0.63] (0.41–0.52) | yes |
| Intel | warm sweep | q64-d4-len128 | NumKong (approx.), f16 | 0.73 [0.67, 0.82] (0.51–0.58) | yes |
| Intel | warm sweep | q64-d4-len128 | NumKong (approx.), f32 | 0.82 [0.76, 0.92] (0.57–0.65) | yes |
| Intel | warm sweep | q64-d4-len32 | NumKong (approx.), bf16 | 0.83 [0.81, 0.86] (0.53–0.65) | yes |
| Intel | warm sweep | q64-d4-len512 | NumKong (approx.), bf16 | 0.63 [0.57, 0.69] (0.47–0.66) | yes |
| Intel | warm sweep | q64-d4-len512 | NumKong (approx.), f32 | 0.70 [0.61, 0.79] (0.55–0.76) | yes |
| Intel | warm sweep | q64-d4-len512 | NumKong (approx.), f16 | 0.71 [0.61, 0.81] (0.59–0.81) | yes |
| Intel | warm sweep | q64-d4-len512 | PyTorch, bf16 | 0.75 [0.67, 0.83] (0.56–0.68) | yes |
| Intel | warm sweep | q64-d4-lennat | NumKong (approx.), bf16 | 0.70 [0.65, 0.77] (0.53–0.61) | yes |
| Intel | warm sweep | q64-d4-lennat | NumKong (approx.), f32 | 0.73 [0.67, 0.79] (0.51–0.74) | yes |
| Intel | warm sweep | q64-d4-lennat | NumKong (approx.), f16 | 0.79 [0.72, 0.88] (0.56–0.80) | yes |
| Intel | warm sweep | q64-d4096-len128 | NumKong (approx.), f16 | 0.14 [0.14, 0.15] (0.14–0.14) | yes |
| Intel | warm sweep | q64-d4096-len128 | NumKong (approx.), bf16 | 0.16 [0.15, 0.17] (0.16–0.16) | yes |
| Intel | warm sweep | q64-d4096-len128 | NumKong (approx.), f32 | 0.17 [0.16, 0.18] (0.17–0.17) | yes |
| Intel | warm sweep | q64-d4096-len32 | NumKong (approx.), bf16 | 0.14 [0.14, 0.15] (0.14–0.15) | yes |
| Intel | warm sweep | q64-d4096-len32 | NumKong (approx.), f16 | 0.22 [0.22, 0.23] (0.22–0.23) | yes |
| Intel | warm sweep | q64-d4096-len32 | NumKong (approx.), f32 | 0.31 [0.30, 0.31] (0.31–0.31) | yes |
| Intel | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.12 [0.11, 0.13] (0.12–0.12) | yes |
| Intel | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.13 [0.12, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.15 [0.14, 0.15] (0.15–0.15) | yes |
| Intel | warm sweep | q64-d4096-len512 | PyTorch, bf16 | 0.80 [0.76, 0.85] (0.79–0.81) | yes |
| Intel | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.12 [0.11, 0.12] (0.12–0.12) | yes |
| Intel | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.15 [0.14, 0.15] (0.15–0.15) | yes |
| Intel | warm sweep | q64-d64-len128 | NumKong (approx.), f16 | 0.21 [0.20, 0.22] (0.20–0.22) | yes |
| Intel | warm sweep | q64-d64-len128 | NumKong (approx.), bf16 | 0.21 [0.20, 0.22] (0.21–0.23) | yes |
| Intel | warm sweep | q64-d64-len128 | NumKong (approx.), f32 | 0.23 [0.22, 0.25] (0.23–0.24) | yes |
| Intel | warm sweep | q64-d64-len128 | PyTorch, bf16 | 0.38 [0.35, 0.40] (0.37–0.39) | yes |
| Intel | warm sweep | q64-d64-len32 | NumKong (approx.), bf16 | 0.43 [0.39, 0.46] (0.37–0.43) | yes |
| Intel | warm sweep | q64-d64-len32 | NumKong (approx.), f16 | 0.47 [0.43, 0.51] (0.42–0.47) | yes |
| Intel | warm sweep | q64-d64-len32 | NumKong (approx.), f32 | 0.54 [0.50, 0.59] (0.49–0.56) | yes |
| Intel | warm sweep | q64-d64-len32 | PyTorch, bf16 | 0.87 [0.79, 0.95] (0.73–0.85) | yes |
| Intel | warm sweep | q64-d64-len512 | NumKong (approx.), f16 | 0.11 [0.09, 0.12] (0.10–0.12) | yes |
| Intel | warm sweep | q64-d64-len512 | NumKong (approx.), f32 | 0.12 [0.11, 0.12] (0.11–0.14) | yes |
| Intel | warm sweep | q64-d64-len512 | NumKong (approx.), bf16 | 0.15 [0.14, 0.16] (0.14–0.16) | yes |
| Intel | warm sweep | q64-d64-len512 | PyTorch, bf16 | 0.25 [0.23, 0.26] (0.25–0.33) | yes |
| Intel | warm sweep | q64-d64-len512 | PyTorch, f32 | 0.74 [0.67, 0.79] (0.68–0.89) | yes |
| Intel | warm sweep | q64-d64-lennat | NumKong (approx.), f16 | 0.16 [0.14, 0.18] (0.16–0.17) | yes |
| Intel | warm sweep | q64-d64-lennat | NumKong (approx.), f32 | 0.17 [0.15, 0.19] (0.16–0.18) | yes |
| Intel | warm sweep | q64-d64-lennat | NumKong (approx.), bf16 | 0.21 [0.18, 0.25] (0.20–0.22) | yes |
| Intel | warm sweep | q64-d64-lennat | PyTorch, bf16 | 0.51 [0.44, 0.57] (0.48–0.58) | yes |
| Intel | warm sweep | q8-d1024-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.41] (0.38–0.40) | yes |
| Intel | warm sweep | q8-d1024-len128 | NumKong (approx.), f32 | 0.44 [0.42, 0.45] (0.41–0.44) | yes |
| Intel | warm sweep | q8-d1024-len128 | NumKong (approx.), bf16 | 0.49 [0.47, 0.51] (0.47–0.50) | yes |
| Intel | warm sweep | q8-d1024-len128 | PyTorch, bf16 | 0.97 [0.84, 1.12] (0.89–1.07) | no |
| Intel | warm sweep | q8-d1024-len32 | NumKong (approx.), f16 | 0.57 [0.54, 0.60] (0.56–0.58) | yes |
| Intel | warm sweep | q8-d1024-len32 | NumKong (approx.), bf16 | 0.59 [0.56, 0.64] (0.58–0.63) | yes |
| Intel | warm sweep | q8-d1024-len32 | NumKong (approx.), f32 | 0.67 [0.64, 0.69] (0.63–0.74) | yes |
| Intel | warm sweep | q8-d1024-len32 | PyTorch, bf16 | 0.82 [0.79, 0.86] (0.80–0.91) | yes |
| Intel | warm sweep | q8-d1024-len512 | NumKong (approx.), f16 | 0.29 [0.28, 0.31] (0.29–0.31) | yes |
| Intel | warm sweep | q8-d1024-len512 | NumKong (approx.), f32 | 0.31 [0.30, 0.32] (0.31–0.33) | yes |
| Intel | warm sweep | q8-d1024-len512 | NumKong (approx.), bf16 | 0.48 [0.47, 0.50] (0.48–0.49) | yes |
| Intel | warm sweep | q8-d1024-len512 | PyTorch, bf16 | 0.79 [0.72, 0.91] (0.76–0.84) | yes |
| Intel | warm sweep | q8-d1024-lennat | NumKong (approx.), f16 | 0.34 [0.32, 0.36] (0.32–0.36) | yes |
| Intel | warm sweep | q8-d1024-lennat | NumKong (approx.), f32 | 0.35 [0.34, 0.37] (0.35–0.36) | yes |
| Intel | warm sweep | q8-d1024-lennat | NumKong (approx.), bf16 | 0.50 [0.48, 0.53] (0.48–0.51) | yes |
| Intel | warm sweep | q8-d16-len512 | NumKong (approx.), f16 | 0.60 [0.55, 0.64] (0.44–0.59) | yes |
| Intel | warm sweep | q8-d16-len512 | NumKong (approx.), f32 | 0.62 [0.58, 0.67] (0.46–0.61) | yes |
| Intel | warm sweep | q8-d16-len512 | NumKong (approx.), bf16 | 0.70 [0.65, 0.74] (0.52–0.66) | yes |
| Intel | warm sweep | q8-d16-len512 | PyTorch, bf16 | 0.95 [0.87, 1.03] (0.67–0.89) | no |
| Intel | warm sweep | q8-d16-lennat | NumKong (approx.), f16 | 0.91 [0.84, 0.98] (0.58–0.70) | yes |
| Intel | warm sweep | q8-d16-lennat | NumKong (approx.), f32 | 0.93 [0.86, 0.99] (0.53–0.69) | yes |
| Intel | warm sweep | q8-d256-len128 | NumKong (approx.), f16 | 0.35 [0.27, 0.43] (0.25–0.37) | yes |
| Intel | warm sweep | q8-d256-len128 | NumKong (approx.), f32 | 0.38 [0.29, 0.47] (0.26–0.42) | yes |
| Intel | warm sweep | q8-d256-len128 | NumKong (approx.), bf16 | 0.46 [0.36, 0.57] (0.32–0.51) | yes |
| Intel | warm sweep | q8-d256-len128 | PyTorch, bf16 | 0.57 [0.44, 0.68] (0.39–0.61) | yes |
| Intel | warm sweep | q8-d256-len32 | NumKong (approx.), f16 | 0.93 [0.91, 0.94] (0.91–1.09) | yes |
| Intel | warm sweep | q8-d256-len32 | NumKong (approx.), bf16 | 0.93 [0.91, 0.95] (0.93–1.07) | yes |
| Intel | warm sweep | q8-d256-len32 | NumKong (approx.), f32 | 0.97 [0.96, 0.99] (0.99–1.05) | yes |
| Intel | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.29 [0.28, 0.31] (0.26–0.32) | yes |
| Intel | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.30 [0.29, 0.31] (0.27–0.31) | yes |
| Intel | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.43 [0.42, 0.45] (0.40–0.44) | yes |
| Intel | warm sweep | q8-d256-len512 | PyTorch, bf16 | 0.63 [0.60, 0.65] (0.57–0.73) | yes |
| Intel | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.27 [0.21, 0.34] (0.24–0.27) | yes |
| Intel | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.29 [0.23, 0.34] (0.26–0.33) | yes |
| Intel | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.41 [0.32, 0.50] (0.35–0.43) | yes |
| Intel | warm sweep | q8-d4096-len128 | NumKong (approx.), f16 | 0.37 [0.36, 0.38] (0.36–0.38) | yes |
| Intel | warm sweep | q8-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.41, 0.42] (0.41–0.43) | yes |
| Intel | warm sweep | q8-d4096-len128 | NumKong (approx.), bf16 | 0.49 [0.48, 0.49] (0.48–0.50) | yes |
| Intel | warm sweep | q8-d4096-len32 | NumKong (approx.), bf16 | 0.49 [0.48, 0.51] (0.48–0.50) | yes |
| Intel | warm sweep | q8-d4096-len32 | NumKong (approx.), f16 | 0.51 [0.50, 0.52] (0.49–0.52) | yes |
| Intel | warm sweep | q8-d4096-len32 | NumKong (approx.), f32 | 0.59 [0.57, 0.61] (0.58–0.60) | yes |
| Intel | warm sweep | q8-d4096-len512 | NumKong (approx.), f16 | 0.32 [0.31, 0.33] (0.32–0.32) | yes |
| Intel | warm sweep | q8-d4096-len512 | NumKong (approx.), f32 | 0.34 [0.33, 0.35] (0.34–0.34) | yes |
| Intel | warm sweep | q8-d4096-len512 | NumKong (approx.), bf16 | 0.52 [0.51, 0.54] (0.52–0.52) | yes |
| Intel | warm sweep | q8-d4096-lennat | NumKong (approx.), f16 | 0.33 [0.32, 0.33] (0.33–0.33) | yes |
| Intel | warm sweep | q8-d4096-lennat | NumKong (approx.), f32 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Intel | warm sweep | q8-d4096-lennat | NumKong (approx.), bf16 | 0.52 [0.52, 0.53] (0.52–0.54) | yes |
| Intel | warm sweep | q8-d64-len128 | NumKong (approx.), f16 | 0.69 [0.63, 0.74] (0.61–0.72) | yes |
| Intel | warm sweep | q8-d64-len128 | NumKong (approx.), f32 | 0.73 [0.66, 0.79] (0.65–0.75) | yes |
| Intel | warm sweep | q8-d64-len128 | NumKong (approx.), bf16 | 0.79 [0.71, 0.86] (0.65–0.81) | yes |
| Intel | warm sweep | q8-d64-len32 | NumKong (approx.), bf16 | 0.94 [0.80, 1.11] (0.83–0.91) | no |
| Intel | warm sweep | q8-d64-len32 | NumKong (approx.), f16 | 0.99 [0.84, 1.16] (0.88–1.00) | no |
| Intel | warm sweep | q8-d64-len512 | NumKong (approx.), f32 | 0.27 [0.23, 0.31] (0.23–0.27) | yes |
| Intel | warm sweep | q8-d64-len512 | NumKong (approx.), f16 | 0.28 [0.24, 0.33] (0.23–0.29) | yes |
| Intel | warm sweep | q8-d64-len512 | NumKong (approx.), bf16 | 0.43 [0.36, 0.51] (0.36–0.41) | yes |
| Intel | warm sweep | q8-d64-len512 | PyTorch, bf16 | 0.61 [0.51, 0.70] (0.49–0.63) | yes |
| Intel | warm sweep | q8-d64-lennat | NumKong (approx.), f16 | 0.39 [0.31, 0.46] (0.24–0.31) | yes |
| Intel | warm sweep | q8-d64-lennat | NumKong (approx.), f32 | 0.43 [0.35, 0.51] (0.28–0.33) | yes |
| Intel | warm sweep | q8-d64-lennat | NumKong (approx.), bf16 | 0.52 [0.43, 0.61] (0.36–0.38) | yes |
| M3 Max | one thread | agent-ho | NumPy, f32 | 0.24 [0.23, 0.25] (0.24–0.25) | yes |
| M3 Max | one thread | agent-ho | NumKong (approx.), f16 | 0.30 [0.29, 0.30] (0.29–0.32) | yes |
| M3 Max | one thread | agent-ho | PyTorch, f32 | 0.51 [0.47, 0.55] (0.51–0.51) | yes |
| M3 Max | one thread | agent-ho | maxsim-cpu, f32 | 0.77 [0.75, 0.80] (0.77–0.78) | yes |
| M3 Max | one thread | beir | NumPy, f32 | 0.16 [0.16, 0.16] (0.16–0.16) | yes |
| M3 Max | one thread | beir | NumKong (approx.), f16 | 0.26 [0.26, 0.26] (0.26–0.27) | yes |
| M3 Max | one thread | beir | PyTorch, f32 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| M3 Max | one thread | beir | maxsim-cpu, f32 | 0.50 [0.50, 0.50] (0.50–0.50) | yes |
| M3 Max | one thread | gcsn-ho | NumPy, f32 | 0.28 [0.28, 0.28] (0.28–0.28) | yes |
| M3 Max | one thread | gcsn-ho | NumKong (approx.), f16 | 0.31 [0.31, 0.32] (0.31–0.32) | yes |
| M3 Max | one thread | gcsn-ho | PyTorch, f32 | 0.91 [0.90, 0.92] (0.90–0.91) | yes |
| M3 Max | one thread | gcsn-ho | maxsim-cpu, f32 | 0.95 [0.94, 0.96] (0.94–0.95) | yes |
| M3 Max | pool-parked | agent-ho | NumPy, f32 | 0.92 [0.88, 0.97] (0.92–0.93) | yes |
| M3 Max | pool-parked | gcsn-ho | NumPy, f32 | 0.74 [0.73, 0.74] (0.73–0.74) | yes |
| M3 Max | pool-parked | gcsn-ho | NumKong (approx.), f16 | 0.88 [0.87, 0.89] (0.88–0.88) | yes |
| M3 Max | warm | beir | NumKong (approx.), f16 | 0.99 [0.98, 0.99] (1.00–1.04) | yes |
| M3 Max | warm | beir | NumKong (approx.), bf16 | 0.99 [0.99, 0.99] (1.00–1.04) | yes |
| M3 Max | warm sweep | q32-d1-len128 | maxsim-cpu, f32 | 0.51 [0.51, 0.52] (0.50–0.51) | yes |
| M3 Max | warm sweep | q32-d1-len128 | NumPy, f32 | 0.74 [0.74, 0.74] (0.72–0.74) | yes |
| M3 Max | warm sweep | q32-d1-len32 | maxsim-cpu, f32 | 0.58 [0.57, 0.58] (0.56–0.57) | yes |
| M3 Max | warm sweep | q32-d1-len512 | maxsim-cpu, f32 | 0.92 [0.92, 0.92] (0.88–0.91) | yes |
| M3 Max | warm sweep | q32-d1-lennat | maxsim-cpu, f32 | 0.70 [0.66, 0.74] (0.61–0.70) | yes |
| M3 Max | warm sweep | q32-d1-lennat | NumPy, f32 | 0.92 [0.89, 0.95] (0.80–0.91) | yes |
| M3 Max | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.33 [0.32, 0.33] (0.32–0.34) | yes |
| M3 Max | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.33 [0.32, 0.34] (0.33–0.34) | yes |
| M3 Max | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.34 [0.33, 0.35] (0.33–0.35) | yes |
| M3 Max | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.40 [0.39, 0.41] (0.39–0.41) | yes |
| M3 Max | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.40 [0.39, 0.42] (0.39–0.42) | yes |
| M3 Max | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.41 [0.40, 0.42] (0.40–0.42) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.16 [0.13, 0.20] (0.14–0.25) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.16 [0.13, 0.20] (0.15–0.26) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.17 [0.14, 0.21] (0.16–0.27) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | PyTorch, f32 | 0.75 [0.62, 0.94] (0.69–1.20) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NextPlaid, f32 | 0.78 [0.68, 0.91] (0.77–1.01) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NumPy, f32 | 0.89 [0.73, 1.12] (0.82–1.41) | no |
| M3 Max | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.29 [0.28, 0.29] (0.28–0.30) | yes |
| M3 Max | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.29 [0.28, 0.29] (0.28–0.29) | yes |
| M3 Max | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.31 [0.31, 0.32] (0.31–0.32) | yes |
| M3 Max | warm sweep | q64-d1-len512 | maxsim-cpu, f32 | 0.76 [0.75, 0.76] (0.63–0.75) | yes |
| M3 Max | warm sweep | q64-d1-len512 | NumPy, f32 | 0.88 [0.87, 0.88] (0.73–0.87) | yes |
| M3 Max | warm sweep | q64-d1-lennat | maxsim-cpu, f32 | 0.57 [0.52, 0.61] (0.45–0.54) | yes |
| M3 Max | warm sweep | q64-d1-lennat | NumPy, f32 | 0.72 [0.68, 0.75] (0.58–0.68) | yes |
| M3 Max | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.89 [0.88, 0.91] (0.87–0.95) | yes |
| M3 Max | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.89 [0.88, 0.91] (0.89–0.92) | yes |
| M3 Max | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.90 [0.89, 0.91] (0.88–0.93) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.31 [0.30, 0.31] (0.30–0.31) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.31 [0.31, 0.32] (0.30–0.32) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.31 [0.31, 0.32] (0.31–0.32) | yes |
| M3 Max | warm sweep | q64-d256-len512 | PyTorch, f32 | 0.93 [0.92, 0.94] (0.91–0.93) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NextPlaid, f32 | 0.98 [0.97, 0.98] (0.95–0.99) | yes |
| M3 Max | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.36 [0.35, 0.37] (0.35–0.37) | yes |
| M3 Max | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.36 [0.35, 0.37] (0.35–0.37) | yes |
| M3 Max | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.37 [0.36, 0.37] (0.37–0.37) | yes |
| M3 Max | warm sweep | q64-d256-lennat | PyTorch, f32 | 0.82 [0.81, 0.83] (0.81–0.82) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.19 [0.17, 0.22] (0.16–0.20) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.19 [0.17, 0.22] (0.16–0.21) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.19 [0.18, 0.22] (0.17–0.21) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | PyTorch, f32 | 0.62 [0.56, 0.71] (0.53–0.71) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NextPlaid, f32 | 0.75 [0.70, 0.81] (0.72–0.85) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumPy, f32 | 0.85 [0.77, 0.98] (0.73–1.14) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.25 [0.23, 0.27] (0.25–0.25) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.25 [0.23, 0.27] (0.24–0.26) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.27 [0.24, 0.29] (0.26–0.27) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | PyTorch, f32 | 0.79 [0.73, 0.85] (0.78–0.79) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NextPlaid, f32 | 0.87 [0.79, 0.95] (0.86–0.88) | yes |
| M3 Max | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.53 [0.51, 0.55] (0.53–0.57) | yes |
| M3 Max | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.54 [0.52, 0.56] (0.52–0.60) | yes |
| M3 Max | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.54 [0.52, 0.57] (0.53–0.58) | yes |
| M3 Max | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.66 [0.61, 0.72] (0.62–0.71) | yes |
| M3 Max | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.67 [0.64, 0.70] (0.65–0.73) | yes |
| M3 Max | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.73 [0.69, 0.76] (0.70–0.76) | yes |
| M3 Max | warm sweep | q8-d4096-len512 | NumKong (approx.), bf16 | 0.49 [0.48, 0.50] (0.43–0.51) | yes |
| M3 Max | warm sweep | q8-d4096-len512 | NumKong (approx.), f16 | 0.50 [0.49, 0.50] (0.43–0.52) | yes |
| M3 Max | warm sweep | q8-d4096-len512 | NumKong (approx.), f32 | 0.52 [0.51, 0.53] (0.45–0.53) | yes |
| M3 Max | warm sweep | q8-d4096-lennat | NumKong (approx.), bf16 | 0.57 [0.57, 0.58] (0.57–0.58) | yes |
| M3 Max | warm sweep | q8-d4096-lennat | NumKong (approx.), f16 | 0.58 [0.57, 0.58] (0.57–0.58) | yes |
| M3 Max | warm sweep | q8-d4096-lennat | NumKong (approx.), f32 | 0.62 [0.61, 0.63] (0.62–0.64) | yes |
