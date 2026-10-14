# MaxSim benchmark results (held-out, 2026-10-13)

Kernel at `66e4f08d`. Method, rivals and data: [README.md](README.md). Raw per-call
results (every arm, round and call): `published/results-2026-10-13.tar.zst`
(`tar --zstd -xf`, then `python3 summarize.py results/mac` / `results/x86`).
Ratios are geometric means over calls of other / sweet with 95% bootstrap intervals;
each rival is shown at its fastest configuration for that workload.

## Summary

**On the production-shaped held-out calls, sweet's kernel is the fastest exact
implementation we tested on both machines, warm.** Its scores match a float64
reference to 3e-7 and pick the same top document on 100% of calls.

| held-out set, warm, all cores | NumPy | PyTorch | maxsim-cpu | NumKong (approx.) | previous sweet path |
|---|---|---|---|---|---|
| agent calls, M3 Max | 2.00x | 4.24x | 6.51x | 2.64x | 3.36x |
| GCSN calls, M3 Max | 2.05x | 6.65x | 6.86x | 2.56x | 4.47x |
| agent calls, EPYC | 1.44x | 1.89x | 2.44x | 2.65x | 3.63x |
| GCSN calls, EPYC | 1.57x | 2.80x | 2.69x | 2.70x | 4.32x |

(other / sweet: > 1 = sweet faster. "Previous sweet path" = the production path
before this change vs the production path now, same scores.)

Where sweet is **not** the fastest:

- **Cold calls, x86.** After 5 ms of other work, NumPy is ~1.5x faster than sweet's
  production path (0.149 vs 0.217 ms, agent calls). OpenBLAS keeps its threads
  busy-waiting for ~0.1 s after every call, so they never cool down; sweet's pool parks
  after 0.2 ms. Prewarming 0.1 ms ahead does not recover the cold cost on this VM.
- **Cold calls, M3 Max, without prewarm.** NumPy (Accelerate) is 1.07-1.35x faster.
  With the prewarm the rerank stage does, sweet is faster (agent 0.065 vs 0.095 ms,
  GCSN 0.044 vs 0.046 ms).
- **Large compute-bound calls on the M3 Max** (32-64 query tokens and 64-4,096 docs, or a
  single doc): PyTorch and maxsim-cpu are up to 1.6x (single doc: 2.8x) faster. Both call
  Accelerate, whose matrix products run on the AMX matrix coprocessor; sweet's kernel
  uses the CPU cores' NEON units, and its summation order must stay fixed. At 8 query
  tokens sweet wins every size. Production queries have ~14 tokens.
- **One CPU core.** On x86, sweet is 1.12-1.16x faster than single-threaded NumPy. On the
  M3 Max, single-threaded NumPy, PyTorch and maxsim-cpu still use the AMX coprocessor
  (Accelerate ignores the thread limit), so that table is not one core against one core.
- **NumKong** is faster on one core, and in 10 of the 84 sweep cells on the EPYC (mostly
  1,024-4,096 docs with 32-64 query tokens; up to 1.5x) and 6 on the M3 Max (512-token docs
  with 64 query tokens; up to 1.8x). Its kernel is approximate (int8 screening, then
  refinement): its top document differs from the exact one on 6-14% of the replayed calls.

Fallback tiers (hosts without the native addon), production path vs: WASM 18-21x
(M3 Max) and 9x (EPYC) slower; plain JS 170-196x (M3 Max) and 77-84x (EPYC) slower.

**What this claims, and what it does not.** It is a kernel benchmark. The kernel takes
22-44 µs per call (p50) on the M3 Max and 44-102 µs on the EPYC; on the M3 Max, the
JavaScript around it in the rerank stage adds ~30-45 µs. Both are a small part of a
search, which also embeds the query with a neural model. We do not claim a faster
search end to end. A faster kernel lets the rerank stage score more candidates for the
same time.

**Notes on maxsim-cpu's scores** (they do not change its timing):

