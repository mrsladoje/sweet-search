# Speed tables (held-out; agent-ho, gcsn-ho and sweep-ho previously examined; BEIR fresh)

ratio = rival / sweet kernel, geometric mean over calls; > 1 = sweet faster. [workload 95% CI: cluster bootstrap, 10,000 resamples, seed 42] (leave-one-process-out sensitivity: min–max of the ratio when one of the 5 process repetitions is left out; the frozen single-process range is in speed.json as spread_frozen).

## warm

### Intel — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.08 [1.07, 1.09] (1.08–1.08) | 1.08 | 98% | 1.7e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2004 | 11 | 5.14 [4.98, 5.34] (5.13–5.14) | 4.71 | 100% | 1.7e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed@t8` | 2004 | 11 | 1.69 [1.67, 1.70] (1.69–1.69) | 1.69 | 100% | 1.0e-07 | 99.9% | `numpy_packed@t8` 1.69; `numpy_packed` 1.89 |  |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | — | not run | | | | | | |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2004 | 11 | 1.39 [1.30, 1.46] (1.39–1.39) | 1.39 | 96% | 1.0e-07 | 99.9% | `torch_pad_bmm@t8` 1.39; `torch_pad_bmm` 1.39 | `torch_pad_flat` 2.00 |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 11 | 1.32 [1.18, 1.45] (1.32–1.32) | 1.17 | 81% | 9.3e-04 | 99.6% | `torch_pad_bmm_bf16` 1.32; `torch_pad_flat_bf16` 1.50 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 11 | 2.33 [2.25, 2.44] (2.32–2.34) | 2.10 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable` 2.33; `maxsim_cpu_variable@t8` 2.70 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 6.87 [6.67, 7.04] (6.85–6.88) | 7.32 | 100% | 1.6e-07 | 99.9% | `nextplaid@t1` 6.87; `nextplaid@t8` 7.50 | `nextplaid` 7.68 |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 0.70 [0.65, 0.77] (0.70–0.70) | 0.60 | 18% | 3.7e-02 | 97.4% | `numkong_native_bf16` 0.70; `numkong_bf16` 8.39 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.61 [0.60, 0.63] (0.61–0.61) | 0.70 | 3% | 7.8e-02 | 86.0% | `numkong_native_f16` 0.62; `numkong_native_f16@t1` 0.61 | `numkong_f16` 8.69 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 0.64 [0.59, 0.70] (0.64–0.64) | 0.54 | 13% | 7.8e-02 | 86.0% | `numkong_native_f32` 0.64; `numkong_f32` 8.66 |  |

### Intel — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.15 [1.15, 1.15] (1.14–1.16) | 1.14 | 100% | 2.4e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2378 | 2378 | 6.52 [6.48, 6.56] (6.48–6.57) | 6.34 | 100% | 2.4e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed@t8` | 2378 | 2378 | 1.82 [1.81, 1.82] (1.81–1.83) | 1.79 | 100% | 1.1e-07 | 100.0% | `numpy_packed@t8` 1.82; `numpy_packed` 2.17 |  |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | — | not run | | | | | | |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2378 | 2378 | 2.01 [1.99, 2.02] (2.00–2.02) | 1.96 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm@t8` 2.01; `torch_pad_bmm` 2.01 | `torch_pad_flat` 2.69 |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2378 | 2.16 [2.14, 2.17] (2.14–2.18) | 2.11 | 100% | 1.1e-03 | 100.0% | `torch_pad_flat_bf16` 2.16; `torch_pad_bmm_bf16` 2.23 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2378 | 2.70 [2.67, 2.72] (2.68–2.72) | 2.74 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable` 2.70; `maxsim_cpu_variable@t8` 2.97 |  |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 6.51 [6.43, 6.58] (6.40–6.66) | 7.08 | 100% | 2.0e-07 | 100.0% | `nextplaid` 6.51; `nextplaid@t8` 6.70 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 0.88 [0.88, 0.89] (0.88–0.89) | 0.85 | 27% | 2.7e-02 | 98.7% | `numkong_native_bf16` 0.88; `numkong_bf16` 14.70 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.72 [0.72, 0.73] (0.72–0.73) | 0.72 | 0% | 9.0e-02 | 94.5% | `numkong_native_f16@t1` 0.72; `numkong_f16@t1` 0.87 | `numkong_native_f16` 0.88 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 0.90 [0.89, 0.91] (0.89–0.91) | 0.86 | 31% | 9.0e-02 | 94.6% | `numkong_native_f32` 0.90; `numkong_f32` 15.60 |  |

### Intel — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.06 [1.06, 1.06] (1.06–1.06) | 1.05 | 97% | 3.4e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed@t8` | 6230 | 623 | 1.49 [1.49, 1.49] (1.49–1.49) | 1.51 | 100% | 1.1e-07 | 100.0% | `numpy_packed` 1.71; `numpy_packed@t8` 1.49 |  |
| NumPy (MKL), f32 | `numpy_packed+mkl` | — | — | not run | | | | | | |
| PyTorch, f32 | `torch_pad_flat` | 6230 | 623 | 0.62 [0.62, 0.62] (0.62–0.62) | 0.57 | 0% | 1.1e-07 | 100.0% | `torch_colbert_packed` 2.02; `torch_pad_flat` 0.62 | `torch_pad_bmm` 0.96 |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 6230 | 623 | 0.85 [0.85, 0.86] (0.85–0.86) | 0.66 | 39% | 2.6e-03 | 97.5% | `torch_pad_bmm_bf16` 0.85; `torch_pad_flat_bf16` 1.02 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 6230 | 623 | 1.48 [1.48, 1.48] (1.48–1.48) | 1.32 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable` 1.48; `maxsim_cpu_variable@t8` 1.91 |  |
| NextPlaid, f32 | `nextplaid@t8` | 6230 | 623 | 8.31 [8.28, 8.33] (8.29–8.31) | 8.99 | 100% | 3.2e-07 | 100.0% | `nextplaid@t8` 8.31; `nextplaid` 8.37 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 0.35 [0.34, 0.35] (0.35–0.35) | 0.27 | 0% | 4.0e-02 | 78.2% | `numkong_native_bf16` 0.35; `numkong_bf16` 5.71 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 0.33 [0.33, 0.33] (0.33–0.33) | 0.25 | 0% | 2.1e-01 | 57.8% | `numkong_native_f16` 0.33; `numkong_f16` 5.86 |  |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 0.34 [0.34, 0.34] (0.34–0.34) | 0.26 | 0% | 2.1e-01 | 57.7% | `numkong_native_f32` 0.34; `numkong_f32` 5.88 |  |

### AMD — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.17 [1.14, 1.22] (1.17–1.18) | 1.16 | 99% | 1.7e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2004 | 11 | 6.28 [6.07, 6.51] (6.26–6.30) | 5.94 | 100% | 1.7e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed_t` | 2004 | 11 | 4.02 [3.93, 4.11] (4.00–4.03) | 4.32 | 100% | 1.0e-07 | 99.9% | `numpy_packed` 4.46; `numpy_packed_t` 4.02 |  |
| NumPy (BLIS), f32 | `numpy_packed+blis` | 2004 | 11 | 48.10 [45.36, 50.03] (47.91–48.18) | 56.48 | 100% | 9.5e-08 | 99.9% | `numpy_packed@t1+blis` 48.14; `numpy_packed+blis` 48.10 |  |
| PyTorch, f32 | `torch_pad_bmm` | 2004 | 11 | 3.28 [3.13, 3.45] (3.27–3.29) | 3.28 | 100% | 1.0e-07 | 99.9% | `torch_pad_bmm` 3.28; `torch_pylate` 6.51 | `torch_pad_flat` 12.41 |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 11 | 3.10 [2.86, 3.34] (3.10–3.11) | 2.84 | 100% | 9.3e-04 | 99.6% | `torch_pad_bmm_bf16` 3.10; `torch_pad_flat_bf16` 4.04 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 11 | 4.13 [4.01, 4.25] (4.12–4.14) | 3.89 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable` 4.13; `maxsim_cpu_3d` 4.69 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 12.04 [11.49, 12.66] (12.00–12.07) | 13.51 | 100% | 1.6e-07 | 99.9% | `nextplaid@t1` 12.04; `nextplaid` 14.35 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 1.88 [1.74, 2.01] (1.87–1.89) | 1.75 | 97% | 8.0e-02 | 86.0% | `numkong_native_bf16` 1.88; `numkong_bf16` 11.36 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 1.85 [1.71, 1.97] (1.85–1.86) | 1.73 | 96% | 7.8e-02 | 86.2% | `numkong_native_f16` 1.85; `numkong_native_f16@t1` 3.98 | `numkong_f16` 10.74 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 1.73 [1.60, 1.85] (1.73–1.75) | 1.61 | 96% | 7.8e-02 | 86.0% | `numkong_native_f32` 1.73; `numkong_f32` 10.81 |  |

### AMD — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.23 [1.23, 1.24] (1.22–1.24) | 1.23 | 100% | 2.4e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2378 | 2378 | 7.10 [7.06, 7.14] (7.05–7.13) | 7.04 | 100% | 2.4e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed_t` | 2378 | 2378 | 4.30 [4.27, 4.33] (4.27–4.32) | 4.42 | 100% | 1.1e-07 | 100.0% | `numpy_packed_t` 4.30; `numpy_packed` 5.59 |  |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2378 | 2378 | 36.75 [36.45, 37.06] (36.54–36.95) | 39.23 | 100% | 1.1e-07 | 100.0% | `numpy_packed+blis` 36.80; `numpy_packed@t1+blis` 36.75 |  |
| PyTorch, f32 | `torch_pad_bmm` | 2378 | 2378 | 4.50 [4.47, 4.53] (4.47–4.52) | 4.60 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm` 4.50; `torch_pylate` 8.27 | `torch_pad_flat` 13.41 |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2378 | 2378 | 4.25 [4.23, 4.28] (4.22–4.29) | 4.17 | 100% | 1.1e-03 | 100.0% | `torch_pad_bmm_bf16` 4.25; `torch_pad_flat_bf16` 4.56 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2378 | 4.53 [4.50, 4.56] (4.51–4.55) | 4.60 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable` 4.53; `maxsim_cpu_3d` 6.25 |  |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 9.32 [9.16, 9.48] (9.17–9.43) | 10.65 | 100% | 2.0e-07 | 100.0% | `nextplaid` 9.32; `nextplaid@t1` 10.74 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 1.53 [1.52, 1.54] (1.51–1.54) | 1.56 | 100% | 9.0e-02 | 94.4% | `numkong_native_bf16` 1.53; `numkong_bf16` 17.96 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 2378 | 1.49 [1.48, 1.49] (1.48–1.50) | 1.52 | 100% | 9.0e-02 | 94.5% | `numkong_native_f16` 1.49; `numkong_native_f16@t1` 3.12 | `numkong_f16` 17.62 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 1.41 [1.40, 1.41] (1.38–1.42) | 1.42 | 100% | 9.0e-02 | 94.6% | `numkong_native_f32` 1.41; `numkong_f32` 17.89 |  |

### AMD — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.12 [1.12, 1.13] (1.12–1.12) | 1.14 | 94% | 3.4e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 6230 | 623 | 4.39 [4.36, 4.42] (4.37–4.38) | 3.89 | 100% | 1.1e-07 | 100.0% | `numpy_packed` 4.39; `numpy_packed_t` 4.89 |  |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 6230 | 623 | 51.39 [51.04, 51.71] (51.23–51.35) | 59.99 | 100% | 9.5e-08 | 100.0% | `numpy_packed+blis` 51.42; `numpy_packed@t1+blis` 51.39 |  |
| PyTorch, f32 | `torch_pad_bmm` | 6230 | 623 | 2.22 [2.20, 2.23] (2.21–2.21) | 2.01 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm` 2.22; `torch_pad_flat` 3.92 | `torch_pylate` 5.15 |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 6230 | 623 | 1.98 [1.96, 1.99] (1.97–1.98) | 1.69 | 100% | 2.6e-03 | 97.5% | `torch_pad_bmm_bf16` 1.98; `torch_pad_flat_bf16` 3.09 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 6230 | 623 | 3.14 [3.13, 3.16] (3.13–3.14) | 3.00 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable` 3.14; `maxsim_cpu_3d` 3.21 |  |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 16.04 [15.93, 16.14] (15.99–16.01) | 19.03 | 100% | 3.2e-07 | 100.0% | `nextplaid@t1` 16.04; `nextplaid` 16.40 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 1.11 [1.10, 1.12] (1.11–1.11) | 0.89 | 50% | 2.1e-01 | 58.3% | `numkong_native_bf16` 1.11; `numkong_bf16` 7.44 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 1.08 [1.07, 1.09] (1.08–1.09) | 0.87 | 47% | 2.1e-01 | 57.8% | `numkong_native_f16` 1.08; `numkong_f16` 7.19 |  |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 1.06 [1.05, 1.07] (1.06–1.06) | 0.86 | 44% | 2.1e-01 | 57.7% | `numkong_native_f32` 1.06; `numkong_f32` 7.17 |  |

### Graviton4 — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.15 [1.14, 1.17] (1.15–1.15) | 1.12 | 100% | 1.7e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2004 | 11 | 3.58 [3.39, 3.81] (3.57–3.59) | 3.17 | 100% | 1.7e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 2004 | 11 | 1.65 [1.63, 1.68] (1.65–1.66) | 1.62 | 100% | 1.0e-07 | 99.9% | `numpy_packed` 1.65; `numpy_packed_t` 2.28 | `numpy_perdoc` 6.28 |
| PyTorch, f32 | `torch_pad_flat` | 2004 | 11 | 3.02 [2.81, 3.27] (3.02–3.03) | 2.68 | 100% | 1.0e-07 | 99.9% | `torch_pad_flat` 3.02; `torch_pad_bmm` 3.99 | `torch_segment_reduce` 4.71 |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 11 | 3.62 [3.27, 4.04] (3.61–3.64) | 3.70 | 100% | 9.3e-04 | 99.6% | `torch_pad_bmm_bf16` 3.62; `torch_pad_flat_bf16` 3.83 |  |
| NextPlaid, f32 | `nextplaid` | 2004 | 11 | 2.71 [2.57, 2.88] (2.70–2.72) | 2.36 | 100% | 1.6e-07 | 99.9% | `nextplaid` 2.71; `nextplaid@t1` 12.06 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 0.82 [0.74, 0.94] (0.82–0.82) | 0.73 | 23% | 8.0e-02 | 86.0% | `numkong_native_bf16` 0.82; `numkong_bf16` 5.92 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 0.85 [0.77, 0.98] (0.85–0.86) | 0.76 | 23% | 7.8e-02 | 86.2% | `numkong_native_f16` 0.85; `numkong_native_f16@t1` 3.18 | `numkong_f16` 5.85 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 0.86 [0.78, 0.98] (0.86–0.86) | 0.77 | 23% | 7.8e-02 | 86.0% | `numkong_native_f32` 0.86; `numkong_f32` 5.79 |  |

### Graviton4 — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.22 [1.22, 1.22] (1.22–1.22) | 1.21 | 100% | 2.0e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2378 | 2378 | 5.39 [5.35, 5.43] (5.38–5.39) | 5.21 | 100% | 2.0e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 2378 | 2378 | 1.84 [1.83, 1.85] (1.84–1.84) | 1.82 | 100% | 1.1e-07 | 100.0% | `numpy_packed` 1.84; `numpy_packed_t` 2.20 | `numpy_perdoc` 8.78 |
| PyTorch, f32 | `torch_pad_flat` | 2378 | 2378 | 4.61 [4.58, 4.64] (4.60–4.62) | 4.50 | 100% | 1.1e-07 | 100.0% | `torch_pad_flat` 4.61; `torch_segment_reduce` 5.74 | `torch_pad_bmm` 6.75 |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2378 | 5.19 [5.15, 5.24] (5.17–5.21) | 5.04 | 100% | 1.1e-03 | 100.0% | `torch_pad_flat_bf16` 5.19; `torch_pad_bmm_bf16` 6.87 |  |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 3.23 [3.19, 3.26] (3.22–3.24) | 3.29 | 100% | 2.0e-07 | 100.0% | `nextplaid` 3.23; `nextplaid@t1` 11.34 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 0.90 [0.90, 0.91] (0.90–0.90) | 0.88 | 26% | 9.0e-02 | 94.4% | `numkong_native_bf16` 0.90; `numkong_bf16` 10.87 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 2378 | 0.94 [0.93, 0.94] (0.94–0.94) | 0.92 | 35% | 9.0e-02 | 94.5% | `numkong_native_f16` 0.94; `numkong_native_f16@t1` 2.97 | `numkong_f16` 10.83 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 0.95 [0.94, 0.95] (0.94–0.95) | 0.92 | 37% | 9.0e-02 | 94.6% | `numkong_native_f32` 0.95; `numkong_f32` 10.65 |  |

### Graviton4 — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.09 [1.09, 1.09] (1.09–1.09) | 1.06 | 100% | 3.3e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 6230 | 623 | 1.60 [1.59, 1.60] (1.59–1.60) | 1.57 | 100% | 1.1e-07 | 100.0% | `numpy_packed` 1.60; `numpy_perdoc` 6.24 | `numpy_packed_t` 3.95 |
| PyTorch, f32 | `torch_pad_flat` | 6230 | 623 | 1.61 [1.61, 1.62] (1.61–1.61) | 1.27 | 99% | 1.1e-07 | 100.0% | `torch_pad_flat` 1.61; `torch_colbert_packed` 5.44 | `torch_pad_bmm` 2.32 |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 6230 | 623 | 1.18 [1.18, 1.19] (1.18–1.18) | 0.86 | 44% | 2.6e-03 | 97.5% | `torch_pad_flat_bf16` 1.18; `torch_pad_bmm_bf16` 2.07 |  |
| NextPlaid, f32 | `nextplaid` | 6230 | 623 | 1.56 [1.56, 1.57] (1.56–1.56) | 1.27 | 100% | 3.2e-07 | 100.0% | `nextplaid` 1.56; `nextplaid@t1` 10.62 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 0.55 [0.55, 0.55] (0.55–0.55) | 0.43 | 20% | 2.1e-01 | 58.3% | `numkong_native_bf16` 0.55; `numkong_bf16` 3.93 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 0.58 [0.57, 0.58] (0.58–0.58) | 0.45 | 20% | 2.1e-01 | 57.8% | `numkong_native_f16` 0.58; `numkong_f16` 3.91 |  |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 0.60 [0.60, 0.60] (0.60–0.60) | 0.47 | 20% | 2.1e-01 | 57.7% | `numkong_native_f32` 0.60; `numkong_f32` 3.88 |  |

### M3 Max — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.08 [1.07, 1.10] (1.07–1.09) | 1.08 | 97% | 1.7e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2004 | 11 | 3.44 [3.17, 3.70] (3.33–3.56) | 3.03 | 100% | 1.7e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 2004 | 11 | 1.73 [1.56, 1.92] (1.61–1.84) | 1.72 | 99% | 1.0e-07 | 99.9% | `numpy_packed@t1` 1.74; `numpy_packed` 1.73 | `numpy_packed@t12` 1.74 |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 3.68 [3.35, 4.00] (3.41–3.90) | 3.82 | 100% | 1.0e-07 | 99.9% | `torch_pad_bmm@t1` 3.68; `torch_colbert_packed` 5.11 | `torch_pad_flat` 4.90 |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2004 | 11 | 7.69 [7.02, 8.47] (7.34–7.96) | 7.01 | 100% | 9.3e-04 | 99.6% | `torch_pad_flat_bf16` 7.69; `torch_pad_bmm_bf16` 20.34 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 5.57 [4.99, 6.14] (5.16–5.90) | 5.91 | 99% | 4.1e-02 | 100.0% | `maxsim_cpu_variable@t1` 5.57; `maxsim_cpu_3d` 7.34 | `maxsim_cpu_variable@t12` 8.47 |
| NextPlaid, f32 | `nextplaid` | 2004 | 11 | 3.33 [3.04, 3.59] (3.13–3.53) | 2.90 | 100% | 1.6e-07 | 99.9% | `nextplaid` 3.33; `nextplaid@t12` 3.49 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 1.54 [1.40, 1.66] (1.45–1.65) | 1.29 | 88% | 8.0e-02 | 86.0% | `numkong_native_bf16` 1.54; `numkong_bf16` 4.75 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 1.52 [1.38, 1.64] (1.42–1.62) | 1.27 | 88% | 7.8e-02 | 86.2% | `numkong_native_f16` 1.52; `numkong_native_f16@t1` 2.12 | `numkong_f16` 4.70 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 1.52 [1.39, 1.64] (1.42–1.63) | 1.28 | 88% | 7.8e-02 | 86.0% | `numkong_native_f32` 1.52; `numkong_f32` 4.68 |  |

### M3 Max — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.08 [1.08, 1.08] (1.08–1.08) | 1.07 | 100% | 2.0e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2378 | 2378 | 4.80 [4.77, 4.84] (4.80–4.82) | 4.64 | 100% | 2.0e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed@t12` | 2378 | 2378 | 2.14 [2.13, 2.16] (2.14–2.15) | 2.08 | 100% | 1.1e-07 | 100.0% | `numpy_packed@t1` 2.14; `numpy_packed@t12` 2.14 | `numpy_packed` 2.14 |
| PyTorch, f32 | `torch_segment_reduce` | 2378 | 2378 | 5.31 [5.29, 5.32] (5.29–5.32) | 5.38 | 100% | 1.1e-07 | 100.0% | `torch_segment_reduce` 5.31; `torch_pad_bmm@t1` 6.96 | `torch_colbert_packed` 8.33 |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2378 | 11.27 [11.19, 11.34] (11.24–11.29) | 11.05 | 100% | 1.1e-03 | 100.0% | `torch_pad_flat_bf16` 11.27; `torch_pad_bmm_bf16` 43.93 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 7.27 [7.22, 7.33] (7.25–7.30) | 7.08 | 100% | 3.4e-02 | 100.0% | `maxsim_cpu_variable@t1` 7.27; `maxsim_cpu_3d` 13.57 | `maxsim_cpu_variable@t12` 16.62 |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 5.20 [5.16, 5.24] (5.19–5.22) | 5.01 | 100% | 2.0e-07 | 100.0% | `nextplaid` 5.20; `nextplaid@t12` 6.13 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 2.74 [2.71, 2.77] (2.74–2.77) | 2.62 | 100% | 9.0e-02 | 94.4% | `numkong_native_bf16` 2.74; `numkong_bf16` 9.75 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 2.41 [2.39, 2.42] (2.40–2.41) | 2.48 | 100% | 9.0e-02 | 94.5% | `numkong_native_f16@t1` 2.41; `numkong_f16@t1` 2.68 | `numkong_native_f16` 2.72 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 2.74 [2.71, 2.77] (2.74–2.77) | 2.62 | 100% | 9.0e-02 | 94.6% | `numkong_native_f32` 2.74; `numkong_f32` 9.73 |  |

### M3 Max — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.06 [1.05, 1.06] (1.05–1.07) | 1.06 | 99% | 3.3e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 6230 | 623 | 1.48 [1.47, 1.48] (1.46–1.48) | 1.43 | 100% | 1.1e-07 | 100.0% | `numpy_packed@t12` 1.48; `numpy_packed` 1.48 |  |
| PyTorch, f32 | `torch_pad_flat` | 6230 | 623 | 1.92 [1.91, 1.93] (1.90–1.92) | 1.48 | 87% | 1.1e-07 | 100.0% | `torch_colbert_packed` 2.57; `torch_pad_flat` 1.92 | `torch_segment_reduce` 5.66 |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 6230 | 623 | 4.29 [4.28, 4.30] (4.28–4.30) | 3.74 | 100% | 2.6e-03 | 97.5% | `torch_pad_flat_bf16` 4.29; `torch_pad_bmm_bf16` 24.59 |  |
| maxsim-cpu, f32 | `maxsim_cpu_3d` | 6230 | 623 | 4.41 [4.40, 4.42] (4.38–4.42) | 4.07 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable@t12` 6.26; `maxsim_cpu_3d` 4.41 |  |
| NextPlaid, f32 | `nextplaid` | 6230 | 623 | 2.34 [2.33, 2.34] (2.32–2.34) | 1.89 | 100% | 3.2e-07 | 100.0% | `nextplaid` 2.34; `nextplaid@t12` 2.57 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 0.99 [0.99, 0.99] (0.99–0.99) | 0.71 | 41% | 2.1e-01 | 58.3% | `numkong_native_bf16` 0.99; `numkong_bf16` 4.83 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 0.99 [0.98, 0.99] (0.98–0.99) | 0.71 | 41% | 2.1e-01 | 57.8% | `numkong_native_f16` 0.99; `numkong_f16` 4.82 |  |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 1.00 [1.00, 1.00] (1.00–1.01) | 0.72 | 41% | 2.1e-01 | 57.7% | `numkong_native_f32` 1.00; `numkong_f32` 4.81 |  |

### EPYC — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2004 | 11 | 1.16 [1.15, 1.18] (1.16–1.16) | 1.16 | 100% | 1.7e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2004 | 11 | 4.16 [4.04, 4.29] (4.15–4.20) | 3.81 | 100% | 1.7e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 2004 | 11 | 1.44 [1.40, 1.47] (1.44–1.45) | 1.38 | 99% | 6.9e-08 | 99.9% | `numpy_packed` 1.44; `numpy_packed@t4` 1.55 |  |
| PyTorch, f32 | `torch_pad_bmm` | 2004 | 11 | 1.87 [1.76, 1.97] (1.87–1.89) | 1.92 | 100% | 1.0e-07 | 99.9% | `torch_pad_bmm` 1.87; `torch_pad_bmm@t4` 1.87 |  |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 11 | 12.64 [12.06, 13.21] (12.64–12.73) | 13.12 | 100% | 9.3e-04 | 99.6% | `torch_pad_bmm_bf16` 12.64; `torch_pad_flat_bf16` 14.57 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 11 | 2.44 [2.40, 2.51] (2.44–2.46) | 2.29 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable` 2.44; `maxsim_cpu_variable@t4` 3.18 |  |
| NextPlaid, f32 | `nextplaid` | 2004 | 11 | 4.08 [3.92, 4.22] (4.08–4.11) | 4.10 | 100% | 1.5e-07 | 99.9% | `nextplaid` 4.08; `nextplaid@t4` 4.08 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 11 | 1.67 [1.62, 1.72] (1.67–1.68) | 1.48 | 99% | 8.0e-02 | 86.1% | `numkong_native_bf16` 1.67; `numkong_bf16` 5.99 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 11 | 1.67 [1.62, 1.73] (1.67–1.68) | 1.48 | 99% | 7.8e-02 | 86.4% | `numkong_native_f16` 1.67; `numkong_native_f16@t1` 2.36 | `numkong_f16` 6.12 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 11 | 1.69 [1.64, 1.75] (1.69–1.70) | 1.50 | 99% | 7.8e-02 | 86.4% | `numkong_native_f32` 1.69; `numkong_f32` 6.17 |  |