- On x86 it runs in 32-token query chunks, because its x86 build returns wrong scores
  (up to 1e38 and inf) for longer queries once a doc reaches 64 tokens
  ([mixedbread-ai/maxsim-cpu#1](https://github.com/mixedbread-ai/maxsim-cpu/issues/1),
  reproduced on the EPYC). The chunk sums add up to the full score exactly. Fewer than 1%
  of the replayed calls have more than 32 query tokens.
- On the M3 Max, its list API (`maxsim_scores_variable`) shows a max abs err of ~4e-2.
  Inside a call it pads shorter docs with zero vectors, and a zero vector scores 0. For
  some docs, a query token whose best cosine is below 0 then counts as 0: that is the
  `max(0, ·)` clamp that sweet applies on purpose. Which docs get it depends on the other
  docs in the call; one doc per call, its padded 3D API and its x86 build are exact here.
  Its top document matches the exact one on 100% of calls. Reproduce with synthetic data:
  `maxsim_cpu_padding.py`; reported as
  [mixedbread-ai/maxsim-cpu#5](https://github.com/mixedbread-ai/maxsim-cpu/issues/5).

## Apple M3 Max: Apple M3 Max, 16 logical CPUs, macOS-26.3.1-arm64-arm-64bit
Python 3.12.13, NumPy 2.5.4; rounds: 2

**agent-ho, warm (back-to-back)** (2004 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.044 | 0.079 | 0.10 | 1 |  | 1.6e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.045 | 0.082 | 0.10 | 1.03× [1.02, 1.03] | 75% | 1.6e-07 | 100.0% |
| previous production path | `node-legacy` | 0.146 | 0.216 | 0.31 | 3.46× [3.41, 3.50] | 100% | 1.6e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.092 | 0.146 | 0.20 | 2.00× [1.99, 2.01] | 100% | 1.1e-07 | 99.9% |
| PyTorch | `torch_pad_bmm@t1` | 0.213 | 0.248 | 0.44 | 4.24× [4.19, 4.28] | 100% | 1.1e-07 | 99.9% |
| maxsim-cpu | `maxsim_cpu_variable@t1` | 0.327 | 0.473 | 0.69 | 6.51× [6.42, 6.61] | 99% | 4.1e-02¹ | 100.0% |
| NumKong (approx.) | `numkong_f16@t1` | 0.121 | 0.229 | 0.29 | 2.64× [2.62, 2.67] | 100% | 8.3e-02 | 86.2% |

¹ This difference does not come from the benchmark, and it does not affect timing. maxsim-cpu's list API (`maxsim_scores_variable`, arm64 build) pads shorter docs with zero vectors inside its batches. A zero vector scores 0, so for some docs a query token whose best cosine is below 0 counts as 0, which is the `max(0, ·)` clamp that sweet applies on purpose. Which docs get it depends on the other docs in the call; one doc per call is exact. Its padded 3D API and its x86 build are exact on every call here. Reproduce: `maxsim_cpu_padding.py`; reported as [maxsim-cpu#5](https://github.com/mixedbread-ai/maxsim-cpu/issues/5).

**agent-ho, rivals given the same int4 storage (dequantization inside their timed call)** (2004 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.044 | 0.079 | 0.10 | 1 |  | 1.6e-07 | 100.0% |
| NumPy, dequantizes int4 itself | `numpy_packed_int4` | 0.990 | 1.543 | 2.14 | 20.84× [20.64, 21.03] | 100% | 1.1e-07 | 99.9% |
| maxsim-cpu, dequantizes int4 itself | `maxsim_cpu_variable_int4` | 1.516 | 2.089 | 3.12 | 30.50× [30.14, 30.85] | 100% | 4.1e-02¹ | 100.0% |

¹ maxsim-cpu's list API zero-pads docs inside its batches; see the note under the first table.

**agent-ho, one thread each. NumPy here uses Apple Accelerate, which runs matrix products on the AMX matrix coprocessor whatever the thread limit: its row is not one CPU core.** (2004 calls; ratio = other / sweet kernel, 1 thread, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel, 1 thread | `ours@t1` | 0.392 | 0.755 | 0.90 | 1 |  | 1.6e-07 | 100.0% |
| NumPy | `numpy_packed@t1` | 0.092 | 0.145 | 0.20 | 0.24× [0.24, 0.24] | 0% | 1.1e-07 | 99.9% |
| PyTorch | `torch_pad_bmm@t1` | 0.213 | 0.248 | 0.44 | 0.51× [0.51, 0.52] | 2% | 1.1e-07 | 99.9% |
| maxsim-cpu | `maxsim_cpu_variable@t1` | 0.327 | 0.473 | 0.69 | 0.79× [0.78, 0.80] | 11% | 4.1e-02¹ | 100.0% |
| NumKong (approx.) | `numkong_f16@t1` | 0.121 | 0.229 | 0.29 | 0.32× [0.32, 0.32] | 0% | 8.3e-02 | 86.2% |

¹ maxsim-cpu's list API zero-pads docs inside its batches; see the note under the first table.

**agent-ho, cold (5 ms of busy main thread before every call)** (2004 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.098 | 0.135 | 0.20 | 1 |  | 1.6e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.102 | 0.139 | 0.21 | 1.04× [1.04, 1.05] | 68% | 1.6e-07 | 100.0% |
| sweet, production path + prewarm | `node-prewarm` | 0.065 | 0.104 | 0.14 | 0.71× [0.70, 0.71] | 3% | 1.6e-07 | 100.0% |
| previous production path | `node-legacy` | 0.230 | 0.291 | 0.47 | 2.41× [2.38, 2.43] | 99% | 1.6e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.095 | 0.154 | 0.21 | 0.93× [0.92, 0.95] | 42% | 1.1e-07 | 99.9% |
| PyTorch | `torch_pad_bmm` | 0.313 | 0.402 | 0.65 | 2.93× [2.89, 2.98] | 97% | 1.1e-07 | 99.9% |
| maxsim-cpu | `maxsim_cpu_variable@t12` | 0.522 | 0.660 | 1.03 | 4.46× [4.37, 4.56] | 97% | 4.1e-02¹ | 100.0% |
| NumKong (approx.) | `numkong_f16` | 0.267 | 0.336 | 0.53 | 2.57× [2.54, 2.60] | 99% | 8.3e-02 | 86.2% |

¹ maxsim-cpu's list API zero-pads docs inside its batches; see the note under the first table.

**agent-ho, native vs the fallback tiers (every 4th call)** (501 calls; ratio = other / sweet, production path (Node), > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 0.046 | 0.084 | 0.03 | 1 |  | 1.5e-07 | 100.0% |
| WASM tier | `node-wasm` | 1.024 | 1.896 | 0.67 | 20.69× [20.26, 21.09] | 100% | 1.5e-07 | 100.0% |
| plain-JS tier | `node-js` | 9.795 | 18.809 | 6.58 | 195.69× [191.09, 200.10] | 100% | 3.1e-08 | 100.0% |

**gcsn-ho, warm (back-to-back)** (2385 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.022 | 0.037 | 0.06 | 1 |  | 2.0e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.023 | 0.038 | 0.06 | 1.04× [1.04, 1.04] | 85% | 2.0e-07 | 100.0% |
| previous production path | `node-legacy` | 0.104 | 0.154 | 0.26 | 4.65× [4.61, 4.69] | 100% | 2.0e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.046 | 0.068 | 0.11 | 2.05× [2.04, 2.06] | 100% | 1.3e-07 | 100.0% |
| PyTorch | `torch_pad_bmm@t1` | 0.158 | 0.184 | 0.37 | 6.65× [6.59, 6.71] | 100% | 1.3e-07 | 100.0% |
| maxsim-cpu | `maxsim_cpu_variable@t1` | 0.155 | 0.223 | 0.38 | 6.86× [6.81, 6.91] | 100% | 3.4e-02¹ | 100.0% |
| NumKong (approx.) | `numkong_f16@t1` | 0.059 | 0.106 | 0.15 | 2.56× [2.54, 2.57] | 100% | 9.3e-02 | 94.5% |

¹ maxsim-cpu's list API zero-pads docs inside its batches; see the note under the first table.

**gcsn-ho, rivals given the same int4 storage (dequantization inside their timed call)** (2385 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.022 | 0.037 | 0.06 | 1 |  | 2.0e-07 | 100.0% |
| NumPy, dequantizes int4 itself | `numpy_packed_int4` | 0.434 | 0.646 | 1.07 | 19.14× [18.99, 19.29] | 100% | 1.3e-07 | 100.0% |
| maxsim-cpu, dequantizes int4 itself | `maxsim_cpu_variable_int4` | 0.845 | 1.087 | 2.04 | 37.09× [36.78, 37.40] | 100% | 3.4e-02¹ | 100.0% |

¹ maxsim-cpu's list API zero-pads docs inside its batches; see the note under the first table.

**gcsn-ho, one thread each. NumPy here uses Apple Accelerate, which runs matrix products on the AMX matrix coprocessor whatever the thread limit: its row is not one CPU core.** (2385 calls; ratio = other / sweet kernel, 1 thread, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel, 1 thread | `ours@t1` | 0.167 | 0.318 | 0.43 | 1 |  | 2.0e-07 | 100.0% |
| NumPy | `numpy_packed@t1` | 0.046 | 0.067 | 0.11 | 0.28× [0.28, 0.28] | 0% | 1.3e-07 | 100.0% |
| PyTorch | `torch_pad_bmm@t1` | 0.158 | 0.184 | 0.37 | 0.91× [0.90, 0.92] | 39% | 1.3e-07 | 100.0% |
| maxsim-cpu | `maxsim_cpu_variable@t1` | 0.155 | 0.223 | 0.38 | 0.94× [0.93, 0.95] | 39% | 3.4e-02¹ | 100.0% |
| NumKong (approx.) | `numkong_f16@t1` | 0.059 | 0.106 | 0.15 | 0.35× [0.35, 0.35] | 0% | 9.3e-02 | 94.5% |

¹ maxsim-cpu's list API zero-pads docs inside its batches; see the note under the first table.

**gcsn-ho, cold (5 ms of busy main thread before every call)** (2385 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.063 | 0.091 | 0.16 | 1 |  | 2.0e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.066 | 0.096 | 0.16 | 1.05× [1.04, 1.05] | 67% | 2.0e-07 | 100.0% |
| sweet, production path + prewarm | `node-prewarm` | 0.044 | 0.061 | 0.11 | 0.70× [0.70, 0.70] | 1% | 2.0e-07 | 100.0% |
| previous production path | `node-legacy` | 0.208 | 0.246 | 0.50 | 3.27× [3.24, 3.30] | 100% | 2.0e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.046 | 0.070 | 0.12 | 0.74× [0.73, 0.74] | 1% | 1.3e-07 | 100.0% |
| PyTorch | `torch_pad_bmm` | 0.251 | 0.302 | 0.59 | 3.85× [3.82, 3.88] | 100% | 1.3e-07 | 100.0% |
| maxsim-cpu | `maxsim_cpu_variable@t12` | 0.371 | 0.438 | 0.88 | 5.78× [5.74, 5.82] | 100% | 3.4e-02¹ | 100.0% |
| NumKong (approx.) | `numkong_f16` | 0.224 | 0.257 | 0.54 | 3.55× [3.53, 3.58] | 100% | 9.3e-02 | 94.5% |

¹ maxsim-cpu's list API zero-pads docs inside its batches; see the note under the first table.

**gcsn-ho, native vs the fallback tiers (every 4th call)** (597 calls; ratio = other / sweet, production path (Node), > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 0.023 | 0.038 | 0.01 | 1 |  | 1.5e-07 | 100.0% |
| WASM tier | `node-wasm` | 0.440 | 0.743 | 0.28 | 18.55× [18.39, 18.70] | 100% | 1.5e-07 | 100.0% |
| plain-JS tier | `node-js` | 4.120 | 7.783 | 2.64 | 170.25× [167.62, 172.92] | 100% | 2.0e-08 | 100.0% |

**Size sweep (held-out embeddings):** per cell, the fastest exact rival (any library, any configuration) / sweet, geometric mean over the cell's calls; > 1 = sweet faster. In brackets: which library.


8 query tokens

| docs \ doc tokens | natural | 32 | 128 | 512 |
|--:|--:|--:|--:|--:|
| 1 | 1.16 (mx) | 0.98 (mx) | 0.97 (mx) | 1.47 (mx) |
| 4 | 2.15 (np) | 1.50 (np) | 1.72 (np) | 2.49 (np) |
| 16 | 2.76 (np) | 1.97 (np) | 2.48 (np) | 2.89 (np) |
| 64 | 2.95 (np) | 2.47 (np) | 2.99 (np) | 3.04 (np) |
| 256 | 3.90 (np) | 2.27 (mx) | 3.18 (np) | 2.64 (np) |
| 1024 | 2.69 (np) | 1.44 (mx) | 2.69 (np) | 2.73 (np) |
| 4096 | 2.68 (np) | 1.59 (mx) | 2.63 (np) | 2.61 (np) |

32 query tokens

| docs \ doc tokens | natural | 32 | 128 | 512 |
|--:|--:|--:|--:|--:|
| 1 | 0.66 (mx) | 0.54 (mx) | 0.49 (mx) | 0.87 (mx) |
| 4 | 1.21 (np) | 1.18 (np) | 1.08 (np) | 1.37 (np) |
| 16 | 1.45 (np) | 1.53 (pt) | 1.45 (np) | 1.35 (np) |
| 64 | 1.54 (np) | 1.92 (np) | 1.39 (np) | 0.85 (pt) |
| 256 | 1.17 (pt) | 1.37 (mx) | 0.85 (pt) | 1.18 (pt) |
| 1024 | 1.29 (pt) | 0.93 (mx) | 1.25 (pt) | 1.21 (pt) |
| 4096 | 1.15 (pt) | 0.88 (mx) | 1.22 (pt) | 1.13 (pt) |

64 query tokens

| docs \ doc tokens | natural | 32 | 128 | 512 |
|--:|--:|--:|--:|--:|
| 1 | 0.54 (mx) | 0.44 (mx) | 0.36 (mx) | 0.73 (mx) |
| 4 | 1.04 (np) | 1.04 (np) | 0.93 (np) | 1.11 (np) |
| 16 | 1.22 (np) | 1.50 (np) | 1.15 (np) | 1.16 (np) |
| 64 | 0.92 (pt) | 1.69 (np) | 1.19 (pt) | 0.62 (pt) |
| 256 | 0.78 (pt) | 1.24 (pt) | 0.66 (pt) | 0.87 (pt) |
| 1024 | 0.88 (pt) | 0.85 (pt) | 0.94 (pt) | 0.80 (pt) |
| 4096 | 0.79 (pt) | 0.86 (pt) | 0.82 (pt) | 0.79 (pt) |

np = NumPy, pt = PyTorch, mx = maxsim-cpu.


## AMD EPYC Milan (Hetzner CCX33 VM): AMD EPYC-Milan Processor, 8 logical CPUs, Linux-7.0.0-28-generic-x86_64-with-glibc2.43
Python 3.12.13, NumPy 2.5.4; rounds: 2

maxsim-cpu runs here in 32-token query chunks: its x86 build returns wrong scores for longer queries once a doc reaches 64 tokens ([maxsim-cpu#1](https://github.com/mixedbread-ai/maxsim-cpu/issues/1), reproduced on this machine). The chunk sums add up to the full score exactly; see its max abs err column. Fewer than 1% of the replayed calls have more than 32 query tokens, so almost every call is one chunk.

**agent-ho, warm (back-to-back)** (2004 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.102 | 0.202 | 0.24 | 1 |  | 1.7e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.114 | 0.259 | 0.27 | 1.15× [1.14, 1.16] | 89% | 1.7e-07 | 100.0% |
| previous production path | `node-legacy` | 0.407 | 0.667 | 0.90 | 4.17× [4.14, 4.21] | 100% | 1.7e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.144 | 0.261 | 0.33 | 1.44× [1.43, 1.45] | 99% | 7.7e-08 | 99.9% |
| PyTorch | `torch_pad_bmm` | 0.198 | 0.314 | 0.45 | 1.89× [1.87, 1.91] | 100% | 1.1e-07 | 99.9% |
| maxsim-cpu | `maxsim_cpu_variable` | 0.234 | 0.427 | 0.54 | 2.44× [2.42, 2.47] | 100% | 1.5e-07 | 99.9% |
| NumKong (approx.) | `numkong_f16@t1` | 0.272 | 0.538 | 0.64 | 2.65× [2.63, 2.66] | 100% | 8.3e-02 | 86.4% |

**agent-ho, rivals given the same int4 storage (dequantization inside their timed call)** (2004 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.102 | 0.202 | 0.24 | 1 |  | 1.7e-07 | 100.0% |
| NumPy, dequantizes int4 itself | `numpy_packed_int4` | 1.160 | 1.820 | 2.61 | 10.95× [10.84, 11.06] | 100% | 7.7e-08 | 99.9% |
| maxsim-cpu, dequantizes int4 itself | `maxsim_cpu_variable_int4` | 1.557 | 2.950 | 3.62 | 16.21× [16.00, 16.41] | 100% | 1.5e-07 | 99.9% |

**agent-ho, one thread each.** (2004 calls; ratio = other / sweet kernel, 1 thread, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel, 1 thread | `ours@t1` | 0.412 | 0.800 | 0.95 | 1 |  | 1.7e-07 | 100.0% |
| NumPy | `numpy_packed@t1` | 0.453 | 0.828 | 1.06 | 1.12× [1.12, 1.13] | 88% | 1.1e-07 | 98.7% |
| PyTorch | `torch_pad_bmm@t1` | 0.654 | 1.043 | 1.48 | 1.53× [1.52, 1.54] | 100% | 1.1e-07 | 99.9% |
| maxsim-cpu | `maxsim_cpu_variable@t1` | 0.958 | 2.106 | 2.31 | 2.42× [2.41, 2.44] | 100% | 1.5e-07 | 99.9% |
| NumKong (approx.) | `numkong_f16@t1` | 0.272 | 0.538 | 0.64 | 0.68× [0.68, 0.68] | 1% | 8.3e-02 | 86.4% |

**agent-ho, cold (5 ms of busy main thread before every call)** (2004 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.199 | 0.359 | 0.46 | 1 |  | 1.7e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.227 | 0.412 | 0.51 | 1.13× [1.12, 1.13] | 91% | 1.7e-07 | 100.0% |
| sweet, production path + prewarm | `node-prewarm` | 0.217 | 0.420 | 0.50 | 1.09× [1.08, 1.09] | 78% | 1.7e-07 | 100.0% |
| previous production path | `node-legacy` | 0.797 | 1.294 | 1.72 | 4.00× [3.97, 4.03] | 100% | 1.7e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.149 | 0.321 | 0.41 | 0.74× [0.73, 0.76] | 3% | 7.7e-08 | 99.9% |
| PyTorch | `torch_pad_bmm` | 0.214 | 0.333 | 0.49 | 1.01× [1.00, 1.01] | 52% | 1.1e-07 | 99.9% |
| maxsim-cpu | `maxsim_cpu_variable` | 0.510 | 0.856 | 1.13 | 2.60× [2.58, 2.62] | 100% | 1.5e-07 | 99.9% |
| NumKong (approx.) | `numkong_f16` | 0.608 | 0.858 | 1.24 | 3.04× [2.99, 3.09] | 100% | 8.3e-02 | 86.4% |

**agent-ho, native vs the fallback tiers (every 4th call)** (501 calls; ratio = other / sweet, production path (Node), > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 0.117 | 0.245 | 0.08 | 1 |  | 1.7e-07 | 100.0% |
| WASM tier | `node-wasm` | 1.152 | 2.206 | 0.75 | 9.38× [9.21, 9.54] | 100% | 1.5e-07 | 100.0% |
| plain-JS tier | `node-js` | 10.472 | 20.529 | 7.06 | 84.13× [82.52, 85.72] | 100% | 3.1e-08 | 100.0% |

**gcsn-ho, warm (back-to-back)** (2385 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.044 | 0.095 | 0.12 | 1 |  | 2.5e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.054 | 0.106 | 0.14 | 1.21× [1.20, 1.21] | 95% | 2.5e-07 | 100.0% |
| previous production path | `node-legacy` | 0.237 | 0.365 | 0.59 | 5.23× [5.19, 5.28] | 100% | 2.5e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.071 | 0.117 | 0.18 | 1.57× [1.56, 1.59] | 98% | 1.1e-07 | 100.0% |
| PyTorch | `torch_pad_bmm` | 0.131 | 0.204 | 0.32 | 2.80× [2.77, 2.83] | 100% | 1.3e-07 | 100.0% |
| maxsim-cpu | `maxsim_cpu_variable` | 0.127 | 0.234 | 0.32 | 2.69× [2.67, 2.71] | 100% | 1.8e-07 | 100.0% |
| NumKong (approx.) | `numkong_f16@t1` | 0.125 | 0.241 | 0.33 | 2.70× [2.69, 2.71] | 100% | 9.3e-02 | 94.3% |

**gcsn-ho, rivals given the same int4 storage (dequantization inside their timed call)** (2385 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.044 | 0.095 | 0.12 | 1 |  | 2.5e-07 | 100.0% |
| NumPy, dequantizes int4 itself | `numpy_packed_int4` | 0.519 | 0.773 | 1.28 | 11.41× [11.28, 11.55] | 100% | 1.1e-07 | 100.0% |
| maxsim-cpu, dequantizes int4 itself | `maxsim_cpu_variable_int4` | 0.867 | 1.475 | 2.18 | 18.91× [18.65, 19.17] | 100% | 1.8e-07 | 100.0% |

**gcsn-ho, one thread each.** (2385 calls; ratio = other / sweet kernel, 1 thread, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel, 1 thread | `ours@t1` | 0.174 | 0.341 | 0.46 | 1 |  | 2.5e-07 | 100.0% |
| NumPy | `numpy_packed@t1` | 0.200 | 0.355 | 0.51 | 1.16× [1.15, 1.17] | 90% | 1.1e-07 | 100.0% |
| PyTorch | `torch_pad_bmm@t1` | 0.460 | 0.739 | 1.12 | 2.53× [2.51, 2.56] | 100% | 1.3e-07 | 100.0% |
| maxsim-cpu | `maxsim_cpu_variable@t1` | 0.431 | 0.895 | 1.15 | 2.51× [2.49, 2.52] | 100% | 1.8e-07 | 100.0% |
| NumKong (approx.) | `numkong_f16@t1` | 0.125 | 0.241 | 0.33 | 0.71× [0.71, 0.71] | 0% | 9.3e-02 | 94.3% |

**gcsn-ho, cold (5 ms of busy main thread before every call)** (2385 calls; ratio = other / sweet kernel, > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet kernel | `ours` | 0.109 | 0.172 | 0.27 | 1 |  | 2.5e-07 | 100.0% |
| sweet, production path (Node) | `node-production` | 0.119 | 0.210 | 0.31 | 1.12× [1.12, 1.13] | 87% | 2.5e-07 | 100.0% |
| sweet, production path + prewarm | `node-prewarm` | 0.112 | 0.204 | 0.29 | 1.04× [1.04, 1.05] | 57% | 2.5e-07 | 100.0% |
| previous production path | `node-legacy` | 0.490 | 0.750 | 1.22 | 4.52× [4.49, 4.55] | 100% | 2.5e-07 | 100.0% |
| NumPy | `numpy_packed` | 0.075 | 0.126 | 0.22 | 0.71× [0.70, 0.72] | 2% | 1.1e-07 | 100.0% |
| PyTorch | `torch_pad_bmm` | 0.145 | 0.225 | 0.36 | 1.30× [1.29, 1.31] | 93% | 1.3e-07 | 100.0% |
| maxsim-cpu | `maxsim_cpu_variable` | 0.303 | 0.496 | 0.77 | 2.77× [2.76, 2.79] | 100% | 1.8e-07 | 100.0% |
| NumKong (approx.) | `numkong_f16` | 0.577 | 0.734 | 1.39 | 5.24× [5.18, 5.30] | 100% | 9.3e-02 | 94.3% |

**gcsn-ho, native vs the fallback tiers (every 4th call)** (597 calls; ratio = other / sweet, production path (Node), > 1 = sweet faster)

| | config | p50 ms | p95 ms | total s | ratio [95% CI] | sweet faster on | max abs err | top-1 = exact |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| sweet, production path (Node) | `node-production` | 0.055 | 0.116 | 0.04 | 1 |  | 1.5e-07 | 100.0% |
| WASM tier | `node-wasm` | 0.502 | 0.854 | 0.32 | 8.94× [8.80, 9.09] | 100% | 1.5e-07 | 100.0% |
| plain-JS tier | `node-js` | 4.403 | 8.354 | 2.85 | 76.95× [75.73, 78.16] | 100% | 2.0e-08 | 100.0% |

**Size sweep (held-out embeddings):** per cell, the fastest exact rival (any library, any configuration) / sweet, geometric mean over the cell's calls; > 1 = sweet faster. In brackets: which library.


8 query tokens

| docs \ doc tokens | natural | 32 | 128 | 512 |
|--:|--:|--:|--:|--:|
| 1 | 2.21 (np) | 1.72 (mx) | 1.88 (np) | 2.31 (np) |
| 4 | 1.85 (np) | 2.37 (np) | 2.33 (pt) | 1.54 (np) |
| 16 | 1.60 (np) | 2.22 (pt) | 1.58 (pt) | 1.34 (pt) |
| 64 | 1.58 (np) | 1.50 (pt) | 1.67 (np) | 1.39 (pt) |
| 256 | 1.37 (np) | 0.84 (pt) | 1.18 (pt) | 1.31 (np) |
| 1024 | 1.66 (np) | 1.00 (pt) | 1.49 (np) | 1.69 (np) |
| 4096 | 1.67 (np) | 1.67 (np) | 1.66 (np) | 1.82 (np) |

32 query tokens

| docs \ doc tokens | natural | 32 | 128 | 512 |
|--:|--:|--:|--:|--:|
| 1 | 1.46 (np) | 1.56 (np) | 1.30 (np) | 1.52 (np) |
| 4 | 1.11 (np) | 1.80 (pt) | 1.34 (pt) | 1.02 (pt) |
| 16 | 1.86 (np) | 1.62 (pt) | 0.99 (pt) | 0.97 (pt) |
| 64 | 1.05 (np) | 1.02 (pt) | 1.26 (pt) | 1.12 (pt) |
| 256 | 1.19 (np) | 1.15 (pt) | 1.04 (pt) | 1.14 (pt) |
| 1024 | 1.09 (np) | 1.13 (pt) | 1.34 (pt) | 1.21 (pt) |
| 4096 | 1.20 (np) | 1.42 (pt) | 1.27 (pt) | 1.28 (np) |

64 query tokens

| docs \ doc tokens | natural | 32 | 128 | 512 |
|--:|--:|--:|--:|--:|
| 1 | 0.99 (np) | 1.31 (np) | 0.95 (np) | 1.30 (np) |
| 4 | 0.97 (np) | 1.45 (pt) | 1.10 (pt) | 1.11 (pt) |
| 16 | 1.01 (np) | 1.13 (pt) | 1.09 (pt) | 1.03 (pt) |
| 64 | 0.97 (np) | 0.96 (pt) | 1.21 (pt) | 1.09 (pt) |
| 256 | 0.98 (np) | 0.95 (pt) | 0.95 (pt) | 1.06 (pt) |
| 1024 | 1.13 (np) | 1.11 (pt) | 1.24 (pt) | 1.14 (pt) |
| 4096 | 1.11 (np) | 1.16 (pt) | 1.16 (pt) | 1.30 (np) |

np = NumPy, pt = PyTorch, mx = maxsim-cpu.