### EPYC — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 2378 | 2378 | 1.22 [1.21, 1.22] (1.20–1.24) | 1.19 | 95% | 2.4e-07 | 100.0% |  |  |
| previous production path | `node-legacy` | 2378 | 2378 | 5.10 [5.06, 5.14] (5.09–5.11) | 4.83 | 100% | 2.4e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed` | 2378 | 2378 | 1.59 [1.58, 1.60] (1.58–1.60) | 1.52 | 98% | 1.1e-07 | 100.0% | `numpy_packed` 1.59; `numpy_packed@t4` 1.65 |  |
| PyTorch, f32 | `torch_pad_bmm` | 2378 | 2378 | 2.81 [2.79, 2.84] (2.80–2.82) | 2.71 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm@t4` 2.81; `torch_pad_bmm` 2.81 |  |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2378 | 2378 | 20.56 [20.36, 20.75] (20.51–20.62) | 20.58 | 100% | 1.1e-03 | 100.0% | `torch_pad_bmm_bf16` 20.56; `torch_pad_flat_bf16` 23.02 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2378 | 2.70 [2.69, 2.72] (2.70–2.71) | 2.69 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable` 2.70; `maxsim_cpu_variable@t4` 3.75 |  |
| NextPlaid, f32 | `nextplaid` | 2378 | 2378 | 3.49 [3.44, 3.53] (3.47–3.50) | 3.71 | 100% | 1.9e-07 | 100.0% | `nextplaid@t4` 3.52; `nextplaid` 3.49 |  |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2378 | 1.87 [1.86, 1.88] (1.87–1.87) | 1.84 | 99% | 8.9e-02 | 94.1% | `numkong_native_bf16` 1.87; `numkong_bf16` 14.00 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 2378 | 1.88 [1.86, 1.89] (1.87–1.88) | 1.84 | 99% | 9.0e-02 | 94.3% | `numkong_native_f16` 1.88; `numkong_native_f16@t1` 2.35 | `numkong_f16` 13.79 |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2378 | 1.91 [1.90, 1.92] (1.91–1.92) | 1.88 | 99% | 9.0e-02 | 94.2% | `numkong_native_f32` 1.91; `numkong_f32` 13.79 |  |

### EPYC — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| sweet, production path (Node) | `node-production` | 6230 | 623 | 1.15 [1.14, 1.15] (1.15–1.15) | 1.12 | 83% | 3.4e-07 | 100.0% |  |  |
| NumPy, f32 | `numpy_packed@t4` | 6230 | 623 | 1.12 [1.11, 1.12] (1.12–1.12) | 1.13 | 88% | 6.8e-08 | 100.0% | `numpy_packed` 1.14; `numpy_packed@t4` 1.12 |  |
| PyTorch, f32 | `torch_pad_bmm` | 6230 | 623 | 1.30 [1.30, 1.31] (1.30–1.30) | 1.29 | 98% | 1.1e-07 | 100.0% | `torch_pad_bmm` 1.30; `torch_pad_bmm@t4` 1.30 |  |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 6230 | 623 | 11.45 [11.38, 11.51] (11.43–11.45) | 12.00 | 100% | 2.6e-03 | 97.5% | `torch_pad_bmm_bf16` 11.45; `torch_pad_flat_bf16` 11.58 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 6230 | 623 | 2.29 [2.29, 2.30] (2.29–2.30) | 2.17 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable` 2.29; `maxsim_cpu_variable@t4` 3.10 |  |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 4.13 [4.11, 4.15] (4.12–4.13) | 4.28 | 100% | 3.3e-07 | 100.0% | `nextplaid@t1` 4.13; `nextplaid` 5.81 | `nextplaid@t4` 6.27 |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 6230 | 623 | 1.32 [1.31, 1.33] (1.32–1.32) | 1.25 | 97% | 2.1e-01 | 57.8% | `numkong_native_bf16` 1.32; `numkong_bf16` 3.73 |  |
| NumKong (approx.), f16 | `numkong_native_f16` | 6230 | 623 | 1.32 [1.31, 1.33] (1.32–1.32) | 1.25 | 97% | 2.1e-01 | 57.4% | `numkong_native_f16` 1.32; `numkong_f16` 3.67 |  |
| NumKong (approx.), f32 | `numkong_native_f32` | 6230 | 623 | 1.34 [1.33, 1.35] (1.34–1.35) | 1.28 | 96% | 2.1e-01 | 57.6% | `numkong_native_f32` 1.34; `numkong_f32` 3.66 |  |

## single

### Intel — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.14 [1.12, 1.15] (1.13–1.14) | 1.14 | 88% | 1.0e-07 | 99.9% | `numpy_packed@t1` 1.14 |  |
| NumPy (MKL), f32 | `numpy_packed@t1+mkl` | — | — | not run | | | | | | |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 1.40 [1.32, 1.48] (1.40–1.40) | 1.42 | 94% | 1.0e-07 | 99.9% | `torch_pad_bmm@t1` 1.40 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 1.55 [1.54, 1.57] (1.54–1.56) | 1.55 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable@t1` 1.55 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.16 [1.11, 1.21] (1.16–1.17) | 1.13 | 93% | 1.6e-07 | 99.9% | `nextplaid@t1` 1.16 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.10 [0.10, 0.11] (0.10–0.10) | 0.11 | 0% | 7.8e-02 | 86.0% | `numkong_native_f16@t1` 0.10 | `numkong_f16@t1` 0.12 |

### Intel — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 1.26 [1.25, 1.27] (1.25–1.27) | 1.21 | 94% | 1.1e-07 | 100.0% | `numpy_packed@t1` 1.26 |  |
| NumPy (MKL), f32 | `numpy_packed@t1+mkl` | — | — | not run | | | | | | |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 2.67 [2.64, 2.70] (2.64–2.69) | 2.55 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 2.67 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 1.71 [1.71, 1.72] (1.68–1.75) | 1.68 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable@t1` 1.71 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.63 [1.63, 1.64] (1.62–1.65) | 1.59 | 100% | 2.0e-07 | 100.0% | `nextplaid@t1` 1.63 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.15 [0.15, 0.15] (0.15–0.15) | 0.15 | 0% | 9.0e-02 | 94.5% | `numkong_native_f16@t1` 0.15 | `numkong_f16@t1` 0.18 |

### Intel — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 0.83 [0.83, 0.83] (0.83–0.83) | 0.83 | 1% | 1.1e-07 | 100.0% | `numpy_packed@t1` 0.83 |  |
| NumPy (MKL), f32 | `numpy_packed@t1+mkl` | — | — | not run | | | | | | |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 0.85 [0.85, 0.85] (0.85–0.85) | 0.87 | 7% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 0.85 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 6230 | 623 | 1.56 [1.55, 1.56] (1.55–1.56) | 1.56 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable@t1` 1.56 |  |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 1.37 [1.37, 1.37] (1.37–1.37) | 1.38 | 100% | 3.2e-07 | 100.0% | `nextplaid@t1` 1.37 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.12 [0.12, 0.12] (0.12–0.12) | 0.14 | 0% | 2.1e-01 | 57.8% | `numkong_native_f16@t1` 0.12 | `numkong_f16@t1` 0.15 |

### AMD — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.08 [1.06, 1.10] (1.08–1.08) | 1.06 | 69% | 1.0e-07 | 99.9% | `numpy_packed@t1` 1.08 |  |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2004 | 11 | 5.80 [5.73, 5.85] (5.79–5.80) | 5.93 | 100% | 9.5e-08 | 99.9% | `numpy_packed@t1+blis` 5.80 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 2.02 [1.91, 2.13] (2.02–2.02) | 2.09 | 100% | 1.0e-07 | 99.9% | `torch_pad_bmm@t1` 2.02 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 2.60 [2.57, 2.63] (2.59–2.61) | 2.64 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable@t1` 2.60 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.45 [1.37, 1.51] (1.45–1.45) | 1.42 | 100% | 1.6e-07 | 99.9% | `nextplaid@t1` 1.45 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.48 [0.47, 0.48] (0.48–0.48) | 0.49 | 0% | 7.8e-02 | 86.2% | `numkong_native_f16@t1` 0.48 |  |

### AMD — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 1.06 [1.05, 1.07] (1.06–1.06) | 1.02 | 55% | 1.1e-07 | 100.0% | `numpy_packed@t1` 1.06 |  |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2378 | 2378 | 5.32 [5.31, 5.34] (5.30–5.34) | 5.37 | 100% | 1.1e-07 | 100.0% | `numpy_packed@t1+blis` 5.32 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 3.08 [3.06, 3.11] (3.07–3.09) | 3.02 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 3.08 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 2.46 [2.45, 2.47] (2.45–2.47) | 2.48 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable@t1` 2.46 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.56 [1.55, 1.56] (1.55–1.56) | 1.56 | 100% | 2.0e-07 | 100.0% | `nextplaid@t1` 1.56 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.45 [0.45, 0.45] (0.45–0.45) | 0.46 | 0% | 9.0e-02 | 94.5% | `numkong_native_f16@t1` 0.45 |  |

### AMD — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 0.77 [0.77, 0.77] (0.77–0.77) | 0.76 | 1% | 1.1e-07 | 100.0% | `numpy_packed@t1` 0.77 |  |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 6230 | 623 | 5.41 [5.40, 5.42] (5.40–5.42) | 5.36 | 100% | 9.5e-08 | 100.0% | `numpy_packed@t1+blis` 5.41 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 1.42 [1.42, 1.43] (1.42–1.43) | 1.43 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 1.42 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 6230 | 623 | 2.87 [2.86, 2.87] (2.87–2.87) | 2.88 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable@t1` 2.87 |  |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 1.69 [1.68, 1.69] (1.68–1.69) | 1.70 | 100% | 3.2e-07 | 100.0% | `nextplaid@t1` 1.69 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.55 [0.55, 0.55] (0.55–0.55) | 0.56 | 0% | 2.1e-01 | 57.8% | `numkong_native_f16@t1` 0.55 |  |

### Graviton4 — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.16 [1.16, 1.16] (1.16–1.16) | 1.19 | 100% | 1.0e-07 | 99.9% | `numpy_packed@t1` 1.16 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 1.54 [1.29, 1.81] (1.54–1.54) | 1.39 | 82% | 1.0e-07 | 99.9% | `torch_pad_bmm@t1` 1.54 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.12 [1.10, 1.13] (1.12–1.12) | 1.09 | 94% | 1.6e-07 | 99.9% | `nextplaid@t1` 1.12 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.29 [0.29, 0.30] (0.29–0.30) | 0.31 | 0% | 7.8e-02 | 86.2% | `numkong_native_f16@t1` 0.29 |  |

### Graviton4 — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 1.17 [1.17, 1.17] (1.17–1.17) | 1.17 | 100% | 1.1e-07 | 100.0% | `numpy_packed@t1` 1.17 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 2.86 [2.82, 2.91] (2.86–2.87) | 2.76 | 99% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 2.86 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.18 [1.17, 1.18] (1.18–1.18) | 1.16 | 99% | 2.0e-07 | 100.0% | `nextplaid@t1` 1.18 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.31 [0.31, 0.31] (0.31–0.31) | 0.31 | 0% | 9.0e-02 | 94.5% | `numkong_native_f16@t1` 0.31 |  |

### Graviton4 — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 1.29 [1.29, 1.29] (1.29–1.29) | 1.33 | 100% | 1.1e-07 | 100.0% | `numpy_packed@t1` 1.29 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 0.83 [0.83, 0.84] (0.83–0.83) | 0.76 | 19% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 0.83 |  |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 0.98 [0.98, 0.98] (0.98–0.98) | 0.98 | 16% | 3.2e-07 | 100.0% | `nextplaid@t1` 0.98 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.32 [0.32, 0.32] (0.32–0.32) | 0.33 | 0% | 2.1e-01 | 57.8% | `numkong_native_f16@t1` 0.32 |  |

### M3 Max — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 0.24 [0.23, 0.25] (0.24–0.24) | 0.22 | 0% | 1.0e-07 | 99.9% | `numpy_packed@t1` 0.24 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 0.51 [0.47, 0.55] (0.51–0.51) | 0.49 | 2% | 1.0e-07 | 99.9% | `torch_pad_bmm@t1` 0.51 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 0.77 [0.75, 0.80] (0.77–0.78) | 0.75 | 9% | 4.1e-02 | 100.0% | `maxsim_cpu_variable@t1` 0.77 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.25 [1.24, 1.27] (1.25–1.25) | 1.23 | 100% | 1.6e-07 | 99.9% | `nextplaid@t1` 1.25 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.30 [0.29, 0.30] (0.29–0.30) | 0.30 | 0% | 7.8e-02 | 86.2% | `numkong_native_f16@t1` 0.30 | `numkong_f16@t1` 0.32 |

### M3 Max — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 0.28 [0.28, 0.28] (0.28–0.28) | 0.26 | 0% | 1.1e-07 | 100.0% | `numpy_packed@t1` 0.28 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 0.91 [0.90, 0.92] (0.91–0.91) | 0.85 | 39% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 0.91 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 0.95 [0.94, 0.96] (0.95–0.95) | 0.89 | 41% | 3.4e-02 | 100.0% | `maxsim_cpu_variable@t1` 0.95 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.34 [1.34, 1.35] (1.34–1.34) | 1.31 | 100% | 2.0e-07 | 100.0% | `nextplaid@t1` 1.34 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.31 [0.31, 0.32] (0.31–0.31) | 0.31 | 0% | 9.0e-02 | 94.5% | `numkong_native_f16@t1` 0.31 | `numkong_f16@t1` 0.35 |

### M3 Max — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 0.16 [0.16, 0.16] (0.16–0.16) | 0.14 | 0% | 1.1e-07 | 100.0% | `numpy_packed@t1` 0.16 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 0.31 [0.31, 0.31] (0.31–0.31) | 0.31 | 0% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 0.31 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 6230 | 623 | 0.50 [0.50, 0.50] (0.50–0.50) | 0.50 | 0% | 7.6e-02 | 100.0% | `maxsim_cpu_variable@t1` 0.50 |  |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 1.06 [1.06, 1.06] (1.06–1.06) | 1.06 | 100% | 3.2e-07 | 100.0% | `nextplaid@t1` 1.06 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.26 [0.26, 0.26] (0.26–0.27) | 0.26 | 0% | 2.1e-01 | 57.8% | `numkong_native_f16@t1` 0.26 | `numkong_f16@t1` 0.28 |

### EPYC — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2004 | 11 | 1.11 [1.10, 1.12] (1.08–1.17) | 1.10 | 84% | 1.0e-07 | 98.7% | `numpy_packed@t1` 1.11 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 11 | 1.51 [1.43, 1.59] (1.46–1.58) | 1.55 | 100% | 1.0e-07 | 99.9% | `torch_pad_bmm@t1` 1.51 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 11 | 2.31 [2.29, 2.33] (2.23–2.42) | 2.30 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable@t1` 2.31 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 11 | 1.22 [1.16, 1.27] (1.18–1.27) | 1.17 | 82% | 1.5e-07 | 99.9% | `nextplaid@t1` 1.22 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 11 | 0.60 [0.60, 0.61] (0.58–0.63) | 0.61 | 0% | 7.8e-02 | 86.4% | `numkong_native_f16@t1` 0.60 |  |

### EPYC — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 2378 | 2378 | 1.23 [1.22, 1.23] (1.22–1.23) | 1.20 | 92% | 1.1e-07 | 100.0% | `numpy_packed@t1` 1.23 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2378 | 2378 | 2.65 [2.62, 2.67] (2.64–2.65) | 2.58 | 100% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 2.65 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2378 | 2.51 [2.50, 2.52] (2.51–2.51) | 2.51 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable@t1` 2.51 |  |
| NextPlaid, f32 | `nextplaid@t1` | 2378 | 2378 | 1.73 [1.71, 1.74] (1.72–1.73) | 1.64 | 100% | 1.9e-07 | 100.0% | `nextplaid@t1` 1.73 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 2378 | 0.64 [0.63, 0.64] (0.64–0.64) | 0.65 | 0% | 9.0e-02 | 94.3% | `numkong_native_f16@t1` 0.64 |  |

### EPYC — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, f32 | `numpy_packed@t1` | 6230 | 623 | 0.88 [0.88, 0.88] (0.88–0.88) | 0.86 | 11% | 1.1e-07 | 99.8% | `numpy_packed@t1` 0.88 |  |
| PyTorch, f32 | `torch_pad_bmm@t1` | 6230 | 623 | 1.15 [1.14, 1.15] (1.15–1.15) | 1.17 | 85% | 1.1e-07 | 100.0% | `torch_pad_bmm@t1` 1.15 |  |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 6230 | 623 | 2.63 [2.63, 2.64] (2.63–2.64) | 2.60 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable@t1` 2.63 |  |
| NextPlaid, f32 | `nextplaid@t1` | 6230 | 623 | 1.07 [1.07, 1.08] (1.07–1.07) | 1.05 | 74% | 3.3e-07 | 100.0% | `nextplaid@t1` 1.07 |  |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 6230 | 623 | 0.66 [0.66, 0.66] (0.66–0.66) | 0.64 | 0% | 2.1e-01 | 57.4% | `numkong_native_f16@t1` 0.66 |  |

## int4

### Intel — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 20.82 [20.24, 21.28] (20.72–20.91) | 22.16 | 100% | 1.0e-07 | 99.9% | `numpy_packed_int4` 20.82 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2004 | 11 | 25.15 [24.53, 25.54] (25.11–25.19) | 25.44 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable_int4` 25.15 |  |

### Intel — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 19.36 [19.22, 19.51] (19.25–19.49) | 19.05 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 19.36 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2378 | 2378 | 23.30 [23.13, 23.48] (23.16–23.50) | 22.92 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable_int4` 23.30 |  |

### Intel — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 12.69 [12.64, 12.73] (12.68–12.71) | 12.87 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 12.69 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 6230 | 623 | 13.17 [13.14, 13.20] (13.16–13.19) | 13.32 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable_int4` 13.17 |  |

### AMD — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 34.69 [33.45, 35.66] (34.60–34.78) | 37.36 | 100% | 1.0e-07 | 99.9% | `numpy_packed_int4` 34.69 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2004 | 11 | 37.60 [36.34, 38.63] (37.52–37.66) | 39.50 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable_int4` 37.60 |  |

### AMD — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 30.60 [30.44, 30.77] (30.38–30.78) | 30.56 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 30.60 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2378 | 2378 | 32.64 [32.46, 32.82] (32.46–32.86) | 32.43 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable_int4` 32.64 |  |

### AMD — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 22.65 [22.50, 22.79] (22.59–22.63) | 23.57 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 22.65 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 6230 | 623 | 22.11 [21.97, 22.24] (22.05–22.08) | 23.71 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable_int4` 22.11 |  |

### Graviton4 — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 22.10 [21.73, 22.33] (22.08–22.13) | 22.78 | 100% | 1.0e-07 | 99.9% | `numpy_packed_int4` 22.10 |  |

### Graviton4 — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 21.47 [21.33, 21.62] (21.44–21.50) | 21.15 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 21.47 |  |

### Graviton4 — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 14.20 [14.16, 14.25] (14.19–14.20) | 14.18 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 14.20 |  |

### M3 Max — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 18.12 [16.17, 20.18] (16.81–19.21) | 18.70 | 100% | 1.0e-07 | 99.9% | `numpy_packed_int4` 18.12 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2004 | 11 | 26.87 [24.13, 29.53] (24.99–28.40) | 27.49 | 100% | 4.1e-02 | 100.0% | `maxsim_cpu_variable_int4` 26.87 |  |

### M3 Max — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 19.97 [19.81, 20.13] (19.91–20.01) | 19.51 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 19.97 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2378 | 2378 | 39.23 [38.89, 39.58] (39.13–39.32) | 37.65 | 100% | 3.4e-02 | 100.0% | `maxsim_cpu_variable_int4` 39.23 |  |

### M3 Max — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 12.44 [12.42, 12.46] (12.34–12.47) | 13.20 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 12.44 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 6230 | 623 | 18.90 [18.86, 18.94] (18.74–18.94) | 18.64 | 100% | 7.6e-02 | 100.0% | `maxsim_cpu_variable_int4` 18.90 |  |

### EPYC — agent-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2004 | 11 | 10.88 [10.48, 11.11] (10.88–10.98) | 10.92 | 100% | 6.9e-08 | 99.9% | `numpy_packed_int4` 10.88 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2004 | 11 | 14.40 [13.75, 15.05] (14.49–14.71) | 13.59 | 100% | 1.6e-07 | 99.9% | `maxsim_cpu_variable_int4` 14.40 |  |

### EPYC — gcsn-ho
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 2378 | 2378 | 11.60 [11.48, 11.72] (11.57–11.64) | 10.89 | 100% | 1.1e-07 | 100.0% | `numpy_packed_int4` 11.60 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 2378 | 2378 | 17.98 [17.76, 18.19] (18.05–18.37) | 17.28 | 100% | 1.7e-07 | 100.0% | `maxsim_cpu_variable_int4` 17.98 |  |

### EPYC — beir
| config | arm | calls | clusters | ratio [CI] (leave-one-process-out sensitivity) | total-time ratio | sweet faster on | max err | top-1 = S | each frozen configuration | fastest non-frozen configuration |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|
| NumPy, int4-self | `numpy_packed_int4` | 6230 | 623 | 6.71 [6.66, 6.75] (6.70–6.71) | 6.35 | 100% | 6.8e-08 | 100.0% | `numpy_packed_int4` 6.71 |  |
| maxsim-cpu, int4-self | `maxsim_cpu_variable_int4` | 6230 | 623 | 8.02 [7.97, 8.08] (8.02–8.07) | 7.86 | 100% | 3.2e-07 | 100.0% | `maxsim_cpu_variable_int4` 8.02 |  |

## pool-parked (5 ms busy gap before each call)

### Intel — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.03 [1.02, 1.04] (1.03–1.03) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 0.62 [0.61, 0.63] (0.62–0.62) |
| NumPy, f32 | `numpy_packed@t8` | 2004 | 0.61 [0.58, 0.64] (0.61–0.61) |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | not run |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2004 | 1.69 [1.61, 1.77] (1.68–1.69) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 1.65 [1.55, 1.75] (1.64–1.65) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 2.22 [2.17, 2.29] (2.22–2.23) |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 2.50 [2.39, 2.58] (2.49–2.51) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 1.12 [0.99, 1.24] (1.08–1.14) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 0.26 [0.24, 0.27] (0.25–0.26) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 1.07 [0.97, 1.16] (1.01–1.11) |

### Intel — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.01 [1.00, 1.02] (1.00–1.02) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 0.63 [0.62, 0.63] (0.62–0.63) |
| NumPy, f32 | `numpy_packed@t8` | 2378 | 0.50 [0.50, 0.50] (0.50–0.50) |
| NumPy (MKL), f32 | `numpy_packed@t8+mkl` | — | not run |
| PyTorch, f32 | `torch_pad_bmm@t8` | 2378 | 2.10 [2.08, 2.12] (2.09–2.10) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2.15 [2.13, 2.18] (2.15–2.16) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2.47 [2.46, 2.49] (2.47–2.48) |
| NextPlaid, f32 | `nextplaid@t8` | 2378 | 1.88 [1.87, 1.90] (1.87–1.89) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 1.35 [1.33, 1.37] (1.30–1.34) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 0.21 [0.21, 0.21] (0.21–0.21) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 1.27 [1.24, 1.29] (1.19–1.31) |

### Intel — beir (8 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2492 | 1.03 [1.03, 1.03] (1.03–1.03) |
| sweet, production path + prewarm | `node-prewarm` | 2492 | 0.70 [0.70, 0.70] (0.70–0.70) |
| NumPy, f32 | `numpy_packed@t8` | 2492 | 0.79 [0.79, 0.79] (0.79–0.79) |
| NumPy (MKL), f32 | `numpy_packed+mkl` | — | not run |
| PyTorch, f32 | `torch_pad_flat` | 2492 | 1.01 [1.00, 1.01] (1.01–1.01) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2492 | 1.12 [1.12, 1.12] (1.12–1.12) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2492 | 1.70 [1.70, 1.71] (1.70–1.71) |
| NextPlaid, f32 | `nextplaid@t8` | 2492 | 4.35 [4.34, 4.36] (4.34–4.36) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2492 | 0.78 [0.77, 0.79] (0.76–0.78) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2492 | 0.80 [0.79, 0.80] (0.76–0.80) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2492 | 0.82 [0.81, 0.82] (0.80–0.82) |

### AMD — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.11 [1.09, 1.12] (1.09–1.11) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 0.88 [0.86, 0.90] (0.87–0.88) |
| NumPy, f32 | `numpy_packed_t` | 2004 | 1.40 [1.34, 1.46] (1.39–1.41) |
| NumPy (BLIS), f32 | `numpy_packed+blis` | 2004 | 16.38 [14.96, 17.70] (16.31–16.42) |
| PyTorch, f32 | `torch_pad_bmm` | 2004 | 1.50 [1.47, 1.55] (1.50–1.51) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 1.48 [1.42, 1.55] (1.48–1.49) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 2.38 [2.33, 2.44] (2.37–2.39) |
| NextPlaid, f32 | `nextplaid@t1` | 2004 | 4.20 [3.94, 4.41] (4.18–4.21) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 1.43 [1.38, 1.48] (1.42–1.43) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 1.36 [1.25, 1.47] (1.36–1.37) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 1.44 [1.39, 1.48] (1.43–1.44) |

### AMD — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.11 [1.11, 1.11] (1.11–1.12) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 0.91 [0.91, 0.91] (0.90–0.92) |
| NumPy, f32 | `numpy_packed_t` | 2378 | 1.34 [1.33, 1.35] (1.33–1.34) |
| NumPy (BLIS), f32 | `numpy_packed@t1+blis` | 2378 | 11.11 [10.99, 11.23] (11.03–11.16) |
| PyTorch, f32 | `torch_pad_bmm` | 2378 | 1.83 [1.82, 1.84] (1.82–1.84) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 1.82 [1.82, 1.83] (1.81–1.83) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2.63 [2.62, 2.64] (2.61–2.65) |
| NextPlaid, f32 | `nextplaid` | 2378 | 3.23 [3.19, 3.28] (3.21–3.24) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 1.78 [1.77, 1.79] (1.76–1.79) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 0.96 [0.95, 0.97] (0.95–0.96) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 1.78 [1.77, 1.79] (1.76–1.80) |

### AMD — beir (8 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2492 | 1.17 [1.16, 1.17] (1.16–1.17) |
| sweet, production path + prewarm | `node-prewarm` | 2492 | 0.90 [0.89, 0.90] (0.89–0.90) |
| NumPy, f32 | `numpy_packed` | 2492 | 2.06 [2.05, 2.07] (2.05–2.07) |
| NumPy (BLIS), f32 | `numpy_packed+blis` | 2492 | 25.24 [25.11, 25.37] (25.09–25.33) |
| PyTorch, f32 | `torch_pad_bmm` | 2492 | 1.27 [1.27, 1.28] (1.27–1.28) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2492 | 1.18 [1.18, 1.19] (1.17–1.19) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2492 | 2.07 [2.06, 2.08] (2.06–2.08) |
| NextPlaid, f32 | `nextplaid` | 2492 | 7.76 [7.73, 7.80] (7.71–7.79) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2492 | 1.12 [1.11, 1.12] (1.11–1.12) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2492 | 1.13 [1.13, 1.13] (1.12–1.13) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2492 | 1.15 [1.14, 1.15] (1.14–1.15) |

### Graviton4 — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.16 [1.15, 1.17] (1.16–1.16) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 1.02 [1.01, 1.02] (1.01–1.02) |
| NumPy, f32 | `numpy_packed` | 2004 | 0.94 [0.91, 0.97] (0.94–0.94) |
| PyTorch, f32 | `torch_pad_flat` | 2004 | 2.26 [2.18, 2.33] (2.25–2.26) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 2.61 [2.46, 2.75] (2.60–2.61) |
| NextPlaid, f32 | `nextplaid` | 2004 | 1.68 [1.65, 1.71] (1.68–1.68) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 0.97 [0.93, 1.01] (0.96–0.97) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2004 | 0.98 [0.93, 1.02] (0.97–0.98) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 0.98 [0.94, 1.03] (0.98–0.99) |

### Graviton4 — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.19 [1.19, 1.19] (1.19–1.20) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 1.00 [1.00, 1.00] (1.00–1.00) |
| NumPy, f32 | `numpy_packed` | 2378 | 0.82 [0.82, 0.83] (0.82–0.82) |
| PyTorch, f32 | `torch_pad_flat` | 2378 | 2.65 [2.64, 2.66] (2.64–2.65) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 2.90 [2.89, 2.91] (2.89–2.90) |
| NextPlaid, f32 | `nextplaid` | 2378 | 1.76 [1.76, 1.77] (1.76–1.77) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 1.15 [1.14, 1.15] (1.14–1.15) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2378 | 1.16 [1.16, 1.17] (1.16–1.16) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 1.17 [1.16, 1.17] (1.16–1.17) |

### Graviton4 — beir (8 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2492 | 1.12 [1.12, 1.13] (1.12–1.12) |
| sweet, production path + prewarm | `node-prewarm` | 2492 | 1.04 [1.04, 1.04] (1.04–1.04) |
| NumPy, f32 | `numpy_packed` | 2492 | 1.28 [1.28, 1.28] (1.28–1.28) |
| PyTorch, f32 | `torch_pad_flat` | 2492 | 1.62 [1.61, 1.62] (1.62–1.62) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2492 | 1.29 [1.28, 1.29] (1.29–1.29) |
| NextPlaid, f32 | `nextplaid` | 2492 | 1.33 [1.33, 1.34] (1.33–1.34) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2492 | 0.66 [0.66, 0.66] (0.66–0.66) |
| NumKong (approx.), f16 | `numkong_native_f16` | 2492 | 0.67 [0.67, 0.67] (0.67–0.67) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2492 | 0.69 [0.69, 0.69] (0.69–0.69) |

### M3 Max — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.03 [1.03, 1.04] (1.03–1.04) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 0.69 [0.69, 0.70] (0.69–0.69) |
| NumPy, f32 | `numpy_packed` | 2004 | 0.92 [0.88, 0.97] (0.92–0.92) |
| PyTorch, f32 | `torch_pad_bmm@t1` | 2004 | 1.95 [1.89, 2.01] (1.94–1.95) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2004 | 4.37 [4.21, 4.58] (4.36–4.37) |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2004 | 2.97 [2.82, 3.09] (2.96–2.97) |
| NextPlaid, f32 | `nextplaid@t12` | 2004 | 2.02 [1.98, 2.08] (2.02–2.02) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 1.88 [1.78, 1.98] (1.88–1.88) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 1.13 [1.06, 1.19] (1.13–1.13) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 1.87 [1.78, 1.97] (1.87–1.88) |

### M3 Max — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.04 [1.04, 1.04] (1.04–1.04) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 0.69 [0.69, 0.70] (0.69–0.70) |
| NumPy, f32 | `numpy_packed@t1` | 2378 | 0.74 [0.73, 0.74] (0.73–0.74) |
| PyTorch, f32 | `torch_segment_reduce` | 2378 | 1.92 [1.91, 1.93] (1.91–1.92) |
| PyTorch, bf16 | `torch_pad_flat_bf16` | 2378 | 4.83 [4.81, 4.85] (4.81–4.82) |
| maxsim-cpu, f32 | `maxsim_cpu_variable@t1` | 2378 | 2.70 [2.68, 2.71] (2.69–2.70) |
| NextPlaid, f32 | `nextplaid@t12` | 2378 | 2.54 [2.52, 2.55] (2.53–2.54) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 2.86 [2.84, 2.89] (2.85–2.86) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 0.88 [0.87, 0.89] (0.88–0.88) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 2.88 [2.85, 2.90] (2.87–2.87) |

### EPYC — agent-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2004 | 1.13 [1.10, 1.15] (1.11–1.14) |
| sweet, production path + prewarm | `node-prewarm` | 2004 | 1.05 [1.04, 1.06] (1.04–1.06) |
| NumPy, f32 | `numpy_packed` | 2004 | 0.71 [0.70, 0.72] (0.70–0.71) |
| PyTorch, f32 | `torch_pad_bmm` | 2004 | 1.04 [0.99, 1.09] (1.04–1.05) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2004 | 6.16 [5.90, 6.48] (6.13–6.20) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2004 | 2.66 [2.58, 2.74] (2.65–2.68) |
| NextPlaid, f32 | `nextplaid@t4` | 2004 | 2.36 [2.26, 2.44] (2.35–2.38) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2004 | 1.21 [1.15, 1.27] (1.21–1.22) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2004 | 1.14 [1.10, 1.17] (1.14–1.15) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2004 | 1.24 [1.18, 1.31] (1.24–1.25) |

### EPYC — gcsn-ho (1 sets)
| config | arm | calls | ratio [CI] (spread) |
|---|---|--:|--:|
| sweet, production path (Node) | `node-production` | 2378 | 1.12 [1.12, 1.12] (1.12–1.13) |
| sweet, production path + prewarm | `node-prewarm` | 2378 | 1.06 [1.06, 1.06] (1.05–1.07) |
| NumPy, f32 | `numpy_packed` | 2378 | 0.69 [0.69, 0.70] (0.69–0.70) |
| PyTorch, f32 | `torch_pad_bmm` | 2378 | 1.35 [1.34, 1.36] (1.34–1.35) |
| PyTorch, bf16 | `torch_pad_bmm_bf16` | 2378 | 8.60 [8.53, 8.68] (8.60–8.61) |
| maxsim-cpu, f32 | `maxsim_cpu_variable` | 2378 | 2.95 [2.94, 2.96] (2.94–2.96) |
| NextPlaid, f32 | `nextplaid@t4` | 2378 | 1.81 [1.79, 1.83] (1.81–1.82) |
| NumKong (approx.), bf16 | `numkong_native_bf16` | 2378 | 1.53 [1.52, 1.54] (1.53–1.53) |
| NumKong (approx.), f16 | `numkong_native_f16@t1` | 2378 | 1.01 [1.00, 1.01] (1.00–1.01) |
| NumKong (approx.), f32 | `numkong_native_f32` | 2378 | 1.56 [1.55, 1.57] (1.56–1.57) |

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
| Intel | agent-ho | NumKong (approx.), f16 | 0.613 | 0.626 | +2.0% |
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
| AMD | agent-ho | NumPy, f32 | 4.018 | 4.009 | -0.2% |
| AMD | agent-ho | NumPy (BLIS), f32 | 48.098 | 48.445 | +0.7% |
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
| AMD | gcsn-ho | NumPy (BLIS), f32 | 36.754 | 36.968 | +0.6% |
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

## losses: 1131 (platform, mode, set or cell, configuration) cases with ratio < 1

| platform | mode | where | config | ratio [CI] (spread) | CI below 1 |
|---|---|---|---|--:|---|
| AMD | one thread | agent-ho | NumKong (approx.), f16 | 0.48 [0.47, 0.48] (0.48–0.48) | yes |
| AMD | one thread | beir | NumKong (approx.), f16 | 0.55 [0.55, 0.55] (0.55–0.55) | yes |
| AMD | one thread | beir | NumPy, f32 | 0.77 [0.77, 0.77] (0.77–0.77) | yes |
| AMD | one thread | gcsn-ho | NumKong (approx.), f16 | 0.45 [0.45, 0.45] (0.45–0.45) | yes |
| AMD | pool-parked | gcsn-ho | NumKong (approx.), f16 | 0.96 [0.95, 0.97] (0.95–0.96) | yes |
| AMD | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f32 | 0.84 [0.83, 0.85] (0.83–0.84) | yes |
| AMD | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f16 | 0.84 [0.83, 0.85] (0.83–0.85) | yes |
| AMD | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), bf16 | 0.87 [0.86, 0.88] (0.87–0.89) | yes |
| AMD | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), bf16 | 0.66 [0.65, 0.66] (0.65–0.66) | yes |
| AMD | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f16 | 0.66 [0.66, 0.67] (0.66–0.66) | yes |
| AMD | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f32 | 0.68 [0.67, 0.68] (0.67–0.68) | yes |
| AMD | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f32 | 0.86 [0.85, 0.87] (0.84–0.89) | yes |
| AMD | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f16 | 0.88 [0.87, 0.90] (0.87–0.90) | yes |
| AMD | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), bf16 | 0.90 [0.89, 0.91] (0.89–0.92) | yes |
| AMD | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f16 | 0.61 [0.60, 0.62] (0.61–0.62) | yes |
| AMD | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f32 | 0.62 [0.61, 0.62] (0.61–0.62) | yes |
| AMD | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), bf16 | 0.62 [0.62, 0.63] (0.62–0.63) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f32 | 0.79 [0.78, 0.80] (0.78–0.80) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f16 | 0.83 [0.82, 0.84] (0.82–0.84) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), bf16 | 0.85 [0.83, 0.86] (0.84–0.86) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), bf16 | 0.67 [0.66, 0.68] (0.67–0.67) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f16 | 0.67 [0.67, 0.68] (0.67–0.68) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f32 | 0.69 [0.68, 0.69] (0.69–0.69) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f32 | 0.91 [0.90, 0.92] (0.91–0.92) | yes |
| AMD | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f16 | 0.93 [0.92, 0.94] (0.93–0.94) | no |
| AMD | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), bf16 | 0.98 [0.96, 0.99] (0.97–0.99) | no |
| AMD | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f32 | 0.79 [0.78, 0.80] (0.78–0.80) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f16 | 0.80 [0.79, 0.81] (0.79–0.81) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), bf16 | 0.84 [0.83, 0.85] (0.83–0.85) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), bf16 | 0.60 [0.60, 0.61] (0.60–0.61) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f16 | 0.61 [0.61, 0.62] (0.61–0.62) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f32 | 0.62 [0.61, 0.62] (0.61–0.62) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), f32 | 0.96 [0.94, 0.98] (0.95–0.97) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), f16 | 0.98 [0.96, 0.99] (0.97–0.98) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), bf16 | 0.98 [0.96, 1.00] (0.96–0.99) | no |
| AMD | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f32 | 0.85 [0.84, 0.86] (0.84–0.85) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f16 | 0.90 [0.89, 0.91] (0.89–0.91) | yes |
| AMD | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), bf16 | 0.91 [0.90, 0.92] (0.90–0.92) | yes |
| AMD | warm sweep | q32-d1024-len128 | NumKong (approx.), bf16 | 0.39 [0.36, 0.43] (0.39–0.40) | yes |
| AMD | warm sweep | q32-d1024-len128 | NumKong (approx.), f16 | 0.40 [0.37, 0.45] (0.40–0.41) | yes |
| AMD | warm sweep | q32-d1024-len128 | NumKong (approx.), f32 | 0.44 [0.41, 0.48] (0.43–0.45) | yes |
| AMD | warm sweep | q32-d1024-len128 | PyTorch, bf16 | 0.61 [0.53, 0.68] (0.60–0.62) | yes |
| AMD | warm sweep | q32-d1024-len128 | PyTorch, f32 | 0.95 [0.83, 1.07] (0.94–0.97) | no |
| AMD | warm sweep | q32-d1024-len32 | NumKong (approx.), bf16 | 0.42 [0.39, 0.47] (0.41–0.44) | yes |
| AMD | warm sweep | q32-d1024-len32 | NumKong (approx.), f16 | 0.44 [0.40, 0.49] (0.43–0.45) | yes |
| AMD | warm sweep | q32-d1024-len32 | NumKong (approx.), f32 | 0.50 [0.45, 0.56] (0.47–0.51) | yes |
| AMD | warm sweep | q32-d1024-len32 | PyTorch, f32 | 0.81 [0.72, 0.89] (0.77–0.82) | yes |
| AMD | warm sweep | q32-d1024-len32 | PyTorch, bf16 | 0.81 [0.71, 0.91] (0.78–0.83) | yes |
| AMD | warm sweep | q32-d1024-len32 | NextPlaid, f32 | 0.95 [0.85, 1.07] (0.93–0.96) | no |
| AMD | warm sweep | q32-d1024-len512 | NumKong (approx.), f16 | 0.60 [0.58, 0.64] (0.60–0.61) | yes |
| AMD | warm sweep | q32-d1024-len512 | NumKong (approx.), bf16 | 0.61 [0.58, 0.65] (0.60–0.61) | yes |
| AMD | warm sweep | q32-d1024-len512 | NumKong (approx.), f32 | 0.64 [0.61, 0.69] (0.63–0.64) | yes |
| AMD | warm sweep | q32-d1024-lennat | NumKong (approx.), bf16 | 0.57 [0.54, 0.62] (0.55–0.58) | yes |
| AMD | warm sweep | q32-d1024-lennat | NumKong (approx.), f16 | 0.59 [0.55, 0.64] (0.57–0.60) | yes |
| AMD | warm sweep | q32-d1024-lennat | NumKong (approx.), f32 | 0.63 [0.58, 0.68] (0.61–0.64) | yes |
| AMD | warm sweep | q32-d16-len128 | NumKong (approx.), bf16 | 0.87 [0.79, 0.98] (0.85–0.88) | yes |
| AMD | warm sweep | q32-d16-len128 | NumKong (approx.), f16 | 0.93 [0.83, 1.05] (0.91–0.94) | no |
| AMD | warm sweep | q32-d16-len128 | NumKong (approx.), f32 | 0.97 [0.86, 1.09] (0.95–0.98) | no |
| AMD | warm sweep | q32-d16-len512 | NumKong (approx.), f32 | 0.86 [0.78, 0.96] (0.78–0.84) | yes |
| AMD | warm sweep | q32-d16-len512 | NumKong (approx.), f16 | 0.91 [0.84, 0.99] (0.82–0.93) | yes |
| AMD | warm sweep | q32-d16-len512 | NumKong (approx.), bf16 | 0.93 [0.85, 1.02] (0.87–0.94) | no |
| AMD | warm sweep | q32-d256-len128 | NumKong (approx.), f16 | 0.37 [0.31, 0.43] (0.35–0.41) | yes |
| AMD | warm sweep | q32-d256-len128 | NumKong (approx.), bf16 | 0.37 [0.32, 0.43] (0.36–0.40) | yes |
| AMD | warm sweep | q32-d256-len128 | NumKong (approx.), f32 | 0.39 [0.33, 0.45] (0.37–0.44) | yes |
| AMD | warm sweep | q32-d256-len128 | PyTorch, bf16 | 0.57 [0.47, 0.68] (0.55–0.62) | yes |
| AMD | warm sweep | q32-d256-len128 | PyTorch, f32 | 0.65 [0.53, 0.78] (0.63–0.71) | yes |
| AMD | warm sweep | q32-d256-len32 | NumKong (approx.), f32 | 0.61 [0.54, 0.70] (0.60–0.62) | yes |
| AMD | warm sweep | q32-d256-len32 | NumKong (approx.), bf16 | 0.62 [0.53, 0.71] (0.61–0.63) | yes |
| AMD | warm sweep | q32-d256-len32 | NumKong (approx.), f16 | 0.62 [0.54, 0.71] (0.62–0.63) | yes |
| AMD | warm sweep | q32-d256-len32 | PyTorch, f32 | 0.78 [0.70, 0.86] (0.77–0.80) | yes |
| AMD | warm sweep | q32-d256-len32 | PyTorch, bf16 | 0.85 [0.77, 0.94] (0.84–0.87) | yes |
| AMD | warm sweep | q32-d256-len32 | NextPlaid, f32 | 0.92 [0.83, 1.02] (0.89–0.95) | no |
| AMD | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.34 [0.30, 0.39] (0.34–0.36) | yes |
| AMD | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.35 [0.30, 0.40] (0.34–0.36) | yes |
| AMD | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.41 [0.34, 0.48] (0.39–0.42) | yes |
| AMD | warm sweep | q32-d256-len512 | PyTorch, bf16 | 0.59 [0.48, 0.69] (0.58–0.61) | yes |
| AMD | warm sweep | q32-d256-len512 | PyTorch, f32 | 0.87 [0.76, 1.00] (0.86–0.91) | yes |
| AMD | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.29 [0.27, 0.31] (0.28–0.31) | yes |
| AMD | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.30 [0.28, 0.32] (0.28–0.32) | yes |
| AMD | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.31 [0.28, 0.34] (0.30–0.32) | yes |
| AMD | warm sweep | q32-d256-lennat | PyTorch, bf16 | 0.90 [0.81, 1.00] (0.83–0.95) | no |
| AMD | warm sweep | q32-d4096-len128 | NumKong (approx.), bf16 | 0.66 [0.63, 0.69] (0.65–0.66) | yes |
| AMD | warm sweep | q32-d4096-len128 | NumKong (approx.), f16 | 0.68 [0.65, 0.71] (0.67–0.68) | yes |
| AMD | warm sweep | q32-d4096-len128 | NumKong (approx.), f32 | 0.72 [0.69, 0.76] (0.72–0.72) | yes |
| AMD | warm sweep | q32-d4096-len32 | NumKong (approx.), bf16 | 0.52 [0.49, 0.54] (0.52–0.53) | yes |
| AMD | warm sweep | q32-d4096-len32 | NumKong (approx.), f16 | 0.56 [0.53, 0.58] (0.56–0.57) | yes |
| AMD | warm sweep | q32-d4096-len32 | NumKong (approx.), f32 | 0.67 [0.64, 0.68] (0.66–0.68) | yes |
| AMD | warm sweep | q32-d4096-len32 | PyTorch, bf16 | 0.83 [0.77, 0.87] (0.83–0.84) | yes |
| AMD | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.55 [0.53, 0.57] (0.54–0.55) | yes |
| AMD | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.56 [0.54, 0.58] (0.55–0.56) | yes |
| AMD | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.58 [0.57, 0.61] (0.58–0.59) | yes |
| AMD | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.64 [0.61, 0.67] (0.64–0.65) | yes |
| AMD | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.66 [0.62, 0.69] (0.65–0.66) | yes |
| AMD | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.69 [0.65, 0.74] (0.69–0.69) | yes |
| AMD | warm sweep | q32-d64-len128 | NumKong (approx.), f16 | 0.43 [0.37, 0.51] (0.42–0.44) | yes |
| AMD | warm sweep | q32-d64-len128 | NumKong (approx.), bf16 | 0.44 [0.38, 0.52] (0.42–0.45) | yes |
| AMD | warm sweep | q32-d64-len128 | NumKong (approx.), f32 | 0.45 [0.39, 0.53] (0.43–0.47) | yes |
| AMD | warm sweep | q32-d64-len128 | PyTorch, f32 | 0.71 [0.64, 0.80] (0.69–0.73) | yes |
| AMD | warm sweep | q32-d64-len128 | PyTorch, bf16 | 0.80 [0.72, 0.91] (0.77–0.82) | yes |
| AMD | warm sweep | q32-d64-len32 | NumKong (approx.), bf16 | 0.46 [0.42, 0.51] (0.45–0.48) | yes |
| AMD | warm sweep | q32-d64-len32 | NumKong (approx.), f16 | 0.48 [0.43, 0.54] (0.47–0.49) | yes |
| AMD | warm sweep | q32-d64-len32 | NumKong (approx.), f32 | 0.53 [0.47, 0.60] (0.51–0.55) | yes |
| AMD | warm sweep | q32-d64-len32 | PyTorch, f32 | 0.67 [0.64, 0.71] (0.66–0.70) | yes |
| AMD | warm sweep | q32-d64-len32 | PyTorch, bf16 | 0.71 [0.67, 0.75] (0.69–0.74) | yes |
| AMD | warm sweep | q32-d64-len32 | maxsim-cpu, f32 | 0.89 [0.78, 1.03] (0.86–0.94) | no |
| AMD | warm sweep | q32-d64-len32 | NextPlaid, f32 | 0.90 [0.80, 1.02] (0.87–0.96) | no |
| AMD | warm sweep | q32-d64-len512 | NumKong (approx.), bf16 | 0.41 [0.36, 0.47] (0.39–0.44) | yes |
| AMD | warm sweep | q32-d64-len512 | NumKong (approx.), f16 | 0.45 [0.37, 0.58] (0.40–0.52) | yes |
| AMD | warm sweep | q32-d64-len512 | NumKong (approx.), f32 | 0.49 [0.36, 0.77] (0.45–0.52) | yes |
| AMD | warm sweep | q32-d64-len512 | PyTorch, bf16 | 0.55 [0.49, 0.61] (0.53–0.58) | yes |
| AMD | warm sweep | q32-d64-len512 | PyTorch, f32 | 0.62 [0.55, 0.69] (0.59–0.65) | yes |
| AMD | warm sweep | q32-d64-lennat | NumKong (approx.), bf16 | 0.42 [0.35, 0.52] (0.40–0.45) | yes |
| AMD | warm sweep | q32-d64-lennat | NumKong (approx.), f16 | 0.42 [0.35, 0.52] (0.40–0.46) | yes |
| AMD | warm sweep | q32-d64-lennat | NumKong (approx.), f32 | 0.42 [0.36, 0.52] (0.41–0.45) | yes |
| AMD | warm sweep | q32-d64-lennat | PyTorch, bf16 | 0.77 [0.69, 0.87] (0.74–0.84) | yes |
| AMD | warm sweep | q32-d64-lennat | PyTorch, f32 | 0.88 [0.79, 0.98] (0.85–0.95) | yes |
| AMD | warm sweep | q64-d1024-len128 | PyTorch, bf16 | 0.37 [0.34, 0.40] (0.36–0.37) | yes |
| AMD | warm sweep | q64-d1024-len128 | NumKong (approx.), bf16 | 0.44 [0.36, 0.50] (0.43–0.44) | yes |
| AMD | warm sweep | q64-d1024-len128 | NumKong (approx.), f16 | 0.45 [0.38, 0.52] (0.45–0.45) | yes |
| AMD | warm sweep | q64-d1024-len128 | NumKong (approx.), f32 | 0.49 [0.44, 0.54] (0.48–0.49) | yes |
| AMD | warm sweep | q64-d1024-len32 | PyTorch, bf16 | 0.33 [0.29, 0.37] (0.32–0.33) | yes |
| AMD | warm sweep | q64-d1024-len32 | NumKong (approx.), bf16 | 0.39 [0.37, 0.42] (0.38–0.40) | yes |
| AMD | warm sweep | q64-d1024-len32 | NumKong (approx.), f16 | 0.40 [0.37, 0.44] (0.39–0.41) | yes |
| AMD | warm sweep | q64-d1024-len32 | NumKong (approx.), f32 | 0.47 [0.43, 0.50] (0.46–0.48) | yes |
| AMD | warm sweep | q64-d1024-len32 | PyTorch, f32 | 0.80 [0.68, 0.91] (0.78–0.81) | yes |
| AMD | warm sweep | q64-d1024-len512 | NumKong (approx.), bf16 | 0.53 [0.52, 0.54] (0.53–0.54) | yes |
| AMD | warm sweep | q64-d1024-len512 | NumKong (approx.), f16 | 0.54 [0.53, 0.55] (0.53–0.54) | yes |
| AMD | warm sweep | q64-d1024-len512 | NumKong (approx.), f32 | 0.55 [0.54, 0.56] (0.54–0.55) | yes |
| AMD | warm sweep | q64-d1024-lennat | NumKong (approx.), bf16 | 0.57 [0.53, 0.61] (0.55–0.57) | yes |
| AMD | warm sweep | q64-d1024-lennat | NumKong (approx.), f16 | 0.58 [0.54, 0.63] (0.57–0.59) | yes |
| AMD | warm sweep | q64-d1024-lennat | NumKong (approx.), f32 | 0.60 [0.55, 0.65] (0.58–0.61) | yes |
| AMD | warm sweep | q64-d16-len128 | NumKong (approx.), bf16 | 0.83 [0.74, 0.95] (0.80–0.85) | yes |
| AMD | warm sweep | q64-d16-len128 | NumKong (approx.), f32 | 0.85 [0.77, 0.96] (0.82–0.86) | yes |
| AMD | warm sweep | q64-d16-len128 | PyTorch, bf16 | 0.87 [0.81, 0.93] (0.85–0.88) | yes |
| AMD | warm sweep | q64-d16-len128 | NumKong (approx.), f16 | 0.90 [0.80, 1.02] (0.88–0.91) | no |
| AMD | warm sweep | q64-d16-len512 | PyTorch, bf16 | 0.53 [0.48, 0.58] (0.50–0.54) | yes |
| AMD | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.77 [0.69, 0.85] (0.73–0.78) | yes |
| AMD | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.84 [0.75, 0.94] (0.79–0.84) | yes |
| AMD | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.88 [0.78, 0.98] (0.83–0.89) | yes |
| AMD | warm sweep | q64-d16-lennat | PyTorch, bf16 | 0.80 [0.75, 0.85] (0.76–0.82) | yes |
| AMD | warm sweep | q64-d256-len128 | PyTorch, bf16 | 0.23 [0.19, 0.29] (0.23–0.24) | yes |
| AMD | warm sweep | q64-d256-len128 | NumKong (approx.), f16 | 0.30 [0.25, 0.35] (0.29–0.31) | yes |
| AMD | warm sweep | q64-d256-len128 | NumKong (approx.), bf16 | 0.31 [0.26, 0.36] (0.30–0.33) | yes |
| AMD | warm sweep | q64-d256-len128 | NumKong (approx.), f32 | 0.32 [0.27, 0.38] (0.31–0.33) | yes |
| AMD | warm sweep | q64-d256-len128 | PyTorch, f32 | 0.57 [0.47, 0.70] (0.56–0.59) | yes |
| AMD | warm sweep | q64-d256-len32 | PyTorch, bf16 | 0.46 [0.43, 0.50] (0.45–0.47) | yes |
| AMD | warm sweep | q64-d256-len32 | NumKong (approx.), bf16 | 0.51 [0.47, 0.55] (0.49–0.51) | yes |
| AMD | warm sweep | q64-d256-len32 | NumKong (approx.), f16 | 0.53 [0.49, 0.56] (0.51–0.53) | yes |
| AMD | warm sweep | q64-d256-len32 | NumKong (approx.), f32 | 0.56 [0.52, 0.60] (0.54–0.57) | yes |
| AMD | warm sweep | q64-d256-len32 | PyTorch, f32 | 0.81 [0.74, 0.87] (0.78–0.82) | yes |
| AMD | warm sweep | q64-d256-len512 | PyTorch, bf16 | 0.34 [0.31, 0.37] (0.34–0.35) | yes |
| AMD | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.41 [0.34, 0.48] (0.40–0.42) | yes |
| AMD | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.41 [0.34, 0.48] (0.40–0.42) | yes |
| AMD | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.47 [0.43, 0.50] (0.46–0.48) | yes |
| AMD | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.33 [0.26, 0.41] (0.32–0.33) | yes |
| AMD | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.33 [0.27, 0.42] (0.33–0.34) | yes |
| AMD | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.34 [0.28, 0.43] (0.34–0.35) | yes |
| AMD | warm sweep | q64-d256-lennat | PyTorch, bf16 | 0.60 [0.43, 0.82] (0.56–0.81) | no |
| AMD | warm sweep | q64-d4096-len128 | NumKong (approx.), bf16 | 0.60 [0.57, 0.63] (0.60–0.60) | yes |
| AMD | warm sweep | q64-d4096-len128 | NumKong (approx.), f16 | 0.61 [0.58, 0.64] (0.61–0.62) | yes |
| AMD | warm sweep | q64-d4096-len128 | NumKong (approx.), f32 | 0.65 [0.62, 0.69] (0.65–0.65) | yes |
| AMD | warm sweep | q64-d4096-len32 | PyTorch, bf16 | 0.33 [0.31, 0.38] (0.33–0.36) | yes |
| AMD | warm sweep | q64-d4096-len32 | NumKong (approx.), bf16 | 0.45 [0.42, 0.48] (0.45–0.45) | yes |
| AMD | warm sweep | q64-d4096-len32 | NumKong (approx.), f16 | 0.48 [0.46, 0.51] (0.48–0.49) | yes |
| AMD | warm sweep | q64-d4096-len32 | NumKong (approx.), f32 | 0.58 [0.56, 0.61] (0.57–0.59) | yes |
| AMD | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.53 [0.51, 0.55] (0.53–0.53) | yes |
| AMD | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.53 [0.52, 0.55] (0.53–0.54) | yes |
| AMD | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.54 [0.53, 0.58] (0.54–0.55) | yes |
| AMD | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.57 [0.54, 0.60] (0.56–0.57) | yes |
| AMD | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.57 [0.55, 0.61] (0.57–0.58) | yes |
| AMD | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.60 [0.57, 0.63] (0.59–0.60) | yes |
| AMD | warm sweep | q64-d64-len128 | PyTorch, bf16 | 0.42 [0.37, 0.47] (0.41–0.42) | yes |
| AMD | warm sweep | q64-d64-len128 | NumKong (approx.), bf16 | 0.47 [0.41, 0.54] (0.46–0.47) | yes |
| AMD | warm sweep | q64-d64-len128 | NumKong (approx.), f16 | 0.48 [0.41, 0.57] (0.46–0.49) | yes |
| AMD | warm sweep | q64-d64-len128 | NumKong (approx.), f32 | 0.48 [0.43, 0.55] (0.47–0.49) | yes |
| AMD | warm sweep | q64-d64-len128 | PyTorch, f32 | 0.72 [0.64, 0.81] (0.70–0.73) | yes |
| AMD | warm sweep | q64-d64-len32 | NumKong (approx.), bf16 | 0.40 [0.35, 0.46] (0.39–0.41) | yes |
| AMD | warm sweep | q64-d64-len32 | NumKong (approx.), f16 | 0.41 [0.37, 0.47] (0.40–0.43) | yes |
| AMD | warm sweep | q64-d64-len32 | PyTorch, bf16 | 0.44 [0.41, 0.48] (0.44–0.45) | yes |
| AMD | warm sweep | q64-d64-len32 | NumKong (approx.), f32 | 0.48 [0.42, 0.55] (0.48–0.49) | yes |
| AMD | warm sweep | q64-d64-len32 | PyTorch, f32 | 0.57 [0.53, 0.62] (0.56–0.58) | yes |
| AMD | warm sweep | q64-d64-len512 | PyTorch, bf16 | 0.26 [0.22, 0.31] (0.25–0.27) | yes |
| AMD | warm sweep | q64-d64-len512 | NumKong (approx.), bf16 | 0.37 [0.31, 0.45] (0.37–0.39) | yes |
| AMD | warm sweep | q64-d64-len512 | NumKong (approx.), f16 | 0.38 [0.33, 0.44] (0.37–0.40) | yes |
| AMD | warm sweep | q64-d64-len512 | NumKong (approx.), f32 | 0.44 [0.36, 0.57] (0.43–0.46) | yes |
| AMD | warm sweep | q64-d64-len512 | PyTorch, f32 | 0.65 [0.54, 0.79] (0.63–0.68) | yes |
| AMD | warm sweep | q64-d64-lennat | PyTorch, bf16 | 0.38 [0.32, 0.44] (0.36–0.39) | yes |
| AMD | warm sweep | q64-d64-lennat | NumKong (approx.), bf16 | 0.44 [0.36, 0.58] (0.43–0.46) | yes |
| AMD | warm sweep | q64-d64-lennat | NumKong (approx.), f16 | 0.46 [0.36, 0.65] (0.45–0.47) | yes |
| AMD | warm sweep | q64-d64-lennat | NumKong (approx.), f32 | 0.50 [0.37, 0.78] (0.48–0.51) | yes |
| AMD | warm sweep | q64-d64-lennat | PyTorch, f32 | 0.99 [0.85, 1.17] (0.96–1.04) | no |
| AMD | warm sweep | q8-d1024-len128 | NumKong (approx.), f16 | 0.42 [0.33, 0.54] (0.41–0.45) | yes |
| AMD | warm sweep | q8-d1024-len128 | NumKong (approx.), f32 | 0.45 [0.35, 0.58] (0.45–0.47) | yes |
| AMD | warm sweep | q8-d1024-len128 | NumKong (approx.), bf16 | 0.48 [0.35, 0.65] (0.47–0.50) | yes |
| AMD | warm sweep | q8-d1024-len128 | PyTorch, bf16 | 0.66 [0.52, 0.85] (0.66–0.70) | yes |
| AMD | warm sweep | q8-d1024-len128 | PyTorch, f32 | 0.87 [0.67, 1.11] (0.85–0.89) | no |
| AMD | warm sweep | q8-d1024-len32 | NumKong (approx.), bf16 | 0.51 [0.40, 0.63] (0.48–0.52) | yes |
| AMD | warm sweep | q8-d1024-len32 | NumKong (approx.), f32 | 0.52 [0.44, 0.62] (0.49–0.52) | yes |
| AMD | warm sweep | q8-d1024-len32 | NumKong (approx.), f16 | 0.53 [0.42, 0.64] (0.49–0.54) | yes |
| AMD | warm sweep | q8-d1024-len32 | PyTorch, bf16 | 0.57 [0.50, 0.65] (0.54–0.58) | yes |
| AMD | warm sweep | q8-d1024-len32 | PyTorch, f32 | 0.59 [0.50, 0.67] (0.55–0.58) | yes |
| AMD | warm sweep | q8-d1024-len32 | NextPlaid, f32 | 0.79 [0.68, 0.90] (0.74–0.82) | no |
| AMD | warm sweep | q8-d1024-len32 | maxsim-cpu, f32 | 0.90 [0.77, 1.02] (0.85–0.91) | no |
| AMD | warm sweep | q8-d1024-lennat | NumKong (approx.), bf16 | 0.80 [0.71, 0.88] (0.72–0.87) | yes |
| AMD | warm sweep | q8-d1024-lennat | NumKong (approx.), f16 | 0.83 [0.78, 0.89] (0.76–0.90) | yes |
| AMD | warm sweep | q8-d1024-lennat | NumKong (approx.), f32 | 0.85 [0.76, 0.93] (0.78–0.92) | yes |
| AMD | warm sweep | q8-d256-len128 | NumKong (approx.), f16 | 0.33 [0.28, 0.41] (0.32–0.37) | yes |
| AMD | warm sweep | q8-d256-len128 | NumKong (approx.), bf16 | 0.34 [0.28, 0.41] (0.33–0.36) | yes |
| AMD | warm sweep | q8-d256-len128 | NumKong (approx.), f32 | 0.36 [0.27, 0.52] (0.34–0.38) | yes |
| AMD | warm sweep | q8-d256-len128 | PyTorch, f32 | 0.48 [0.40, 0.58] (0.46–0.51) | yes |
| AMD | warm sweep | q8-d256-len128 | PyTorch, bf16 | 0.52 [0.45, 0.60] (0.49–0.55) | yes |
| AMD | warm sweep | q8-d256-len128 | NextPlaid, f32 | 0.78 [0.59, 1.13] (0.76–0.83) | no |
| AMD | warm sweep | q8-d256-len32 | NumKong (approx.), bf16 | 0.65 [0.57, 0.73] (0.64–0.66) | yes |
| AMD | warm sweep | q8-d256-len32 | NumKong (approx.), f16 | 0.65 [0.58, 0.73] (0.64–0.68) | yes |
| AMD | warm sweep | q8-d256-len32 | NumKong (approx.), f32 | 0.67 [0.61, 0.75] (0.66–0.68) | yes |
| AMD | warm sweep | q8-d256-len32 | PyTorch, f32 | 0.77 [0.68, 0.87] (0.76–0.79) | yes |
| AMD | warm sweep | q8-d256-len32 | PyTorch, bf16 | 0.86 [0.76, 0.97] (0.84–0.88) | yes |
| AMD | warm sweep | q8-d256-len32 | NextPlaid, f32 | 0.93 [0.85, 1.02] (0.91–0.96) | no |
| AMD | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.39 [0.33, 0.45] (0.35–0.42) | yes |
| AMD | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.40 [0.31, 0.49] (0.37–0.43) | yes |
| AMD | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.40 [0.33, 0.47] (0.37–0.43) | yes |
| AMD | warm sweep | q8-d256-len512 | PyTorch, bf16 | 0.65 [0.53, 0.80] (0.61–0.70) | yes |
| AMD | warm sweep | q8-d256-len512 | PyTorch, f32 | 0.82 [0.67, 1.01] (0.77–0.88) | no |
| AMD | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.37 [0.28, 0.47] (0.34–0.39) | yes |
| AMD | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.38 [0.30, 0.51] (0.36–0.41) | yes |
| AMD | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.39 [0.30, 0.52] (0.37–0.42) | yes |
| AMD | warm sweep | q8-d4096-len32 | NumKong (approx.), f16 | 0.75 [0.70, 0.78] (0.74–0.77) | yes |
| AMD | warm sweep | q8-d4096-len32 | NumKong (approx.), bf16 | 0.80 [0.74, 0.86] (0.79–0.80) | yes |
| AMD | warm sweep | q8-d4096-len32 | PyTorch, bf16 | 0.85 [0.81, 0.88] (0.84–0.86) | yes |
| AMD | warm sweep | q8-d4096-len32 | NumKong (approx.), f32 | 0.91 [0.85, 0.99] (0.90–0.93) | yes |
| AMD | warm sweep | q8-d64-len128 | NumKong (approx.), f16 | 0.39 [0.37, 0.43] (0.39–0.42) | yes |
| AMD | warm sweep | q8-d64-len128 | NumKong (approx.), f32 | 0.40 [0.36, 0.45] (0.39–0.42) | yes |
| AMD | warm sweep | q8-d64-len128 | NumKong (approx.), bf16 | 0.41 [0.38, 0.44] (0.40–0.43) | yes |
| AMD | warm sweep | q8-d64-len128 | PyTorch, f32 | 0.61 [0.58, 0.65] (0.60–0.65) | yes |
| AMD | warm sweep | q8-d64-len128 | PyTorch, bf16 | 0.67 [0.63, 0.70] (0.65–0.71) | yes |
| AMD | warm sweep | q8-d64-len128 | NextPlaid, f32 | 0.73 [0.65, 0.83] (0.72–0.78) | yes |
| AMD | warm sweep | q8-d64-len128 | maxsim-cpu, f32 | 0.86 [0.75, 1.01] (0.85–0.90) | no |
| AMD | warm sweep | q8-d64-len32 | NumKong (approx.), f16 | 0.80 [0.75, 0.85] (0.78–0.81) | yes |
| AMD | warm sweep | q8-d64-len32 | NumKong (approx.), bf16 | 0.80 [0.75, 0.85] (0.78–0.83) | yes |
| AMD | warm sweep | q8-d64-len32 | NumKong (approx.), f32 | 0.83 [0.78, 0.88] (0.81–0.85) | yes |
| AMD | warm sweep | q8-d64-len32 | PyTorch, f32 | 0.88 [0.84, 0.92] (0.86–0.90) | yes |
| AMD | warm sweep | q8-d64-len512 | NumKong (approx.), f32 | 0.44 [0.36, 0.56] (0.41–0.47) | yes |
| AMD | warm sweep | q8-d64-len512 | NumKong (approx.), f16 | 0.45 [0.38, 0.54] (0.40–0.48) | yes |
| AMD | warm sweep | q8-d64-len512 | NumKong (approx.), bf16 | 0.45 [0.38, 0.54] (0.42–0.48) | yes |
| AMD | warm sweep | q8-d64-len512 | PyTorch, f32 | 0.66 [0.59, 0.73] (0.59–0.69) | yes |
| AMD | warm sweep | q8-d64-len512 | PyTorch, bf16 | 0.66 [0.55, 0.76] (0.59–0.69) | yes |
| AMD | warm sweep | q8-d64-lennat | NumKong (approx.), bf16 | 0.37 [0.33, 0.42] (0.36–0.40) | yes |
| AMD | warm sweep | q8-d64-lennat | NumKong (approx.), f16 | 0.38 [0.34, 0.43] (0.36–0.42) | yes |
| AMD | warm sweep | q8-d64-lennat | NumKong (approx.), f32 | 0.40 [0.34, 0.51] (0.38–0.42) | yes |
| AMD | warm sweep | q8-d64-lennat | PyTorch, f32 | 0.94 [0.88, 1.01] (0.89–0.99) | no |
| AMD | warm sweep | q8-d64-lennat | PyTorch, bf16 | 1.00 [0.91, 1.09] (0.94–1.04) | no |
| Graviton4 | one thread | agent-ho | NumKong (approx.), f16 | 0.29 [0.29, 0.30] (0.29–0.30) | yes |
| Graviton4 | one thread | beir | NumKong (approx.), f16 | 0.32 [0.32, 0.32] (0.32–0.32) | yes |
| Graviton4 | one thread | beir | PyTorch, f32 | 0.83 [0.83, 0.84] (0.83–0.83) | yes |
| Graviton4 | one thread | beir | NextPlaid, f32 | 0.98 [0.98, 0.98] (0.98–0.98) | yes |
| Graviton4 | one thread | gcsn-ho | NumKong (approx.), f16 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| Graviton4 | pool-parked | agent-ho | NumPy, f32 | 0.94 [0.91, 0.97] (0.94–0.94) | yes |
| Graviton4 | pool-parked | agent-ho | NumKong (approx.), bf16 | 0.97 [0.93, 1.01] (0.96–0.97) | no |
| Graviton4 | pool-parked | agent-ho | NumKong (approx.), f16 | 0.98 [0.93, 1.02] (0.97–0.98) | no |
| Graviton4 | pool-parked | agent-ho | NumKong (approx.), f32 | 0.98 [0.94, 1.03] (0.98–0.99) | no |
| Graviton4 | pool-parked | beir | NumKong (approx.), bf16 | 0.66 [0.66, 0.66] (0.66–0.66) | yes |
| Graviton4 | pool-parked | beir | NumKong (approx.), f16 | 0.67 [0.67, 0.67] (0.67–0.67) | yes |
| Graviton4 | pool-parked | beir | NumKong (approx.), f32 | 0.69 [0.69, 0.69] (0.69–0.69) | yes |
| Graviton4 | pool-parked | gcsn-ho | NumPy, f32 | 0.82 [0.82, 0.83] (0.82–0.82) | yes |
| Graviton4 | warm | agent-ho | NumKong (approx.), bf16 | 0.82 [0.74, 0.94] (0.82–0.82) | yes |
| Graviton4 | warm | agent-ho | NumKong (approx.), f16 | 0.85 [0.77, 0.98] (0.85–0.86) | yes |
| Graviton4 | warm | agent-ho | NumKong (approx.), f32 | 0.86 [0.78, 0.98] (0.86–0.86) | yes |
| Graviton4 | warm | beir | NumKong (approx.), bf16 | 0.55 [0.55, 0.55] (0.55–0.55) | yes |
| Graviton4 | warm | beir | NumKong (approx.), f16 | 0.58 [0.57, 0.58] (0.58–0.58) | yes |
| Graviton4 | warm | beir | NumKong (approx.), f32 | 0.60 [0.60, 0.60] (0.60–0.60) | yes |
| Graviton4 | warm | gcsn-ho | NumKong (approx.), bf16 | 0.90 [0.90, 0.91] (0.90–0.90) | yes |
| Graviton4 | warm | gcsn-ho | NumKong (approx.), f16 | 0.94 [0.93, 0.94] (0.94–0.94) | yes |
| Graviton4 | warm | gcsn-ho | NumKong (approx.), f32 | 0.95 [0.94, 0.95] (0.94–0.95) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), bf16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f16 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f32 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k100 | PyTorch, bf16 | 0.78 [0.77, 0.78] (0.78–0.78) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), bf16 | 0.33 [0.33, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f32 | 0.36 [0.36, 0.36] (0.36–0.36) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k200 | PyTorch, bf16 | 0.61 [0.60, 0.61] (0.60–0.61) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k25 | NumKong (approx.), bf16 | 0.49 [0.49, 0.50] (0.49–0.50) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k25 | NumKong (approx.), f16 | 0.51 [0.51, 0.52] (0.51–0.51) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k25 | NumKong (approx.), f32 | 0.53 [0.53, 0.53] (0.53–0.53) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), bf16 | 0.37 [0.36, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), f16 | 0.39 [0.38, 0.39] (0.39–0.39) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), f32 | 0.41 [0.40, 0.41] (0.41–0.41) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), bf16 | 0.39 [0.39, 0.39] (0.39–0.39) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f16 | 0.42 [0.42, 0.42] (0.42–0.42) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f32 | 0.44 [0.44, 0.44] (0.44–0.44) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k100 | PyTorch, bf16 | 0.76 [0.76, 0.76] (0.76–0.76) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), bf16 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f16 | 0.40 [0.40, 0.40] (0.40–0.40) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f32 | 0.43 [0.43, 0.43] (0.43–0.43) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k200 | PyTorch, bf16 | 0.63 [0.62, 0.63] (0.62–0.63) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k25 | NumKong (approx.), bf16 | 0.57 [0.57, 0.57] (0.56–0.57) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k25 | NumKong (approx.), f16 | 0.59 [0.59, 0.59] (0.59–0.59) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k25 | NumKong (approx.), f32 | 0.61 [0.61, 0.61] (0.61–0.61) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), bf16 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), f16 | 0.40 [0.40, 0.40] (0.40–0.40) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), f32 | 0.42 [0.42, 0.42] (0.42–0.42) | yes |
| Graviton4 | warm BEIR set | beir-nfcorpus-colbertv2-k50 | PyTorch, bf16 | 0.94 [0.94, 0.94] (0.94–0.94) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), bf16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f16 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f32 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k100 | PyTorch, bf16 | 0.72 [0.71, 0.72] (0.72–0.72) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), bf16 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f32 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k200 | PyTorch, bf16 | 0.71 [0.71, 0.72] (0.71–0.72) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k25 | NumKong (approx.), bf16 | 0.50 [0.49, 0.50] (0.49–0.50) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k25 | NumKong (approx.), f16 | 0.51 [0.51, 0.52] (0.51–0.51) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k25 | NumKong (approx.), f32 | 0.53 [0.52, 0.53] (0.52–0.53) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), bf16 | 0.36 [0.36, 0.36] (0.36–0.36) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f16 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f32 | 0.40 [0.40, 0.40] (0.40–0.40) | yes |
| Graviton4 | warm BEIR set | beir-scifact-answersmall-k50 | PyTorch, bf16 | 0.92 [0.91, 0.93] (0.92–0.92) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), bf16 | 0.40 [0.39, 0.40] (0.40–0.40) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f16 | 0.42 [0.42, 0.42] (0.42–0.42) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f32 | 0.44 [0.44, 0.45] (0.44–0.44) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k100 | PyTorch, bf16 | 0.71 [0.71, 0.71] (0.71–0.71) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), bf16 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f16 | 0.41 [0.41, 0.41] (0.41–0.41) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f32 | 0.44 [0.44, 0.44] (0.44–0.44) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k200 | PyTorch, bf16 | 0.61 [0.61, 0.61] (0.61–0.61) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), bf16 | 0.57 [0.56, 0.57] (0.57–0.57) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), f16 | 0.59 [0.59, 0.60] (0.59–0.60) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), f32 | 0.62 [0.62, 0.62] (0.62–0.62) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), bf16 | 0.38 [0.37, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f16 | 0.40 [0.40, 0.41] (0.40–0.40) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f32 | 0.43 [0.43, 0.43] (0.43–0.43) | yes |
| Graviton4 | warm BEIR set | beir-scifact-colbertv2-k50 | PyTorch, bf16 | 0.91 [0.91, 0.92] (0.91–0.92) | yes |
| Graviton4 | warm sweep | q32-d1-len128 | NumPy, f32 | 0.97 [0.95, 0.99] (0.93–0.98) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | NumKong (approx.), bf16 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.39] (0.38–0.39) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | NumKong (approx.), f32 | 0.43 [0.43, 0.44] (0.43–0.44) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | PyTorch, bf16 | 0.60 [0.59, 0.60] (0.59–0.60) | yes |
| Graviton4 | warm sweep | q32-d1024-len128 | PyTorch, f32 | 0.84 [0.83, 0.86] (0.83–0.84) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | NumKong (approx.), bf16 | 0.41 [0.39, 0.43] (0.41–0.41) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | NumKong (approx.), f16 | 0.49 [0.47, 0.51] (0.49–0.49) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | PyTorch, bf16 | 0.55 [0.53, 0.57] (0.55–0.55) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | NumKong (approx.), f32 | 0.60 [0.57, 0.62] (0.60–0.60) | yes |
| Graviton4 | warm sweep | q32-d1024-len32 | PyTorch, f32 | 0.90 [0.86, 0.93] (0.90–0.91) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | NumKong (approx.), bf16 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | NumKong (approx.), f32 | 0.37 [0.36, 0.37] (0.36–0.37) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | PyTorch, bf16 | 0.55 [0.55, 0.55] (0.55–0.55) | yes |
| Graviton4 | warm sweep | q32-d1024-len512 | PyTorch, f32 | 0.80 [0.80, 0.81] (0.80–0.80) | yes |
| Graviton4 | warm sweep | q32-d1024-lennat | NumKong (approx.), bf16 | 0.37 [0.36, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q32-d1024-lennat | NumKong (approx.), f16 | 0.39 [0.39, 0.39] (0.39–0.39) | yes |
| Graviton4 | warm sweep | q32-d1024-lennat | NumKong (approx.), f32 | 0.41 [0.41, 0.41] (0.41–0.41) | yes |
| Graviton4 | warm sweep | q32-d16-len128 | NumKong (approx.), bf16 | 0.62 [0.59, 0.65] (0.58–0.63) | yes |
| Graviton4 | warm sweep | q32-d16-len128 | NumKong (approx.), f16 | 0.66 [0.63, 0.69] (0.62–0.68) | yes |
| Graviton4 | warm sweep | q32-d16-len128 | NumKong (approx.), f32 | 0.67 [0.64, 0.70] (0.63–0.68) | yes |
| Graviton4 | warm sweep | q32-d16-len32 | NumKong (approx.), bf16 | 0.91 [0.88, 0.94] (0.89–0.94) | yes |
| Graviton4 | warm sweep | q32-d16-len32 | NumKong (approx.), f16 | 0.99 [0.96, 1.02] (0.97–1.02) | no |
| Graviton4 | warm sweep | q32-d16-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.36] (0.34–0.36) | yes |
| Graviton4 | warm sweep | q32-d16-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.38] (0.35–0.37) | yes |
| Graviton4 | warm sweep | q32-d16-len512 | NumKong (approx.), f32 | 0.37 [0.36, 0.39] (0.36–0.39) | yes |
| Graviton4 | warm sweep | q32-d16-len512 | PyTorch, bf16 | 0.95 [0.93, 0.96] (0.93–0.98) | no |
| Graviton4 | warm sweep | q32-d16-lennat | NumKong (approx.), f32 | 0.90 [0.85, 0.95] (0.88–0.92) | yes |
| Graviton4 | warm sweep | q32-d16-lennat | NumKong (approx.), bf16 | 0.91 [0.86, 0.97] (0.90–0.93) | yes |
| Graviton4 | warm sweep | q32-d16-lennat | NumKong (approx.), f16 | 0.99 [0.93, 1.06] (0.97–1.02) | no |
| Graviton4 | warm sweep | q32-d256-len128 | NumKong (approx.), bf16 | 0.39 [0.38, 0.39] (0.38–0.39) | yes |
| Graviton4 | warm sweep | q32-d256-len128 | NumKong (approx.), f16 | 0.42 [0.41, 0.42] (0.41–0.42) | yes |
| Graviton4 | warm sweep | q32-d256-len128 | NumKong (approx.), f32 | 0.44 [0.44, 0.45] (0.44–0.45) | yes |
| Graviton4 | warm sweep | q32-d256-len128 | PyTorch, bf16 | 0.58 [0.57, 0.58] (0.58–0.58) | yes |
| Graviton4 | warm sweep | q32-d256-len128 | PyTorch, f32 | 0.96 [0.96, 0.97] (0.96–0.97) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | NumKong (approx.), bf16 | 0.46 [0.45, 0.47] (0.46–0.47) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | NumKong (approx.), f16 | 0.54 [0.53, 0.55] (0.54–0.54) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | NumKong (approx.), f32 | 0.66 [0.64, 0.67] (0.66–0.66) | yes |
| Graviton4 | warm sweep | q32-d256-len32 | PyTorch, bf16 | 0.99 [0.97, 1.01] (0.99–0.99) | no |
| Graviton4 | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.31 [0.27, 0.34] (0.31–0.31) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.32 [0.28, 0.35] (0.31–0.32) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.33 [0.29, 0.36] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | PyTorch, bf16 | 0.53 [0.47, 0.59] (0.52–0.53) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | PyTorch, f32 | 0.75 [0.66, 0.84] (0.75–0.76) | yes |
| Graviton4 | warm sweep | q32-d256-len512 | NextPlaid, f32 | 0.96 [0.85, 1.07] (0.95–0.96) | no |
| Graviton4 | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.37 [0.36, 0.38] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.38 [0.38, 0.39] (0.38–0.39) | yes |
| Graviton4 | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.40 [0.39, 0.41] (0.39–0.40) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | NumKong (approx.), bf16 | 0.35 [0.35, 0.36] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.39] (0.39–0.39) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.41, 0.43] (0.42–0.42) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | PyTorch, bf16 | 0.55 [0.55, 0.55] (0.55–0.55) | yes |
| Graviton4 | warm sweep | q32-d4096-len128 | PyTorch, f32 | 0.80 [0.79, 0.80] (0.79–0.80) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | NumKong (approx.), bf16 | 0.41 [0.40, 0.41] (0.40–0.41) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | NumKong (approx.), f16 | 0.50 [0.49, 0.50] (0.50–0.50) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | PyTorch, bf16 | 0.55 [0.55, 0.55] (0.55–0.55) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | NumKong (approx.), f32 | 0.65 [0.64, 0.65] (0.65–0.65) | yes |
| Graviton4 | warm sweep | q32-d4096-len32 | PyTorch, f32 | 0.79 [0.78, 0.79] (0.79–0.79) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.33 [0.32, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | PyTorch, bf16 | 0.52 [0.52, 0.52] (0.52–0.52) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | PyTorch, f32 | 0.77 [0.76, 0.77] (0.77–0.77) | yes |
| Graviton4 | warm sweep | q32-d4096-len512 | NextPlaid, f32 | 0.99 [0.99, 0.99] (0.99–0.99) | no |
| Graviton4 | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.33 [0.32, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.37 [0.36, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | PyTorch, f32 | 0.80 [0.80, 0.80] (0.80–0.80) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | PyTorch, bf16 | 0.98 [0.98, 0.99] (0.98–0.99) | yes |
| Graviton4 | warm sweep | q32-d4096-lennat | NextPlaid, f32 | 0.99 [0.99, 1.00] (0.99–0.99) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | NumKong (approx.), bf16 | 0.36 [0.35, 0.38] (0.35–0.37) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.41] (0.38–0.40) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | NumKong (approx.), f32 | 0.43 [0.41, 0.45] (0.42–0.44) | yes |
| Graviton4 | warm sweep | q32-d64-len128 | PyTorch, bf16 | 0.89 [0.86, 0.92] (0.87–0.91) | yes |
| Graviton4 | warm sweep | q32-d64-len32 | NumKong (approx.), bf16 | 0.85 [0.84, 0.87] (0.85–0.86) | yes |
| Graviton4 | warm sweep | q32-d64-len32 | NumKong (approx.), f16 | 0.93 [0.92, 0.95] (0.93–0.93) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.37] (0.33–0.36) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.38] (0.34–0.37) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | NumKong (approx.), f32 | 0.38 [0.37, 0.40] (0.36–0.39) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | PyTorch, bf16 | 0.54 [0.52, 0.56] (0.52–0.56) | yes |
| Graviton4 | warm sweep | q32-d64-len512 | PyTorch, f32 | 0.91 [0.87, 0.94] (0.86–0.93) | yes |
| Graviton4 | warm sweep | q32-d64-lennat | NumKong (approx.), bf16 | 0.46 [0.44, 0.48] (0.45–0.46) | yes |
| Graviton4 | warm sweep | q32-d64-lennat | NumKong (approx.), f16 | 0.50 [0.47, 0.52] (0.48–0.50) | yes |
| Graviton4 | warm sweep | q32-d64-lennat | NumKong (approx.), f32 | 0.51 [0.49, 0.53] (0.50–0.52) | yes |
| Graviton4 | warm sweep | q64-d1-len128 | NumPy, f32 | 0.84 [0.82, 0.85] (0.83–0.84) | yes |
| Graviton4 | warm sweep | q64-d1-len128 | NumKong (approx.), bf16 | 0.98 [0.95, 1.00] (0.97–0.98) | no |
| Graviton4 | warm sweep | q64-d1-lennat | NumPy, f32 | 0.89 [0.81, 0.96] (0.88–0.89) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | NumKong (approx.), bf16 | 0.36 [0.36, 0.36] (0.36–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | NumKong (approx.), f16 | 0.39 [0.39, 0.39] (0.39–0.39) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | NumKong (approx.), f32 | 0.44 [0.44, 0.45] (0.44–0.44) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | PyTorch, bf16 | 0.51 [0.51, 0.51] (0.51–0.51) | yes |
| Graviton4 | warm sweep | q64-d1024-len128 | PyTorch, f32 | 0.99 [0.98, 0.99] (0.98–0.99) | no |
| Graviton4 | warm sweep | q64-d1024-len32 | NumKong (approx.), bf16 | 0.39 [0.38, 0.39] (0.38–0.39) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | PyTorch, bf16 | 0.45 [0.45, 0.45] (0.45–0.45) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | NumKong (approx.), f16 | 0.48 [0.48, 0.48] (0.48–0.48) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | NumKong (approx.), f32 | 0.62 [0.62, 0.62] (0.62–0.62) | yes |
| Graviton4 | warm sweep | q64-d1024-len32 | PyTorch, f32 | 0.90 [0.90, 0.91] (0.90–0.91) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NumKong (approx.), bf16 | 0.34 [0.33, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NumKong (approx.), f16 | 0.35 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NumKong (approx.), f32 | 0.36 [0.36, 0.36] (0.36–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | PyTorch, bf16 | 0.46 [0.46, 0.46] (0.46–0.46) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | PyTorch, f32 | 0.92 [0.91, 0.92] (0.92–0.92) | yes |
| Graviton4 | warm sweep | q64-d1024-len512 | NextPlaid, f32 | 0.97 [0.97, 0.98] (0.97–0.97) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | NumKong (approx.), bf16 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | NumKong (approx.), f16 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | NumKong (approx.), f32 | 0.40 [0.40, 0.40] (0.40–0.40) | yes |
| Graviton4 | warm sweep | q64-d1024-lennat | PyTorch, bf16 | 0.94 [0.93, 0.95] (0.94–0.94) | yes |
| Graviton4 | warm sweep | q64-d16-len128 | NumKong (approx.), bf16 | 0.46 [0.43, 0.48] (0.43–0.47) | yes |
| Graviton4 | warm sweep | q64-d16-len128 | NumKong (approx.), f16 | 0.49 [0.46, 0.52] (0.46–0.50) | yes |
| Graviton4 | warm sweep | q64-d16-len128 | NumKong (approx.), f32 | 0.51 [0.48, 0.53] (0.48–0.53) | yes |
| Graviton4 | warm sweep | q64-d16-len32 | NumKong (approx.), bf16 | 0.82 [0.78, 0.87] (0.75–0.86) | yes |
| Graviton4 | warm sweep | q64-d16-len32 | NumKong (approx.), f16 | 0.89 [0.85, 0.93] (0.82–0.91) | yes |
| Graviton4 | warm sweep | q64-d16-len32 | NumKong (approx.), f32 | 0.96 [0.92, 1.00] (0.88–1.00) | no |
| Graviton4 | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.34 [0.32, 0.36] (0.33–0.35) | yes |
| Graviton4 | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.35 [0.33, 0.37] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.36 [0.34, 0.38] (0.35–0.37) | yes |
| Graviton4 | warm sweep | q64-d16-len512 | PyTorch, bf16 | 0.62 [0.59, 0.66] (0.61–0.64) | yes |
| Graviton4 | warm sweep | q64-d16-lennat | NumKong (approx.), bf16 | 0.83 [0.77, 0.89] (0.82–0.84) | yes |
| Graviton4 | warm sweep | q64-d16-lennat | NumKong (approx.), f16 | 0.87 [0.81, 0.93] (0.85–0.89) | yes |
| Graviton4 | warm sweep | q64-d16-lennat | NumKong (approx.), f32 | 0.87 [0.82, 0.93] (0.86–0.88) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | NumKong (approx.), bf16 | 0.35 [0.35, 0.36] (0.34–0.35) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | NumKong (approx.), f16 | 0.38 [0.37, 0.38] (0.37–0.38) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | NumKong (approx.), f32 | 0.41 [0.40, 0.41] (0.40–0.41) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | PyTorch, bf16 | 0.46 [0.45, 0.46] (0.45–0.46) | yes |
| Graviton4 | warm sweep | q64-d256-len128 | PyTorch, f32 | 0.91 [0.90, 0.92] (0.89–0.91) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | NumKong (approx.), bf16 | 0.44 [0.43, 0.44] (0.43–0.44) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | NumKong (approx.), f16 | 0.53 [0.52, 0.54] (0.53–0.53) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | NumKong (approx.), f32 | 0.67 [0.66, 0.68] (0.67–0.67) | yes |
| Graviton4 | warm sweep | q64-d256-len32 | PyTorch, bf16 | 0.69 [0.68, 0.70] (0.69–0.70) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.32 [0.28, 0.34] (0.32–0.32) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.33 [0.29, 0.35] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.34 [0.30, 0.36] (0.33–0.34) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | PyTorch, bf16 | 0.45 [0.40, 0.48] (0.45–0.45) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | PyTorch, f32 | 0.91 [0.81, 0.97] (0.90–0.91) | yes |
| Graviton4 | warm sweep | q64-d256-len512 | NextPlaid, f32 | 0.96 [0.85, 1.03] (0.95–0.96) | no |
| Graviton4 | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.38 [0.38, 0.39] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.40 [0.40, 0.41] (0.40–0.40) | yes |
| Graviton4 | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.42 [0.42, 0.43] (0.42–0.42) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NumKong (approx.), bf16 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NumKong (approx.), f16 | 0.37 [0.37, 0.38] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.42, 0.42] (0.42–0.42) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | PyTorch, bf16 | 0.44 [0.44, 0.45] (0.44–0.44) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | PyTorch, f32 | 0.91 [0.91, 0.91] (0.91–0.91) | yes |
| Graviton4 | warm sweep | q64-d4096-len128 | NextPlaid, f32 | 0.99 [0.99, 0.99] (0.99–0.99) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | NumKong (approx.), bf16 | 0.38 [0.38, 0.38] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | PyTorch, bf16 | 0.44 [0.44, 0.44] (0.44–0.44) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | NumKong (approx.), f16 | 0.47 [0.47, 0.47] (0.47–0.47) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | NumKong (approx.), f32 | 0.61 [0.61, 0.62] (0.61–0.62) | yes |
| Graviton4 | warm sweep | q64-d4096-len32 | PyTorch, f32 | 0.87 [0.87, 0.88] (0.87–0.88) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.33 [0.33, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.35 [0.34, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | PyTorch, bf16 | 0.44 [0.44, 0.44] (0.44–0.44) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | PyTorch, f32 | 0.91 [0.91, 0.91] (0.91–0.91) | yes |
| Graviton4 | warm sweep | q64-d4096-len512 | NextPlaid, f32 | 0.96 [0.96, 0.97] (0.96–0.96) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.33 [0.33, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.35 [0.35, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | PyTorch, bf16 | 0.85 [0.85, 0.86] (0.85–0.85) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | PyTorch, f32 | 0.92 [0.92, 0.93] (0.92–0.93) | yes |
| Graviton4 | warm sweep | q64-d4096-lennat | NextPlaid, f32 | 0.97 [0.97, 0.97] (0.97–0.97) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | NumKong (approx.), bf16 | 0.38 [0.37, 0.39] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | NumKong (approx.), f16 | 0.43 [0.41, 0.44] (0.42–0.43) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | NumKong (approx.), f32 | 0.45 [0.44, 0.47] (0.45–0.46) | yes |
| Graviton4 | warm sweep | q64-d64-len128 | PyTorch, bf16 | 0.66 [0.64, 0.68] (0.66–0.67) | yes |
| Graviton4 | warm sweep | q64-d64-len32 | NumKong (approx.), bf16 | 0.63 [0.62, 0.65] (0.63–0.64) | yes |
| Graviton4 | warm sweep | q64-d64-len32 | NumKong (approx.), f16 | 0.73 [0.71, 0.74] (0.72–0.73) | yes |
| Graviton4 | warm sweep | q64-d64-len32 | NumKong (approx.), f32 | 0.84 [0.83, 0.86] (0.83–0.85) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.35] (0.34–0.35) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | NumKong (approx.), f32 | 0.36 [0.36, 0.37] (0.36–0.37) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | PyTorch, bf16 | 0.46 [0.45, 0.48] (0.46–0.47) | yes |
| Graviton4 | warm sweep | q64-d64-len512 | PyTorch, f32 | 0.94 [0.92, 0.95] (0.92–0.95) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | NumKong (approx.), bf16 | 0.43 [0.39, 0.46] (0.43–0.44) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | NumKong (approx.), f16 | 0.46 [0.41, 0.50] (0.45–0.46) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | NumKong (approx.), f32 | 0.47 [0.43, 0.52] (0.47–0.48) | yes |
| Graviton4 | warm sweep | q64-d64-lennat | PyTorch, bf16 | 0.76 [0.67, 0.83] (0.74–0.77) | yes |
| Graviton4 | warm sweep | q8-d1-len128 | NumKong (approx.), f32 | 0.99 [0.98, 1.01] (0.99–1.00) | no |
| Graviton4 | warm sweep | q8-d1024-len128 | NumKong (approx.), bf16 | 0.35 [0.34, 0.36] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d1024-len128 | NumKong (approx.), f16 | 0.37 [0.36, 0.37] (0.36–0.37) | yes |
| Graviton4 | warm sweep | q8-d1024-len128 | NumKong (approx.), f32 | 0.40 [0.40, 0.41] (0.40–0.41) | yes |
| Graviton4 | warm sweep | q8-d1024-len32 | NumKong (approx.), bf16 | 0.50 [0.49, 0.51] (0.50–0.50) | yes |
| Graviton4 | warm sweep | q8-d1024-len32 | NumKong (approx.), f16 | 0.55 [0.53, 0.56] (0.54–0.55) | yes |
| Graviton4 | warm sweep | q8-d1024-len32 | NumKong (approx.), f32 | 0.65 [0.64, 0.66] (0.65–0.66) | yes |
| Graviton4 | warm sweep | q8-d1024-len512 | NumKong (approx.), bf16 | 0.32 [0.32, 0.32] (0.32–0.32) | yes |
| Graviton4 | warm sweep | q8-d1024-len512 | NumKong (approx.), f16 | 0.34 [0.33, 0.34] (0.34–0.34) | yes |
| Graviton4 | warm sweep | q8-d1024-len512 | NumKong (approx.), f32 | 0.35 [0.34, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d1024-lennat | NumKong (approx.), bf16 | 0.35 [0.35, 0.36] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d1024-lennat | NumKong (approx.), f16 | 0.37 [0.37, 0.37] (0.37–0.37) | yes |
| Graviton4 | warm sweep | q8-d1024-lennat | NumKong (approx.), f32 | 0.39 [0.39, 0.40] (0.39–0.39) | yes |
| Graviton4 | warm sweep | q8-d16-len128 | NumKong (approx.), bf16 | 0.91 [0.83, 0.98] (0.86–0.93) | yes |
| Graviton4 | warm sweep | q8-d16-len128 | NumKong (approx.), f16 | 0.92 [0.85, 0.99] (0.87–0.94) | yes |
| Graviton4 | warm sweep | q8-d16-len128 | NumKong (approx.), f32 | 0.92 [0.85, 0.99] (0.87–0.95) | no |
| Graviton4 | warm sweep | q8-d16-len512 | NumKong (approx.), bf16 | 0.50 [0.48, 0.52] (0.48–0.51) | yes |
| Graviton4 | warm sweep | q8-d16-len512 | NumKong (approx.), f16 | 0.51 [0.49, 0.52] (0.50–0.51) | yes |
| Graviton4 | warm sweep | q8-d16-len512 | NumKong (approx.), f32 | 0.51 [0.50, 0.53] (0.50–0.53) | yes |
| Graviton4 | warm sweep | q8-d16-lennat | NumKong (approx.), bf16 | 0.79 [0.74, 0.84] (0.77–0.80) | yes |
| Graviton4 | warm sweep | q8-d16-lennat | NumKong (approx.), f16 | 0.80 [0.75, 0.85] (0.78–0.80) | yes |
| Graviton4 | warm sweep | q8-d16-lennat | NumKong (approx.), f32 | 0.81 [0.76, 0.85] (0.79–0.81) | yes |
| Graviton4 | warm sweep | q8-d256-len128 | NumKong (approx.), bf16 | 0.32 [0.30, 0.33] (0.31–0.32) | yes |
| Graviton4 | warm sweep | q8-d256-len128 | NumKong (approx.), f16 | 0.33 [0.32, 0.35] (0.33–0.34) | yes |
| Graviton4 | warm sweep | q8-d256-len128 | NumKong (approx.), f32 | 0.35 [0.33, 0.37] (0.34–0.36) | yes |
| Graviton4 | warm sweep | q8-d256-len32 | NumKong (approx.), bf16 | 0.74 [0.72, 0.76] (0.74–0.75) | yes |
| Graviton4 | warm sweep | q8-d256-len32 | NumKong (approx.), f16 | 0.78 [0.76, 0.79] (0.77–0.78) | yes |
| Graviton4 | warm sweep | q8-d256-len32 | NumKong (approx.), f32 | 0.82 [0.80, 0.84] (0.82–0.83) | yes |
| Graviton4 | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.28 [0.24, 0.32] (0.27–0.28) | yes |
| Graviton4 | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.30 [0.25, 0.34] (0.29–0.30) | yes |
| Graviton4 | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.30 [0.26, 0.34] (0.29–0.30) | yes |
| Graviton4 | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.27 [0.25, 0.29] (0.26–0.28) | yes |
| Graviton4 | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.27 [0.25, 0.29] (0.27–0.28) | yes |
| Graviton4 | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.29 [0.26, 0.31] (0.28–0.30) | yes |
| Graviton4 | warm sweep | q8-d4096-len128 | NumKong (approx.), bf16 | 0.35 [0.34, 0.35] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d4096-len128 | NumKong (approx.), f16 | 0.38 [0.37, 0.39] (0.38–0.38) | yes |
| Graviton4 | warm sweep | q8-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.40, 0.43] (0.41–0.42) | yes |
| Graviton4 | warm sweep | q8-d4096-len32 | NumKong (approx.), bf16 | 0.45 [0.43, 0.47] (0.45–0.45) | yes |
| Graviton4 | warm sweep | q8-d4096-len32 | NumKong (approx.), f16 | 0.51 [0.49, 0.53] (0.51–0.51) | yes |
| Graviton4 | warm sweep | q8-d4096-len32 | NumKong (approx.), f32 | 0.63 [0.60, 0.67] (0.63–0.63) | yes |
| Graviton4 | warm sweep | q8-d4096-len512 | NumKong (approx.), bf16 | 0.30 [0.30, 0.30] (0.30–0.30) | yes |
| Graviton4 | warm sweep | q8-d4096-len512 | NumKong (approx.), f16 | 0.32 [0.31, 0.32] (0.32–0.32) | yes |
| Graviton4 | warm sweep | q8-d4096-len512 | NumKong (approx.), f32 | 0.33 [0.32, 0.33] (0.33–0.33) | yes |
| Graviton4 | warm sweep | q8-d4096-lennat | NumKong (approx.), bf16 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| Graviton4 | warm sweep | q8-d4096-lennat | NumKong (approx.), f16 | 0.34 [0.33, 0.34] (0.33–0.34) | yes |
| Graviton4 | warm sweep | q8-d4096-lennat | NumKong (approx.), f32 | 0.35 [0.35, 0.36] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d64-len128 | NumKong (approx.), bf16 | 0.66 [0.65, 0.67] (0.65–0.67) | yes |
| Graviton4 | warm sweep | q8-d64-len128 | NumKong (approx.), f16 | 0.68 [0.67, 0.70] (0.67–0.69) | yes |
| Graviton4 | warm sweep | q8-d64-len128 | NumKong (approx.), f32 | 0.70 [0.69, 0.71] (0.69–0.71) | yes |
| Graviton4 | warm sweep | q8-d64-len32 | NumKong (approx.), bf16 | 0.98 [0.84, 1.12] (0.98–0.99) | no |
| Graviton4 | warm sweep | q8-d64-len512 | NumKong (approx.), bf16 | 0.35 [0.34, 0.36] (0.35–0.35) | yes |
| Graviton4 | warm sweep | q8-d64-len512 | NumKong (approx.), f16 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Graviton4 | warm sweep | q8-d64-len512 | NumKong (approx.), f32 | 0.38 [0.36, 0.40] (0.37–0.38) | yes |
| Graviton4 | warm sweep | q8-d64-lennat | NumKong (approx.), bf16 | 0.37 [0.32, 0.41] (0.35–0.37) | yes |
| Graviton4 | warm sweep | q8-d64-lennat | NumKong (approx.), f16 | 0.38 [0.33, 0.42] (0.37–0.38) | yes |
| Graviton4 | warm sweep | q8-d64-lennat | NumKong (approx.), f32 | 0.39 [0.33, 0.43] (0.38–0.39) | yes |
| EPYC | one thread | agent-ho | NumKong (approx.), f16 | 0.60 [0.60, 0.61] (0.58–0.63) | yes |
| EPYC | one thread | beir | NumKong (approx.), f16 | 0.66 [0.66, 0.66] (0.66–0.66) | yes |
| EPYC | one thread | beir | NumPy, f32 | 0.88 [0.88, 0.88] (0.88–0.88) | yes |
| EPYC | one thread | gcsn-ho | NumKong (approx.), f16 | 0.64 [0.63, 0.64] (0.64–0.64) | yes |
| EPYC | pool-parked | agent-ho | NumPy, f32 | 0.71 [0.70, 0.72] (0.70–0.71) | yes |
| EPYC | pool-parked | gcsn-ho | NumPy, f32 | 0.69 [0.69, 0.70] (0.69–0.70) | yes |
| EPYC | warm BEIR set | beir-scifact-answersmall-k10 | NumPy, f32 | 0.97 [0.96, 0.98] (0.96–0.99) | yes |
| EPYC | warm sweep | q32-d16-lennat | NumPy, f32 | 0.90 [0.78, 1.02] (0.89–0.92) | no |
| EPYC | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.93 [0.68, 1.23] (0.91–0.94) | no |
| EPYC | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.94 [0.67, 1.24] (0.92–0.99) | no |
| EPYC | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.62 [0.59, 0.65] (0.62–0.62) | yes |
| EPYC | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.62 [0.59, 0.66] (0.62–0.62) | yes |
| EPYC | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.64 [0.60, 0.67] (0.63–0.64) | yes |
| EPYC | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.67 [0.63, 0.70] (0.67–0.67) | yes |
| EPYC | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.67 [0.63, 0.71] (0.67–0.67) | yes |
| EPYC | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.70 [0.66, 0.73] (0.69–0.70) | yes |
| EPYC | warm sweep | q64-d1-len512 | NumPy, f32 | 0.87 [0.81, 0.92] (0.83–0.88) | yes |
| EPYC | warm sweep | q64-d1-lennat | NumPy, f32 | 0.91 [0.87, 0.95] (0.88–0.93) | yes |
| EPYC | warm sweep | q64-d16-len512 | PyTorch, f32 | 0.89 [0.87, 0.92] (0.89–0.90) | yes |
| EPYC | warm sweep | q64-d16-len512 | NumPy, f32 | 0.90 [0.85, 0.94] (0.90–0.90) | yes |
| EPYC | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.68 [0.64, 0.72] (0.68–0.68) | yes |
| EPYC | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.68 [0.64, 0.72] (0.68–0.68) | yes |
| EPYC | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.70 [0.66, 0.74] (0.69–0.70) | yes |
| EPYC | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.67 [0.63, 0.71] (0.66–0.67) | yes |
| EPYC | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.67 [0.63, 0.71] (0.67–0.67) | yes |
| EPYC | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.69 [0.65, 0.73] (0.68–0.69) | yes |
| EPYC | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.91 [0.74, 1.05] (0.91–0.95) | no |
| EPYC | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.92 [0.70, 1.09] (0.91–0.94) | no |
| EPYC | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.99 [0.90, 1.08] (0.97–1.01) | no |
| EPYC | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.76 [0.53, 1.00] (0.74–0.78) | no |
| EPYC | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.94 [0.75, 1.17] (0.90–0.99) | no |
| EPYC | warm sweep | q8-d4096-len512 | NumKong (approx.), bf16 | 0.75 [0.71, 0.78] (0.74–0.75) | yes |
| EPYC | warm sweep | q8-d4096-len512 | NumKong (approx.), f32 | 0.75 [0.71, 0.80] (0.74–0.76) | yes |
| EPYC | warm sweep | q8-d4096-len512 | NumKong (approx.), f16 | 0.76 [0.72, 0.80] (0.76–0.76) | yes |
| EPYC | warm sweep | q8-d4096-lennat | NumKong (approx.), bf16 | 0.99 [0.86, 1.07] (0.98–0.99) | no |
| EPYC | warm sweep | q8-d4096-lennat | NumKong (approx.), f16 | 0.99 [0.87, 1.07] (0.99–1.00) | no |
| Intel | one thread | agent-ho | NumKong (approx.), f16 | 0.10 [0.10, 0.11] (0.10–0.10) | yes |
| Intel | one thread | beir | NumKong (approx.), f16 | 0.12 [0.12, 0.12] (0.12–0.12) | yes |
| Intel | one thread | beir | NumPy, f32 | 0.83 [0.83, 0.83] (0.83–0.83) | yes |
| Intel | one thread | beir | PyTorch, f32 | 0.85 [0.85, 0.85] (0.85–0.85) | yes |
| Intel | one thread | gcsn-ho | NumKong (approx.), f16 | 0.15 [0.15, 0.15] (0.15–0.15) | yes |
| Intel | pool-parked | agent-ho | NumKong (approx.), f16 | 0.26 [0.24, 0.27] (0.25–0.26) | yes |
| Intel | pool-parked | agent-ho | NumPy, f32 | 0.61 [0.58, 0.64] (0.61–0.61) | yes |
| Intel | pool-parked | beir | NumKong (approx.), bf16 | 0.78 [0.77, 0.79] (0.76–0.78) | yes |
| Intel | pool-parked | beir | NumPy, f32 | 0.79 [0.79, 0.79] (0.79–0.79) | yes |
| Intel | pool-parked | beir | NumKong (approx.), f16 | 0.80 [0.79, 0.80] (0.76–0.80) | yes |
| Intel | pool-parked | beir | NumKong (approx.), f32 | 0.82 [0.81, 0.82] (0.80–0.82) | yes |
| Intel | pool-parked | gcsn-ho | NumKong (approx.), f16 | 0.21 [0.21, 0.21] (0.21–0.21) | yes |
| Intel | pool-parked | gcsn-ho | NumPy, f32 | 0.50 [0.50, 0.50] (0.50–0.50) | yes |
| Intel | warm | agent-ho | NumKong (approx.), f16 | 0.61 [0.60, 0.63] (0.61–0.61) | yes |
| Intel | warm | agent-ho | NumKong (approx.), f32 | 0.64 [0.59, 0.70] (0.64–0.64) | yes |
| Intel | warm | agent-ho | NumKong (approx.), bf16 | 0.70 [0.65, 0.77] (0.70–0.70) | yes |
| Intel | warm | beir | NumKong (approx.), f16 | 0.33 [0.33, 0.33] (0.33–0.33) | yes |
| Intel | warm | beir | NumKong (approx.), f32 | 0.34 [0.34, 0.34] (0.34–0.34) | yes |
| Intel | warm | beir | NumKong (approx.), bf16 | 0.35 [0.34, 0.35] (0.35–0.35) | yes |
| Intel | warm | beir | PyTorch, f32 | 0.62 [0.62, 0.62] (0.62–0.62) | yes |
| Intel | warm | beir | PyTorch, bf16 | 0.85 [0.85, 0.86] (0.85–0.86) | yes |
| Intel | warm | gcsn-ho | NumKong (approx.), f16 | 0.72 [0.72, 0.73] (0.72–0.73) | yes |
| Intel | warm | gcsn-ho | NumKong (approx.), bf16 | 0.88 [0.88, 0.89] (0.88–0.89) | yes |
| Intel | warm | gcsn-ho | NumKong (approx.), f32 | 0.90 [0.89, 0.91] (0.89–0.91) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k10 | NumKong (approx.), bf16 | 0.73 [0.72, 0.74] (0.73–0.74) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k10 | NumKong (approx.), f32 | 0.75 [0.74, 0.76] (0.75–0.76) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k10 | NumKong (approx.), f16 | 0.76 [0.74, 0.77] (0.75–0.76) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k10 | PyTorch, f32 | 0.84 [0.83, 0.85] (0.84–0.85) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f16 | 0.21 [0.20, 0.21] (0.20–0.21) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f32 | 0.23 [0.23, 0.23] (0.23–0.23) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), bf16 | 0.25 [0.25, 0.25] (0.25–0.25) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k100 | PyTorch, f32 | 0.54 [0.54, 0.55] (0.54–0.54) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k100 | PyTorch, bf16 | 0.57 [0.57, 0.58] (0.57–0.57) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f16 | 0.18 [0.18, 0.18] (0.18–0.18) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f32 | 0.19 [0.19, 0.20] (0.19–0.20) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), bf16 | 0.20 [0.20, 0.21] (0.20–0.21) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k200 | PyTorch, bf16 | 0.50 [0.49, 0.50] (0.50–0.50) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k200 | PyTorch, f32 | 0.57 [0.57, 0.57] (0.57–0.57) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k25 | NumKong (approx.), f32 | 0.44 [0.43, 0.44] (0.44–0.44) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k25 | NumKong (approx.), f16 | 0.44 [0.44, 0.44] (0.44–0.44) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k25 | NumKong (approx.), bf16 | 0.44 [0.44, 0.45] (0.44–0.45) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k25 | PyTorch, f32 | 0.76 [0.75, 0.77] (0.75–0.77) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), f16 | 0.28 [0.28, 0.28] (0.28–0.28) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), f32 | 0.29 [0.28, 0.29] (0.28–0.29) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), bf16 | 0.29 [0.29, 0.30] (0.29–0.30) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k50 | PyTorch, f32 | 0.57 [0.56, 0.57] (0.56–0.57) | yes |
| Intel | warm BEIR set | beir-nfcorpus-answersmall-k50 | PyTorch, bf16 | 0.77 [0.76, 0.77] (0.76–0.77) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k10 | NumKong (approx.), bf16 | 0.73 [0.72, 0.74] (0.73–0.74) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k10 | NumKong (approx.), f16 | 0.76 [0.75, 0.77] (0.76–0.77) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k10 | NumKong (approx.), f32 | 0.77 [0.76, 0.78] (0.77–0.78) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k10 | PyTorch, f32 | 0.82 [0.81, 0.83] (0.82–0.82) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f16 | 0.23 [0.23, 0.23] (0.23–0.23) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f32 | 0.25 [0.25, 0.25] (0.25–0.25) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), bf16 | 0.27 [0.26, 0.27] (0.26–0.27) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k100 | PyTorch, f32 | 0.50 [0.49, 0.50] (0.50–0.50) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k100 | PyTorch, bf16 | 0.65 [0.65, 0.66] (0.65–0.65) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f16 | 0.18 [0.18, 0.18] (0.18–0.18) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f32 | 0.19 [0.19, 0.20] (0.19–0.20) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), bf16 | 0.22 [0.22, 0.22] (0.22–0.22) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k200 | PyTorch, bf16 | 0.55 [0.55, 0.56] (0.54–0.55) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k200 | PyTorch, f32 | 0.56 [0.56, 0.57] (0.56–0.57) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k25 | NumKong (approx.), f16 | 0.46 [0.45, 0.46] (0.46–0.46) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k25 | NumKong (approx.), bf16 | 0.46 [0.46, 0.46] (0.46–0.46) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k25 | NumKong (approx.), f32 | 0.46 [0.46, 0.47] (0.46–0.47) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k25 | PyTorch, f32 | 0.71 [0.71, 0.72] (0.71–0.72) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), f16 | 0.29 [0.29, 0.29] (0.29–0.29) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), f32 | 0.30 [0.30, 0.31] (0.30–0.30) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), bf16 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k50 | PyTorch, f32 | 0.52 [0.51, 0.52] (0.52–0.52) | yes |
| Intel | warm BEIR set | beir-nfcorpus-colbertv2-k50 | PyTorch, bf16 | 0.80 [0.80, 0.81] (0.80–0.80) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k10 | NumKong (approx.), bf16 | 0.65 [0.65, 0.66] (0.65–0.66) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k10 | NumKong (approx.), f16 | 0.68 [0.67, 0.69] (0.68–0.69) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k10 | NumKong (approx.), f32 | 0.69 [0.68, 0.70] (0.69–0.70) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k10 | PyTorch, f32 | 0.81 [0.80, 0.82] (0.80–0.81) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f16 | 0.21 [0.21, 0.22] (0.21–0.22) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f32 | 0.23 [0.23, 0.23] (0.23–0.23) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), bf16 | 0.25 [0.24, 0.25] (0.24–0.25) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k100 | PyTorch, f32 | 0.50 [0.50, 0.51] (0.50–0.51) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k100 | PyTorch, bf16 | 0.56 [0.55, 0.56] (0.56–0.56) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f16 | 0.18 [0.18, 0.18] (0.18–0.18) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f32 | 0.20 [0.20, 0.20] (0.20–0.20) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), bf16 | 0.20 [0.20, 0.20] (0.20–0.20) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k200 | PyTorch, bf16 | 0.51 [0.51, 0.52] (0.51–0.51) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k200 | PyTorch, f32 | 0.58 [0.57, 0.58] (0.58–0.58) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k25 | NumKong (approx.), bf16 | 0.41 [0.41, 0.42] (0.41–0.42) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k25 | NumKong (approx.), f32 | 0.42 [0.41, 0.42] (0.42–0.42) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k25 | NumKong (approx.), f16 | 0.42 [0.41, 0.42] (0.42–0.42) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k25 | PyTorch, f32 | 0.67 [0.66, 0.67] (0.66–0.67) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f16 | 0.27 [0.27, 0.27] (0.27–0.27) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f32 | 0.27 [0.27, 0.28] (0.27–0.28) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), bf16 | 0.28 [0.27, 0.28] (0.28–0.28) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k50 | PyTorch, f32 | 0.56 [0.55, 0.56] (0.56–0.56) | yes |
| Intel | warm BEIR set | beir-scifact-answersmall-k50 | PyTorch, bf16 | 0.71 [0.70, 0.71] (0.71–0.71) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k10 | NumKong (approx.), bf16 | 0.71 [0.70, 0.72] (0.71–0.72) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k10 | NumKong (approx.), f16 | 0.76 [0.75, 0.77] (0.75–0.77) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k10 | NumKong (approx.), f32 | 0.76 [0.75, 0.77] (0.76–0.77) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k10 | PyTorch, f32 | 0.82 [0.80, 0.83] (0.81–0.82) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f16 | 0.22 [0.22, 0.22] (0.22–0.22) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), bf16 | 0.24 [0.24, 0.24] (0.24–0.24) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f32 | 0.26 [0.25, 0.26] (0.26–0.26) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k100 | PyTorch, f32 | 0.51 [0.51, 0.52] (0.51–0.51) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k100 | PyTorch, bf16 | 0.58 [0.58, 0.59] (0.58–0.58) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f16 | 0.20 [0.20, 0.20] (0.20–0.20) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f32 | 0.22 [0.22, 0.23] (0.22–0.22) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), bf16 | 0.23 [0.23, 0.23] (0.23–0.23) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k200 | PyTorch, bf16 | 0.56 [0.55, 0.56] (0.55–0.56) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k200 | PyTorch, f32 | 0.57 [0.56, 0.57] (0.57–0.57) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), f16 | 0.45 [0.45, 0.45] (0.45–0.45) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), bf16 | 0.46 [0.46, 0.46] (0.46–0.46) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k25 | NumKong (approx.), f32 | 0.47 [0.47, 0.48] (0.47–0.48) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k25 | PyTorch, f32 | 0.71 [0.70, 0.71] (0.71–0.71) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f16 | 0.29 [0.29, 0.29] (0.29–0.29) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), bf16 | 0.30 [0.30, 0.31] (0.30–0.31) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f32 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k50 | PyTorch, f32 | 0.54 [0.54, 0.54] (0.54–0.54) | yes |
| Intel | warm BEIR set | beir-scifact-colbertv2-k50 | PyTorch, bf16 | 0.77 [0.77, 0.77] (0.77–0.78) | yes |
| Intel | warm sweep | q32-d1-len128 | NumKong (approx.), bf16 | 0.60 [0.59, 0.61] (0.59–0.60) | yes |
| Intel | warm sweep | q32-d1-len128 | NumKong (approx.), f16 | 0.95 [0.93, 0.98] (0.91–0.98) | no |
| Intel | warm sweep | q32-d1-len128 | NumKong (approx.), f32 | 0.99 [0.97, 1.02] (0.93–1.41) | no |
| Intel | warm sweep | q32-d1-len512 | NumKong (approx.), bf16 | 0.51 [0.49, 0.54] (0.50–0.53) | yes |
| Intel | warm sweep | q32-d1-len512 | NumKong (approx.), f32 | 0.85 [0.79, 0.90] (0.81–0.88) | yes |
| Intel | warm sweep | q32-d1-len512 | NumKong (approx.), f16 | 0.86 [0.80, 0.91] (0.80–0.88) | yes |
| Intel | warm sweep | q32-d1-len512 | PyTorch, f32 | 0.92 [0.86, 0.96] (0.88–0.94) | yes |
| Intel | warm sweep | q32-d1-lennat | NumKong (approx.), bf16 | 0.54 [0.51, 0.58] (0.53–0.54) | yes |
| Intel | warm sweep | q32-d1024-len128 | NumKong (approx.), f16 | 0.19 [0.18, 0.20] (0.19–0.19) | yes |
| Intel | warm sweep | q32-d1024-len128 | NumKong (approx.), bf16 | 0.20 [0.19, 0.21] (0.20–0.20) | yes |
| Intel | warm sweep | q32-d1024-len128 | NumKong (approx.), f32 | 0.22 [0.21, 0.23] (0.21–0.22) | yes |
| Intel | warm sweep | q32-d1024-len128 | PyTorch, bf16 | 0.57 [0.49, 0.69] (0.54–0.58) | yes |
| Intel | warm sweep | q32-d1024-len128 | PyTorch, f32 | 0.78 [0.74, 0.83] (0.75–0.86) | no |
| Intel | warm sweep | q32-d1024-len32 | NumKong (approx.), bf16 | 0.25 [0.24, 0.25] (0.24–0.25) | yes |
| Intel | warm sweep | q32-d1024-len32 | NumKong (approx.), f16 | 0.30 [0.30, 0.31] (0.30–0.30) | yes |
| Intel | warm sweep | q32-d1024-len32 | NumKong (approx.), f32 | 0.39 [0.38, 0.40] (0.39–0.39) | yes |
| Intel | warm sweep | q32-d1024-len32 | PyTorch, bf16 | 0.54 [0.53, 0.55] (0.54–0.54) | yes |
| Intel | warm sweep | q32-d1024-len32 | PyTorch, f32 | 0.71 [0.70, 0.73] (0.71–0.72) | yes |
| Intel | warm sweep | q32-d1024-len512 | NumKong (approx.), f16 | 0.14 [0.13, 0.15] (0.14–0.14) | yes |
| Intel | warm sweep | q32-d1024-len512 | NumKong (approx.), f32 | 0.15 [0.14, 0.16] (0.15–0.15) | yes |
| Intel | warm sweep | q32-d1024-len512 | NumKong (approx.), bf16 | 0.19 [0.18, 0.20] (0.19–0.19) | yes |
| Intel | warm sweep | q32-d1024-len512 | PyTorch, bf16 | 0.90 [0.86, 0.95] (0.90–0.91) | yes |
| Intel | warm sweep | q32-d1024-lennat | NumKong (approx.), f16 | 0.15 [0.15, 0.16] (0.15–0.15) | yes |
| Intel | warm sweep | q32-d1024-lennat | NumKong (approx.), f32 | 0.16 [0.16, 0.17] (0.16–0.16) | yes |
| Intel | warm sweep | q32-d1024-lennat | NumKong (approx.), bf16 | 0.19 [0.18, 0.20] (0.19–0.19) | yes |
| Intel | warm sweep | q32-d1024-lennat | PyTorch, f32 | 0.93 [0.79, 1.18] (0.92–0.94) | no |
| Intel | warm sweep | q32-d16-len128 | NumKong (approx.), f16 | 0.61 [0.58, 0.65] (0.58–0.61) | yes |
| Intel | warm sweep | q32-d16-len128 | NumKong (approx.), bf16 | 0.62 [0.58, 0.65] (0.58–0.61) | yes |
| Intel | warm sweep | q32-d16-len128 | NumKong (approx.), f32 | 0.66 [0.63, 0.69] (0.62–0.65) | yes |
| Intel | warm sweep | q32-d16-len128 | PyTorch, f32 | 0.76 [0.70, 0.82] (0.72–0.75) | yes |
| Intel | warm sweep | q32-d16-len32 | NumKong (approx.), bf16 | 0.86 [0.74, 0.98] (0.80–0.91) | yes |
| Intel | warm sweep | q32-d16-len32 | NumKong (approx.), f16 | 1.00 [0.86, 1.12] (0.93–1.06) | no |
| Intel | warm sweep | q32-d16-len512 | NumKong (approx.), f16 | 0.25 [0.23, 0.27] (0.25–0.26) | yes |
| Intel | warm sweep | q32-d16-len512 | NumKong (approx.), f32 | 0.25 [0.24, 0.27] (0.25–0.26) | yes |
| Intel | warm sweep | q32-d16-len512 | NumKong (approx.), bf16 | 0.29 [0.27, 0.31] (0.29–0.30) | yes |
| Intel | warm sweep | q32-d16-len512 | PyTorch, bf16 | 0.43 [0.39, 0.46] (0.42–0.45) | yes |
| Intel | warm sweep | q32-d16-len512 | PyTorch, f32 | 0.51 [0.47, 0.55] (0.51–0.52) | yes |
| Intel | warm sweep | q32-d16-lennat | NumKong (approx.), f16 | 0.45 [0.41, 0.47] (0.43–0.44) | yes |
| Intel | warm sweep | q32-d16-lennat | NumKong (approx.), f32 | 0.45 [0.41, 0.47] (0.43–0.45) | yes |
| Intel | warm sweep | q32-d16-lennat | NumKong (approx.), bf16 | 0.47 [0.44, 0.50] (0.46–0.47) | yes |
| Intel | warm sweep | q32-d16-lennat | PyTorch, bf16 | 0.86 [0.78, 0.93] (0.84–0.86) | yes |
| Intel | warm sweep | q32-d256-len128 | NumKong (approx.), f16 | 0.17 [0.15, 0.19] (0.17–0.17) | yes |
| Intel | warm sweep | q32-d256-len128 | NumKong (approx.), f32 | 0.19 [0.17, 0.21] (0.19–0.20) | yes |
| Intel | warm sweep | q32-d256-len128 | NumKong (approx.), bf16 | 0.20 [0.18, 0.23] (0.20–0.21) | yes |
| Intel | warm sweep | q32-d256-len128 | PyTorch, bf16 | 0.37 [0.34, 0.39] (0.36–0.40) | yes |
| Intel | warm sweep | q32-d256-len128 | PyTorch, f32 | 0.65 [0.57, 0.70] (0.65–0.73) | yes |
| Intel | warm sweep | q32-d256-len32 | NumKong (approx.), bf16 | 0.37 [0.36, 0.38] (0.37–0.38) | yes |
| Intel | warm sweep | q32-d256-len32 | NumKong (approx.), f16 | 0.43 [0.42, 0.44] (0.43–0.44) | yes |
| Intel | warm sweep | q32-d256-len32 | NumKong (approx.), f32 | 0.50 [0.49, 0.52] (0.50–0.51) | yes |
| Intel | warm sweep | q32-d256-len32 | PyTorch, bf16 | 0.63 [0.62, 0.63] (0.63–0.63) | yes |
| Intel | warm sweep | q32-d256-len32 | PyTorch, f32 | 0.68 [0.67, 0.69] (0.68–0.70) | yes |
| Intel | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.14 [0.13, 0.14] (0.14–0.14) | yes |
| Intel | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.17 [0.17, 0.18] (0.17–0.18) | yes |
| Intel | warm sweep | q32-d256-len512 | PyTorch, bf16 | 0.38 [0.37, 0.40] (0.38–0.42) | yes |
| Intel | warm sweep | q32-d256-len512 | PyTorch, f32 | 0.67 [0.66, 0.69] (0.66–0.67) | yes |
| Intel | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.14 [0.12, 0.16] (0.14–0.15) | yes |
| Intel | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.15 [0.13, 0.17] (0.15–0.16) | yes |
| Intel | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.19 [0.15, 0.21] (0.18–0.19) | yes |
| Intel | warm sweep | q32-d256-lennat | PyTorch, f32 | 0.67 [0.56, 0.74] (0.64–0.69) | yes |
| Intel | warm sweep | q32-d256-lennat | PyTorch, bf16 | 0.85 [0.80, 0.92] (0.81–0.90) | yes |
| Intel | warm sweep | q32-d256-lennat | maxsim-cpu, f32 | 1.00 [0.86, 1.10] (0.95–1.03) | no |
| Intel | warm sweep | q32-d4-len128 | NumKong (approx.), bf16 | 0.74 [0.70, 0.77] (0.72–0.73) | yes |
| Intel | warm sweep | q32-d4-len128 | PyTorch, f32 | 0.94 [0.89, 0.99] (0.91–0.94) | yes |
| Intel | warm sweep | q32-d4-len128 | NumKong (approx.), f32 | 0.95 [0.91, 0.99] (0.93–0.95) | yes |
| Intel | warm sweep | q32-d4-len512 | PyTorch, f32 | 0.75 [0.70, 0.81] (0.73–0.75) | yes |
| Intel | warm sweep | q32-d4-len512 | NumKong (approx.), bf16 | 0.82 [0.74, 0.90] (0.80–0.82) | yes |
| Intel | warm sweep | q32-d4-len512 | NumKong (approx.), f32 | 0.94 [0.83, 1.06] (0.92–0.94) | no |
| Intel | warm sweep | q32-d4-len512 | NumKong (approx.), f16 | 0.99 [0.87, 1.12] (0.97–0.99) | no |
| Intel | warm sweep | q32-d4-lennat | NumKong (approx.), bf16 | 0.86 [0.79, 0.92] (0.81–0.89) | yes |
| Intel | warm sweep | q32-d4-lennat | NumKong (approx.), f32 | 0.96 [0.87, 1.05] (0.90–1.07) | no |
| Intel | warm sweep | q32-d4-lennat | NumKong (approx.), f16 | 1.00 [0.90, 1.10] (0.90–1.06) | no |
| Intel | warm sweep | q32-d4096-len128 | NumKong (approx.), f16 | 0.18 [0.17, 0.19] (0.18–0.18) | yes |
| Intel | warm sweep | q32-d4096-len128 | NumKong (approx.), bf16 | 0.20 [0.19, 0.21] (0.20–0.20) | yes |
| Intel | warm sweep | q32-d4096-len128 | NumKong (approx.), f32 | 0.21 [0.20, 0.22] (0.21–0.21) | yes |
| Intel | warm sweep | q32-d4096-len32 | NumKong (approx.), bf16 | 0.20 [0.19, 0.20] (0.20–0.20) | yes |
| Intel | warm sweep | q32-d4096-len32 | NumKong (approx.), f16 | 0.27 [0.26, 0.27] (0.27–0.27) | yes |
| Intel | warm sweep | q32-d4096-len32 | NumKong (approx.), f32 | 0.35 [0.35, 0.36] (0.35–0.35) | yes |
| Intel | warm sweep | q32-d4096-len32 | PyTorch, bf16 | 0.53 [0.52, 0.53] (0.52–0.53) | yes |
| Intel | warm sweep | q32-d4096-len32 | PyTorch, f32 | 0.63 [0.57, 0.77] (0.63–0.63) | yes |
| Intel | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.16 [0.15, 0.16] (0.16–0.16) | yes |
| Intel | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.17 [0.16, 0.18] (0.17–0.17) | yes |
| Intel | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.20 [0.20, 0.22] (0.20–0.20) | yes |
| Intel | warm sweep | q32-d4096-len512 | PyTorch, bf16 | 0.96 [0.94, 1.01] (0.96–0.96) | no |
| Intel | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.17 [0.16, 0.18] (0.17–0.17) | yes |
| Intel | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.19 [0.18, 0.20] (0.19–0.19) | yes |
| Intel | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.21 [0.20, 0.22] (0.21–0.21) | yes |
| Intel | warm sweep | q32-d64-len128 | NumKong (approx.), f16 | 0.29 [0.28, 0.30] (0.29–0.29) | yes |
| Intel | warm sweep | q32-d64-len128 | NumKong (approx.), bf16 | 0.31 [0.30, 0.32] (0.31–0.31) | yes |
| Intel | warm sweep | q32-d64-len128 | NumKong (approx.), f32 | 0.31 [0.30, 0.33] (0.31–0.32) | yes |
| Intel | warm sweep | q32-d64-len128 | PyTorch, bf16 | 0.46 [0.43, 0.49] (0.45–0.46) | yes |
| Intel | warm sweep | q32-d64-len128 | PyTorch, f32 | 0.59 [0.54, 0.62] (0.58–0.59) | yes |
| Intel | warm sweep | q32-d64-len32 | NumKong (approx.), bf16 | 0.61 [0.55, 0.67] (0.58–0.63) | yes |
| Intel | warm sweep | q32-d64-len32 | NumKong (approx.), f16 | 0.67 [0.61, 0.73] (0.64–0.69) | yes |
| Intel | warm sweep | q32-d64-len32 | PyTorch, f32 | 0.70 [0.62, 0.77] (0.66–0.72) | yes |
| Intel | warm sweep | q32-d64-len32 | NumKong (approx.), f32 | 0.70 [0.64, 0.76] (0.66–0.72) | yes |
| Intel | warm sweep | q32-d64-len32 | PyTorch, bf16 | 0.94 [0.84, 1.04] (0.89–0.98) | no |
| Intel | warm sweep | q32-d64-len512 | NumKong (approx.), f16 | 0.16 [0.14, 0.18] (0.15–0.16) | yes |
| Intel | warm sweep | q32-d64-len512 | NumKong (approx.), f32 | 0.18 [0.15, 0.21] (0.17–0.19) | yes |
| Intel | warm sweep | q32-d64-len512 | NumKong (approx.), bf16 | 0.23 [0.19, 0.27] (0.22–0.23) | yes |
| Intel | warm sweep | q32-d64-len512 | PyTorch, bf16 | 0.31 [0.27, 0.35] (0.30–0.32) | yes |
| Intel | warm sweep | q32-d64-len512 | PyTorch, f32 | 0.66 [0.55, 0.76] (0.64–0.68) | yes |
| Intel | warm sweep | q32-d64-lennat | NumKong (approx.), f16 | 0.18 [0.16, 0.20] (0.18–0.19) | yes |
| Intel | warm sweep | q32-d64-lennat | NumKong (approx.), f32 | 0.19 [0.17, 0.22] (0.19–0.20) | yes |
| Intel | warm sweep | q32-d64-lennat | NumKong (approx.), bf16 | 0.24 [0.20, 0.29] (0.24–0.25) | yes |
| Intel | warm sweep | q32-d64-lennat | PyTorch, bf16 | 0.49 [0.42, 0.55] (0.48–0.55) | yes |
| Intel | warm sweep | q64-d1-len128 | NumKong (approx.), bf16 | 0.60 [0.59, 0.61] (0.57–0.60) | yes |
| Intel | warm sweep | q64-d1-len128 | NumKong (approx.), f16 | 0.63 [0.62, 0.65] (0.61–0.65) | yes |
| Intel | warm sweep | q64-d1-len128 | PyTorch, f32 | 0.70 [0.69, 0.71] (0.68–0.70) | yes |
| Intel | warm sweep | q64-d1-len128 | NumKong (approx.), f32 | 0.71 [0.69, 0.72] (0.69–0.76) | yes |
| Intel | warm sweep | q64-d1-len512 | NumKong (approx.), bf16 | 0.54 [0.51, 0.56] (0.51–0.55) | yes |
| Intel | warm sweep | q64-d1-len512 | NumKong (approx.), f32 | 0.65 [0.61, 0.68] (0.62–0.69) | yes |
| Intel | warm sweep | q64-d1-len512 | PyTorch, f32 | 0.69 [0.65, 0.72] (0.60–0.76) | yes |
| Intel | warm sweep | q64-d1-len512 | NumKong (approx.), f16 | 0.72 [0.65, 0.82] (0.68–0.79) | yes |
| Intel | warm sweep | q64-d1-len512 | NumPy, f32 | 0.95 [0.90, 0.99] (0.90–0.96) | yes |
| Intel | warm sweep | q64-d1-lennat | NumKong (approx.), bf16 | 0.57 [0.53, 0.61] (0.55–0.57) | yes |
| Intel | warm sweep | q64-d1-lennat | NumKong (approx.), f32 | 0.70 [0.65, 0.75] (0.68–0.70) | yes |
| Intel | warm sweep | q64-d1-lennat | NumKong (approx.), f16 | 0.78 [0.67, 0.97] (0.73–0.82) | yes |
| Intel | warm sweep | q64-d1-lennat | PyTorch, f32 | 0.79 [0.73, 0.84] (0.76–0.79) | yes |
| Intel | warm sweep | q64-d1-lennat | NumPy, f32 | 0.92 [0.87, 0.97] (0.89–0.92) | yes |
| Intel | warm sweep | q64-d1024-len128 | NumKong (approx.), bf16 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d1024-len128 | NumKong (approx.), f16 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d1024-len128 | NumKong (approx.), f32 | 0.16 [0.15, 0.16] (0.15–0.16) | yes |
| Intel | warm sweep | q64-d1024-len128 | PyTorch, bf16 | 0.29 [0.21, 0.40] (0.28–0.29) | yes |
| Intel | warm sweep | q64-d1024-len32 | NumKong (approx.), bf16 | 0.15 [0.15, 0.16] (0.15–0.15) | yes |
| Intel | warm sweep | q64-d1024-len32 | PyTorch, bf16 | 0.21 [0.21, 0.21] (0.21–0.21) | yes |
| Intel | warm sweep | q64-d1024-len32 | NumKong (approx.), f16 | 0.22 [0.21, 0.22] (0.22–0.22) | yes |
| Intel | warm sweep | q64-d1024-len32 | NumKong (approx.), f32 | 0.32 [0.31, 0.32] (0.32–0.32) | yes |
| Intel | warm sweep | q64-d1024-len32 | PyTorch, f32 | 0.61 [0.61, 0.62] (0.61–0.61) | yes |
| Intel | warm sweep | q64-d1024-len512 | NumKong (approx.), f16 | 0.11 [0.10, 0.11] (0.11–0.11) | yes |
| Intel | warm sweep | q64-d1024-len512 | NumKong (approx.), f32 | 0.11 [0.11, 0.12] (0.11–0.11) | yes |
| Intel | warm sweep | q64-d1024-len512 | NumKong (approx.), bf16 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d1024-len512 | PyTorch, bf16 | 0.71 [0.69, 0.75] (0.71–0.71) | yes |
| Intel | warm sweep | q64-d1024-lennat | NumKong (approx.), f16 | 0.12 [0.11, 0.12] (0.12–0.12) | yes |
| Intel | warm sweep | q64-d1024-lennat | NumKong (approx.), f32 | 0.13 [0.12, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d1024-lennat | NumKong (approx.), bf16 | 0.14 [0.14, 0.15] (0.14–0.15) | yes |
| Intel | warm sweep | q64-d16-len128 | NumKong (approx.), f16 | 0.40 [0.37, 0.43] (0.38–0.40) | yes |
| Intel | warm sweep | q64-d16-len128 | NumKong (approx.), bf16 | 0.42 [0.39, 0.47] (0.39–0.43) | yes |
| Intel | warm sweep | q64-d16-len128 | NumKong (approx.), f32 | 0.44 [0.41, 0.47] (0.42–0.45) | yes |
| Intel | warm sweep | q64-d16-len128 | PyTorch, bf16 | 0.52 [0.48, 0.56] (0.50–0.52) | yes |
| Intel | warm sweep | q64-d16-len128 | PyTorch, f32 | 0.55 [0.51, 0.59] (0.53–0.55) | yes |
| Intel | warm sweep | q64-d16-len32 | NumKong (approx.), bf16 | 0.68 [0.61, 0.75] (0.64–0.69) | yes |
| Intel | warm sweep | q64-d16-len32 | PyTorch, f32 | 0.69 [0.61, 0.77] (0.66–0.71) | yes |
| Intel | warm sweep | q64-d16-len32 | NumKong (approx.), f16 | 0.76 [0.69, 0.84] (0.71–0.78) | yes |
| Intel | warm sweep | q64-d16-len32 | PyTorch, bf16 | 0.87 [0.78, 0.97] (0.82–0.89) | yes |
| Intel | warm sweep | q64-d16-len32 | NumKong (approx.), f32 | 0.88 [0.78, 0.97] (0.83–0.91) | yes |
| Intel | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.18 [0.17, 0.19] (0.18–0.18) | yes |
| Intel | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.19 [0.18, 0.20] (0.19–0.19) | yes |
| Intel | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.22 [0.21, 0.24] (0.22–0.23) | yes |
| Intel | warm sweep | q64-d16-len512 | PyTorch, bf16 | 0.25 [0.23, 0.26] (0.25–0.25) | yes |
| Intel | warm sweep | q64-d16-len512 | PyTorch, f32 | 0.45 [0.42, 0.48] (0.45–0.46) | yes |
| Intel | warm sweep | q64-d16-lennat | NumKong (approx.), f16 | 0.31 [0.29, 0.33] (0.31–0.31) | yes |
| Intel | warm sweep | q64-d16-lennat | NumKong (approx.), f32 | 0.32 [0.30, 0.34] (0.32–0.33) | yes |
| Intel | warm sweep | q64-d16-lennat | NumKong (approx.), bf16 | 0.35 [0.33, 0.38] (0.35–0.36) | yes |
| Intel | warm sweep | q64-d16-lennat | PyTorch, bf16 | 0.50 [0.47, 0.54] (0.50–0.51) | yes |
| Intel | warm sweep | q64-d16-lennat | PyTorch, f32 | 0.91 [0.84, 0.98] (0.90–0.92) | yes |
| Intel | warm sweep | q64-d256-len128 | NumKong (approx.), f16 | 0.14 [0.13, 0.16] (0.14–0.14) | yes |
| Intel | warm sweep | q64-d256-len128 | NumKong (approx.), bf16 | 0.16 [0.14, 0.17] (0.16–0.16) | yes |
| Intel | warm sweep | q64-d256-len128 | NumKong (approx.), f32 | 0.16 [0.15, 0.18] (0.16–0.17) | yes |
| Intel | warm sweep | q64-d256-len128 | PyTorch, bf16 | 0.20 [0.18, 0.22] (0.20–0.21) | yes |
| Intel | warm sweep | q64-d256-len128 | PyTorch, f32 | 0.62 [0.56, 0.67] (0.61–0.62) | yes |
| Intel | warm sweep | q64-d256-len32 | NumKong (approx.), bf16 | 0.23 [0.22, 0.23] (0.23–0.23) | yes |
| Intel | warm sweep | q64-d256-len32 | NumKong (approx.), f16 | 0.29 [0.29, 0.30] (0.29–0.29) | yes |
| Intel | warm sweep | q64-d256-len32 | PyTorch, bf16 | 0.31 [0.30, 0.31] (0.30–0.31) | yes |
| Intel | warm sweep | q64-d256-len32 | NumKong (approx.), f32 | 0.37 [0.37, 0.38] (0.37–0.38) | yes |
| Intel | warm sweep | q64-d256-len32 | PyTorch, f32 | 0.56 [0.55, 0.57] (0.56–0.56) | yes |
| Intel | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.10 [0.10, 0.11] (0.10–0.10) | yes |
| Intel | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.11 [0.10, 0.11] (0.11–0.11) | yes |
| Intel | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.13 [0.12, 0.13] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d256-len512 | PyTorch, bf16 | 0.19 [0.18, 0.21] (0.19–0.20) | yes |
| Intel | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.12 [0.12, 0.13] (0.12–0.13) | yes |
| Intel | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.14 [0.13, 0.14] (0.14–0.14) | yes |
| Intel | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.15 [0.14, 0.15] (0.15–0.15) | yes |
| Intel | warm sweep | q64-d256-lennat | PyTorch, bf16 | 0.47 [0.39, 0.67] (0.44–0.48) | yes |
| Intel | warm sweep | q64-d256-lennat | PyTorch, f32 | 0.66 [0.65, 0.67] (0.65–0.67) | yes |
| Intel | warm sweep | q64-d4-len128 | NumKong (approx.), bf16 | 0.60 [0.56, 0.63] (0.58–0.62) | yes |
| Intel | warm sweep | q64-d4-len128 | PyTorch, f32 | 0.66 [0.62, 0.70] (0.64–0.67) | yes |
| Intel | warm sweep | q64-d4-len128 | NumKong (approx.), f16 | 0.73 [0.67, 0.82] (0.71–0.72) | yes |
| Intel | warm sweep | q64-d4-len128 | NumKong (approx.), f32 | 0.82 [0.76, 0.92] (0.76–0.83) | yes |
| Intel | warm sweep | q64-d4-len32 | NumKong (approx.), bf16 | 0.83 [0.81, 0.86] (0.81–0.85) | yes |
| Intel | warm sweep | q64-d4-len512 | PyTorch, f32 | 0.63 [0.56, 0.69] (0.62–0.63) | yes |
| Intel | warm sweep | q64-d4-len512 | NumKong (approx.), bf16 | 0.63 [0.57, 0.69] (0.62–0.64) | yes |
| Intel | warm sweep | q64-d4-len512 | NumKong (approx.), f32 | 0.70 [0.61, 0.79] (0.68–0.70) | yes |
| Intel | warm sweep | q64-d4-len512 | NumKong (approx.), f16 | 0.71 [0.61, 0.81] (0.69–0.72) | yes |
| Intel | warm sweep | q64-d4-len512 | PyTorch, bf16 | 0.75 [0.67, 0.83] (0.73–0.77) | yes |
| Intel | warm sweep | q64-d4-lennat | NumKong (approx.), bf16 | 0.70 [0.65, 0.77] (0.64–0.70) | yes |
| Intel | warm sweep | q64-d4-lennat | NumKong (approx.), f32 | 0.73 [0.67, 0.79] (0.69–0.75) | yes |
| Intel | warm sweep | q64-d4-lennat | NumKong (approx.), f16 | 0.79 [0.72, 0.88] (0.74–0.84) | yes |
| Intel | warm sweep | q64-d4-lennat | PyTorch, f32 | 0.84 [0.78, 0.90] (0.81–0.84) | yes |
| Intel | warm sweep | q64-d4096-len128 | NumKong (approx.), f16 | 0.14 [0.14, 0.15] (0.14–0.14) | yes |
| Intel | warm sweep | q64-d4096-len128 | NumKong (approx.), bf16 | 0.16 [0.15, 0.17] (0.16–0.16) | yes |
| Intel | warm sweep | q64-d4096-len128 | NumKong (approx.), f32 | 0.17 [0.16, 0.18] (0.17–0.17) | yes |
| Intel | warm sweep | q64-d4096-len128 | PyTorch, bf16 | 0.72 [0.69, 0.76] (0.72–0.73) | yes |
| Intel | warm sweep | q64-d4096-len32 | NumKong (approx.), bf16 | 0.14 [0.14, 0.15] (0.14–0.15) | yes |
| Intel | warm sweep | q64-d4096-len32 | PyTorch, bf16 | 0.18 [0.18, 0.19] (0.18–0.19) | yes |
| Intel | warm sweep | q64-d4096-len32 | NumKong (approx.), f16 | 0.22 [0.22, 0.23] (0.22–0.23) | yes |
| Intel | warm sweep | q64-d4096-len32 | NumKong (approx.), f32 | 0.31 [0.30, 0.31] (0.31–0.31) | yes |
| Intel | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.12 [0.11, 0.13] (0.12–0.12) | yes |
| Intel | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.13 [0.12, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.15 [0.14, 0.15] (0.15–0.15) | yes |
| Intel | warm sweep | q64-d4096-len512 | PyTorch, bf16 | 0.70 [0.66, 0.74] (0.70–0.70) | yes |
| Intel | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.12 [0.11, 0.12] (0.12–0.12) | yes |
| Intel | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.13 [0.13, 0.14] (0.13–0.13) | yes |
| Intel | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.15 [0.14, 0.15] (0.15–0.15) | yes |
| Intel | warm sweep | q64-d64-len128 | NumKong (approx.), f16 | 0.21 [0.20, 0.22] (0.21–0.21) | yes |
| Intel | warm sweep | q64-d64-len128 | NumKong (approx.), bf16 | 0.21 [0.20, 0.22] (0.21–0.22) | yes |
| Intel | warm sweep | q64-d64-len128 | NumKong (approx.), f32 | 0.23 [0.22, 0.25] (0.23–0.24) | yes |
| Intel | warm sweep | q64-d64-len128 | PyTorch, bf16 | 0.26 [0.25, 0.28] (0.26–0.27) | yes |
| Intel | warm sweep | q64-d64-len128 | PyTorch, f32 | 0.49 [0.46, 0.52] (0.49–0.50) | yes |
| Intel | warm sweep | q64-d64-len32 | NumKong (approx.), bf16 | 0.43 [0.39, 0.46] (0.42–0.44) | yes |
| Intel | warm sweep | q64-d64-len32 | NumKong (approx.), f16 | 0.47 [0.43, 0.51] (0.46–0.48) | yes |
| Intel | warm sweep | q64-d64-len32 | PyTorch, bf16 | 0.52 [0.47, 0.56] (0.50–0.53) | yes |
| Intel | warm sweep | q64-d64-len32 | NumKong (approx.), f32 | 0.54 [0.50, 0.59] (0.53–0.56) | yes |
| Intel | warm sweep | q64-d64-len32 | PyTorch, f32 | 0.62 [0.56, 0.68] (0.60–0.63) | yes |
| Intel | warm sweep | q64-d64-len512 | NumKong (approx.), f16 | 0.11 [0.09, 0.12] (0.11–0.11) | yes |
| Intel | warm sweep | q64-d64-len512 | NumKong (approx.), f32 | 0.12 [0.11, 0.12] (0.11–0.12) | yes |
| Intel | warm sweep | q64-d64-len512 | NumKong (approx.), bf16 | 0.15 [0.14, 0.16] (0.15–0.16) | yes |
| Intel | warm sweep | q64-d64-len512 | PyTorch, bf16 | 0.17 [0.16, 0.18] (0.17–0.17) | yes |
| Intel | warm sweep | q64-d64-len512 | PyTorch, f32 | 0.53 [0.47, 0.56] (0.52–0.53) | yes |
| Intel | warm sweep | q64-d64-lennat | NumKong (approx.), f16 | 0.16 [0.14, 0.18] (0.16–0.16) | yes |
| Intel | warm sweep | q64-d64-lennat | NumKong (approx.), f32 | 0.17 [0.15, 0.19] (0.17–0.17) | yes |
| Intel | warm sweep | q64-d64-lennat | NumKong (approx.), bf16 | 0.21 [0.18, 0.25] (0.21–0.21) | yes |
| Intel | warm sweep | q64-d64-lennat | PyTorch, bf16 | 0.36 [0.31, 0.41] (0.35–0.39) | yes |
| Intel | warm sweep | q8-d1-len128 | NumKong (approx.), bf16 | 0.74 [0.73, 0.76] (0.74–0.74) | yes |
| Intel | warm sweep | q8-d1-len128 | NumKong (approx.), f32 | 0.93 [0.90, 0.96] (0.92–0.93) | yes |
| Intel | warm sweep | q8-d1-len512 | NumKong (approx.), bf16 | 0.61 [0.59, 0.64] (0.61–0.62) | yes |
| Intel | warm sweep | q8-d1-len512 | NumKong (approx.), f32 | 0.70 [0.67, 0.72] (0.69–0.71) | yes |
| Intel | warm sweep | q8-d1-len512 | NumKong (approx.), f16 | 0.76 [0.72, 0.78] (0.75–0.76) | yes |
| Intel | warm sweep | q8-d1-lennat | NumKong (approx.), bf16 | 0.70 [0.67, 0.74] (0.70–0.71) | yes |
| Intel | warm sweep | q8-d1-lennat | NumKong (approx.), f32 | 0.84 [0.80, 0.89] (0.83–0.85) | yes |
| Intel | warm sweep | q8-d1-lennat | NumKong (approx.), f16 | 0.93 [0.87, 0.99] (0.92–0.93) | yes |
| Intel | warm sweep | q8-d1024-len128 | NumKong (approx.), f16 | 0.39 [0.38, 0.41] (0.39–0.40) | yes |
| Intel | warm sweep | q8-d1024-len128 | NumKong (approx.), f32 | 0.44 [0.42, 0.45] (0.43–0.44) | yes |
| Intel | warm sweep | q8-d1024-len128 | NumKong (approx.), bf16 | 0.49 [0.47, 0.51] (0.48–0.49) | yes |
| Intel | warm sweep | q8-d1024-len128 | PyTorch, bf16 | 0.89 [0.86, 0.92] (0.88–0.90) | yes |
| Intel | warm sweep | q8-d1024-len32 | NumKong (approx.), f16 | 0.57 [0.54, 0.60] (0.56–0.57) | yes |
| Intel | warm sweep | q8-d1024-len32 | NumKong (approx.), bf16 | 0.59 [0.56, 0.64] (0.58–0.60) | yes |
| Intel | warm sweep | q8-d1024-len32 | PyTorch, bf16 | 0.61 [0.59, 0.64] (0.61–0.62) | yes |
| Intel | warm sweep | q8-d1024-len32 | NumKong (approx.), f32 | 0.67 [0.64, 0.69] (0.66–0.68) | yes |
| Intel | warm sweep | q8-d1024-len512 | NumKong (approx.), f16 | 0.29 [0.28, 0.31] (0.29–0.30) | yes |
| Intel | warm sweep | q8-d1024-len512 | NumKong (approx.), f32 | 0.31 [0.30, 0.32] (0.31–0.31) | yes |
| Intel | warm sweep | q8-d1024-len512 | NumKong (approx.), bf16 | 0.48 [0.47, 0.50] (0.48–0.48) | yes |
| Intel | warm sweep | q8-d1024-len512 | PyTorch, bf16 | 0.79 [0.72, 0.91] (0.79–0.80) | yes |
| Intel | warm sweep | q8-d1024-lennat | NumKong (approx.), f16 | 0.34 [0.32, 0.36] (0.34–0.34) | yes |
| Intel | warm sweep | q8-d1024-lennat | NumKong (approx.), f32 | 0.35 [0.34, 0.37] (0.35–0.36) | yes |
| Intel | warm sweep | q8-d1024-lennat | NumKong (approx.), bf16 | 0.50 [0.48, 0.53] (0.50–0.51) | yes |
| Intel | warm sweep | q8-d16-len512 | NumKong (approx.), f16 | 0.60 [0.55, 0.64] (0.59–0.61) | yes |
| Intel | warm sweep | q8-d16-len512 | NumKong (approx.), f32 | 0.62 [0.58, 0.67] (0.60–0.64) | yes |
| Intel | warm sweep | q8-d16-len512 | NumKong (approx.), bf16 | 0.70 [0.65, 0.74] (0.68–0.71) | yes |
| Intel | warm sweep | q8-d16-len512 | PyTorch, f32 | 0.79 [0.71, 0.85] (0.77–0.80) | yes |
| Intel | warm sweep | q8-d16-len512 | PyTorch, bf16 | 0.95 [0.86, 1.02] (0.92–0.96) | no |
| Intel | warm sweep | q8-d16-lennat | NumKong (approx.), f16 | 0.91 [0.84, 0.98] (0.88–0.92) | yes |
| Intel | warm sweep | q8-d16-lennat | NumKong (approx.), f32 | 0.93 [0.86, 0.99] (0.90–0.94) | yes |
| Intel | warm sweep | q8-d256-len128 | NumKong (approx.), f16 | 0.35 [0.27, 0.43] (0.32–0.39) | yes |
| Intel | warm sweep | q8-d256-len128 | NumKong (approx.), f32 | 0.38 [0.29, 0.47] (0.35–0.43) | yes |
| Intel | warm sweep | q8-d256-len128 | NumKong (approx.), bf16 | 0.46 [0.36, 0.57] (0.43–0.52) | yes |
| Intel | warm sweep | q8-d256-len128 | PyTorch, bf16 | 0.57 [0.44, 0.68] (0.51–0.64) | yes |
| Intel | warm sweep | q8-d256-len128 | PyTorch, f32 | 0.83 [0.64, 1.02] (0.75–0.93) | no |
| Intel | warm sweep | q8-d256-len32 | NumKong (approx.), f16 | 0.93 [0.91, 0.94] (0.92–0.94) | no |
| Intel | warm sweep | q8-d256-len32 | NumKong (approx.), bf16 | 0.93 [0.91, 0.95] (0.93–0.94) | no |
| Intel | warm sweep | q8-d256-len32 | PyTorch, bf16 | 0.96 [0.95, 0.97] (0.96–0.97) | yes |
| Intel | warm sweep | q8-d256-len32 | NumKong (approx.), f32 | 0.97 [0.96, 0.99] (0.97–0.98) | no |
| Intel | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.29 [0.28, 0.31] (0.29–0.30) | yes |
| Intel | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.30 [0.29, 0.31] (0.29–0.30) | yes |
| Intel | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.43 [0.42, 0.45] (0.42–0.44) | yes |
| Intel | warm sweep | q8-d256-len512 | PyTorch, bf16 | 0.63 [0.60, 0.65] (0.61–0.64) | yes |
| Intel | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.27 [0.21, 0.34] (0.27–0.27) | yes |
| Intel | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.29 [0.23, 0.34] (0.28–0.29) | yes |
| Intel | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.41 [0.32, 0.50] (0.39–0.42) | yes |
| Intel | warm sweep | q8-d4096-len128 | NumKong (approx.), f16 | 0.37 [0.36, 0.38] (0.37–0.37) | yes |
| Intel | warm sweep | q8-d4096-len128 | NumKong (approx.), f32 | 0.42 [0.41, 0.42] (0.41–0.42) | yes |
| Intel | warm sweep | q8-d4096-len128 | NumKong (approx.), bf16 | 0.49 [0.48, 0.49] (0.48–0.49) | yes |
| Intel | warm sweep | q8-d4096-len128 | PyTorch, bf16 | 0.86 [0.85, 0.87] (0.85–0.87) | yes |
| Intel | warm sweep | q8-d4096-len32 | NumKong (approx.), bf16 | 0.49 [0.48, 0.51] (0.49–0.49) | yes |
| Intel | warm sweep | q8-d4096-len32 | NumKong (approx.), f16 | 0.51 [0.50, 0.52] (0.51–0.51) | yes |
| Intel | warm sweep | q8-d4096-len32 | NumKong (approx.), f32 | 0.59 [0.57, 0.61] (0.59–0.59) | yes |
| Intel | warm sweep | q8-d4096-len32 | PyTorch, bf16 | 0.72 [0.72, 0.72] (0.72–0.72) | yes |
| Intel | warm sweep | q8-d4096-len512 | NumKong (approx.), f16 | 0.32 [0.31, 0.33] (0.32–0.32) | yes |
| Intel | warm sweep | q8-d4096-len512 | NumKong (approx.), f32 | 0.34 [0.33, 0.35] (0.34–0.34) | yes |
| Intel | warm sweep | q8-d4096-len512 | NumKong (approx.), bf16 | 0.52 [0.51, 0.54] (0.52–0.52) | yes |
| Intel | warm sweep | q8-d4096-lennat | NumKong (approx.), f16 | 0.33 [0.32, 0.33] (0.33–0.33) | yes |
| Intel | warm sweep | q8-d4096-lennat | NumKong (approx.), f32 | 0.36 [0.35, 0.36] (0.35–0.36) | yes |
| Intel | warm sweep | q8-d4096-lennat | NumKong (approx.), bf16 | 0.52 [0.52, 0.53] (0.52–0.53) | yes |
| Intel | warm sweep | q8-d64-len128 | NumKong (approx.), f16 | 0.69 [0.63, 0.74] (0.68–0.70) | yes |
| Intel | warm sweep | q8-d64-len128 | NumKong (approx.), f32 | 0.73 [0.66, 0.79] (0.72–0.74) | yes |
| Intel | warm sweep | q8-d64-len128 | NumKong (approx.), bf16 | 0.79 [0.71, 0.86] (0.77–0.80) | yes |
| Intel | warm sweep | q8-d64-len128 | PyTorch, f32 | 0.84 [0.75, 0.92] (0.83–0.85) | yes |
| Intel | warm sweep | q8-d64-len128 | PyTorch, bf16 | 0.93 [0.83, 1.02] (0.92–0.93) | no |
| Intel | warm sweep | q8-d64-len32 | NumKong (approx.), bf16 | 0.94 [0.80, 1.11] (0.93–0.97) | no |
| Intel | warm sweep | q8-d64-len32 | NumKong (approx.), f16 | 0.99 [0.84, 1.16] (0.98–1.05) | no |
| Intel | warm sweep | q8-d64-len512 | NumKong (approx.), f32 | 0.27 [0.23, 0.31] (0.26–0.28) | yes |
| Intel | warm sweep | q8-d64-len512 | NumKong (approx.), f16 | 0.28 [0.24, 0.33] (0.27–0.29) | yes |
| Intel | warm sweep | q8-d64-len512 | NumKong (approx.), bf16 | 0.43 [0.36, 0.51] (0.41–0.43) | yes |
| Intel | warm sweep | q8-d64-len512 | PyTorch, bf16 | 0.58 [0.49, 0.67] (0.55–0.57) | yes |
| Intel | warm sweep | q8-d64-len512 | PyTorch, f32 | 0.80 [0.67, 0.92] (0.77–0.87) | yes |
| Intel | warm sweep | q8-d64-lennat | NumKong (approx.), f16 | 0.39 [0.31, 0.46] (0.33–0.37) | yes |
| Intel | warm sweep | q8-d64-lennat | NumKong (approx.), f32 | 0.43 [0.35, 0.51] (0.38–0.41) | yes |
| Intel | warm sweep | q8-d64-lennat | NumKong (approx.), bf16 | 0.52 [0.43, 0.61] (0.45–0.50) | yes |
| M3 Max | one thread | agent-ho | NumPy, f32 | 0.24 [0.23, 0.25] (0.24–0.24) | yes |
| M3 Max | one thread | agent-ho | NumKong (approx.), f16 | 0.30 [0.29, 0.30] (0.29–0.30) | yes |
| M3 Max | one thread | agent-ho | PyTorch, f32 | 0.51 [0.47, 0.55] (0.51–0.51) | yes |
| M3 Max | one thread | agent-ho | maxsim-cpu, f32 | 0.77 [0.75, 0.80] (0.77–0.78) | yes |
| M3 Max | one thread | beir | NumPy, f32 | 0.16 [0.16, 0.16] (0.16–0.16) | yes |
| M3 Max | one thread | beir | NumKong (approx.), f16 | 0.26 [0.26, 0.26] (0.26–0.27) | yes |
| M3 Max | one thread | beir | PyTorch, f32 | 0.31 [0.31, 0.31] (0.31–0.31) | yes |
| M3 Max | one thread | beir | maxsim-cpu, f32 | 0.50 [0.50, 0.50] (0.50–0.50) | yes |
| M3 Max | one thread | gcsn-ho | NumPy, f32 | 0.28 [0.28, 0.28] (0.28–0.28) | yes |
| M3 Max | one thread | gcsn-ho | NumKong (approx.), f16 | 0.31 [0.31, 0.32] (0.31–0.31) | yes |
| M3 Max | one thread | gcsn-ho | PyTorch, f32 | 0.91 [0.90, 0.92] (0.91–0.91) | yes |
| M3 Max | one thread | gcsn-ho | maxsim-cpu, f32 | 0.95 [0.94, 0.96] (0.95–0.95) | yes |
| M3 Max | pool-parked | agent-ho | NumPy, f32 | 0.92 [0.88, 0.97] (0.92–0.92) | yes |
| M3 Max | pool-parked | gcsn-ho | NumPy, f32 | 0.74 [0.73, 0.74] (0.73–0.74) | yes |
| M3 Max | pool-parked | gcsn-ho | NumKong (approx.), f16 | 0.88 [0.87, 0.89] (0.88–0.88) | yes |
| M3 Max | warm | beir | NumKong (approx.), f16 | 0.99 [0.98, 0.99] (0.98–0.99) | no |
| M3 Max | warm | beir | NumKong (approx.), bf16 | 0.99 [0.99, 0.99] (0.99–0.99) | no |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), bf16 | 0.61 [0.61, 0.62] (0.57–0.62) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f16 | 0.62 [0.61, 0.62] (0.57–0.63) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k100 | NumKong (approx.), f32 | 0.62 [0.62, 0.63] (0.57–0.64) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f16 | 0.46 [0.45, 0.46] (0.45–0.47) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), bf16 | 0.46 [0.46, 0.46] (0.45–0.47) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k200 | NumKong (approx.), f32 | 0.47 [0.46, 0.47] (0.46–0.48) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), f16 | 0.85 [0.84, 0.86] (0.85–0.85) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), bf16 | 0.86 [0.85, 0.86] (0.86–0.86) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-answersmall-k50 | NumKong (approx.), f32 | 0.86 [0.85, 0.87] (0.86–0.86) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), bf16 | 0.69 [0.68, 0.69] (0.69–0.69) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f16 | 0.69 [0.68, 0.69] (0.69–0.69) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k100 | NumKong (approx.), f32 | 0.71 [0.70, 0.71] (0.71–0.71) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), bf16 | 0.53 [0.53, 0.53] (0.53–0.53) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f16 | 0.53 [0.53, 0.54] (0.53–0.53) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k200 | NumKong (approx.), f32 | 0.56 [0.55, 0.56] (0.56–0.56) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k200 | PyTorch, f32 | 0.95 [0.95, 0.96] (0.95–0.95) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), f16 | 0.90 [0.89, 0.91] (0.90–0.91) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), bf16 | 0.91 [0.90, 0.91] (0.90–0.91) | yes |
| M3 Max | warm BEIR set | beir-nfcorpus-colbertv2-k50 | NumKong (approx.), f32 | 0.91 [0.91, 0.92] (0.91–0.92) | no |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f16 | 0.62 [0.61, 0.62] (0.60–0.62) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), bf16 | 0.62 [0.62, 0.62] (0.60–0.63) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k100 | NumKong (approx.), f32 | 0.63 [0.63, 0.63] (0.61–0.64) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), bf16 | 0.45 [0.45, 0.46] (0.45–0.47) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f16 | 0.46 [0.46, 0.46] (0.45–0.47) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k200 | NumKong (approx.), f32 | 0.47 [0.47, 0.48] (0.46–0.48) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f16 | 0.82 [0.81, 0.83] (0.82–0.82) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), bf16 | 0.82 [0.82, 0.83] (0.82–0.83) | yes |
| M3 Max | warm BEIR set | beir-scifact-answersmall-k50 | NumKong (approx.), f32 | 0.83 [0.82, 0.84] (0.83–0.83) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), bf16 | 0.65 [0.64, 0.65] (0.64–0.66) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f16 | 0.65 [0.65, 0.66] (0.65–0.66) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k100 | NumKong (approx.), f32 | 0.67 [0.66, 0.68] (0.66–0.68) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), bf16 | 0.49 [0.49, 0.50] (0.48–0.51) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f16 | 0.50 [0.49, 0.50] (0.48–0.52) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k200 | NumKong (approx.), f32 | 0.52 [0.51, 0.52] (0.50–0.54) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k200 | PyTorch, f32 | 0.87 [0.86, 0.88] (0.84–0.90) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), bf16 | 0.88 [0.88, 0.89] (0.88–0.89) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f16 | 0.89 [0.88, 0.89] (0.88–0.89) | yes |
| M3 Max | warm BEIR set | beir-scifact-colbertv2-k50 | NumKong (approx.), f32 | 0.89 [0.89, 0.90] (0.89–0.90) | yes |
| M3 Max | warm sweep | q32-d1-len128 | maxsim-cpu, f32 | 0.51 [0.51, 0.52] (0.51–0.51) | yes |
| M3 Max | warm sweep | q32-d1-len128 | NumPy, f32 | 0.74 [0.74, 0.74] (0.74–0.74) | yes |
| M3 Max | warm sweep | q32-d1-len32 | maxsim-cpu, f32 | 0.58 [0.57, 0.58] (0.58–0.58) | yes |
| M3 Max | warm sweep | q32-d1-len512 | maxsim-cpu, f32 | 0.92 [0.92, 0.92] (0.92–0.92) | yes |
| M3 Max | warm sweep | q32-d1-lennat | maxsim-cpu, f32 | 0.70 [0.66, 0.74] (0.69–0.70) | yes |
| M3 Max | warm sweep | q32-d1-lennat | NumPy, f32 | 0.91 [0.88, 0.94] (0.89–0.91) | yes |
| M3 Max | warm sweep | q32-d256-len512 | NumKong (approx.), f16 | 0.33 [0.32, 0.33] (0.32–0.33) | yes |
| M3 Max | warm sweep | q32-d256-len512 | NumKong (approx.), f32 | 0.33 [0.32, 0.34] (0.33–0.33) | yes |
| M3 Max | warm sweep | q32-d256-len512 | NumKong (approx.), bf16 | 0.34 [0.33, 0.35] (0.33–0.34) | yes |
| M3 Max | warm sweep | q32-d256-lennat | NumKong (approx.), f16 | 0.40 [0.39, 0.41] (0.39–0.41) | yes |
| M3 Max | warm sweep | q32-d256-lennat | NumKong (approx.), bf16 | 0.40 [0.39, 0.42] (0.40–0.41) | yes |
| M3 Max | warm sweep | q32-d256-lennat | NumKong (approx.), f32 | 0.41 [0.40, 0.42] (0.41–0.42) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NumKong (approx.), f16 | 0.16 [0.13, 0.20] (0.15–0.18) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NumKong (approx.), bf16 | 0.16 [0.13, 0.20] (0.15–0.18) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | NumKong (approx.), f32 | 0.17 [0.14, 0.21] (0.16–0.19) | yes |
| M3 Max | warm sweep | q32-d4096-len512 | PyTorch, f32 | 0.74 [0.61, 0.94] (0.72–0.85) | no |
| M3 Max | warm sweep | q32-d4096-len512 | NextPlaid, f32 | 0.78 [0.68, 0.91] (0.77–0.80) | no |
| M3 Max | warm sweep | q32-d4096-len512 | NumPy, f32 | 0.89 [0.73, 1.12] (0.86–1.01) | no |
| M3 Max | warm sweep | q32-d4096-lennat | NumKong (approx.), bf16 | 0.29 [0.28, 0.29] (0.29–0.29) | yes |
| M3 Max | warm sweep | q32-d4096-lennat | NumKong (approx.), f16 | 0.29 [0.28, 0.29] (0.29–0.29) | yes |
| M3 Max | warm sweep | q32-d4096-lennat | NumKong (approx.), f32 | 0.31 [0.31, 0.32] (0.31–0.32) | yes |
| M3 Max | warm sweep | q64-d1-len512 | maxsim-cpu, f32 | 0.76 [0.75, 0.76] (0.76–0.76) | yes |
| M3 Max | warm sweep | q64-d1-len512 | NumPy, f32 | 0.88 [0.87, 0.88] (0.87–0.88) | yes |
| M3 Max | warm sweep | q64-d1-lennat | maxsim-cpu, f32 | 0.57 [0.52, 0.61] (0.56–0.57) | yes |
| M3 Max | warm sweep | q64-d1-lennat | NumPy, f32 | 0.71 [0.68, 0.75] (0.70–0.72) | yes |
| M3 Max | warm sweep | q64-d16-len512 | NumKong (approx.), f16 | 0.89 [0.88, 0.91] (0.88–0.90) | yes |
| M3 Max | warm sweep | q64-d16-len512 | NumKong (approx.), f32 | 0.89 [0.88, 0.91] (0.89–0.90) | yes |
| M3 Max | warm sweep | q64-d16-len512 | NumKong (approx.), bf16 | 0.90 [0.89, 0.91] (0.89–0.90) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NumKong (approx.), f16 | 0.31 [0.30, 0.31] (0.30–0.31) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NumKong (approx.), bf16 | 0.31 [0.31, 0.32] (0.31–0.31) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NumKong (approx.), f32 | 0.31 [0.31, 0.32] (0.31–0.32) | yes |
| M3 Max | warm sweep | q64-d256-len512 | PyTorch, f32 | 0.89 [0.88, 0.89] (0.88–0.89) | yes |
| M3 Max | warm sweep | q64-d256-len512 | NextPlaid, f32 | 0.98 [0.97, 0.98] (0.97–0.98) | yes |
| M3 Max | warm sweep | q64-d256-lennat | NumKong (approx.), f16 | 0.36 [0.35, 0.37] (0.36–0.36) | yes |
| M3 Max | warm sweep | q64-d256-lennat | NumKong (approx.), bf16 | 0.36 [0.35, 0.37] (0.36–0.36) | yes |
| M3 Max | warm sweep | q64-d256-lennat | NumKong (approx.), f32 | 0.37 [0.36, 0.37] (0.37–0.37) | yes |
| M3 Max | warm sweep | q64-d256-lennat | PyTorch, f32 | 0.82 [0.81, 0.83] (0.82–0.82) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumKong (approx.), f16 | 0.19 [0.17, 0.22] (0.17–0.19) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumKong (approx.), bf16 | 0.19 [0.17, 0.22] (0.17–0.20) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumKong (approx.), f32 | 0.19 [0.18, 0.22] (0.18–0.20) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | PyTorch, f32 | 0.62 [0.56, 0.71] (0.58–0.65) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NextPlaid, f32 | 0.75 [0.70, 0.81] (0.74–0.77) | yes |
| M3 Max | warm sweep | q64-d4096-len512 | NumPy, f32 | 0.85 [0.77, 0.98] (0.79–0.88) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NumKong (approx.), bf16 | 0.25 [0.23, 0.27] (0.25–0.25) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NumKong (approx.), f16 | 0.25 [0.23, 0.27] (0.25–0.25) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NumKong (approx.), f32 | 0.27 [0.24, 0.29] (0.26–0.27) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | PyTorch, f32 | 0.79 [0.73, 0.85] (0.78–0.79) | yes |
| M3 Max | warm sweep | q64-d4096-lennat | NextPlaid, f32 | 0.87 [0.79, 0.95] (0.86–0.87) | yes |
| M3 Max | warm sweep | q8-d256-len512 | NumKong (approx.), bf16 | 0.53 [0.51, 0.55] (0.53–0.54) | yes |
| M3 Max | warm sweep | q8-d256-len512 | NumKong (approx.), f16 | 0.54 [0.52, 0.56] (0.53–0.56) | yes |
| M3 Max | warm sweep | q8-d256-len512 | NumKong (approx.), f32 | 0.54 [0.52, 0.57] (0.54–0.55) | yes |
| M3 Max | warm sweep | q8-d256-lennat | NumKong (approx.), f16 | 0.66 [0.61, 0.72] (0.65–0.68) | yes |
| M3 Max | warm sweep | q8-d256-lennat | NumKong (approx.), bf16 | 0.67 [0.64, 0.70] (0.66–0.68) | yes |
| M3 Max | warm sweep | q8-d256-lennat | NumKong (approx.), f32 | 0.73 [0.69, 0.76] (0.72–0.74) | yes |
| M3 Max | warm sweep | q8-d4096-len512 | NumKong (approx.), bf16 | 0.49 [0.48, 0.50] (0.47–0.50) | yes |
| M3 Max | warm sweep | q8-d4096-len512 | NumKong (approx.), f16 | 0.50 [0.49, 0.50] (0.47–0.50) | yes |
| M3 Max | warm sweep | q8-d4096-len512 | NumKong (approx.), f32 | 0.52 [0.51, 0.53] (0.50–0.53) | yes |
| M3 Max | warm sweep | q8-d4096-lennat | NumKong (approx.), bf16 | 0.57 [0.57, 0.58] (0.57–0.58) | yes |
| M3 Max | warm sweep | q8-d4096-lennat | NumKong (approx.), f16 | 0.58 [0.57, 0.58] (0.57–0.58) | yes |
| M3 Max | warm sweep | q8-d4096-lennat | NumKong (approx.), f32 | 0.62 [0.61, 0.63] (0.62–0.63) | yes |
