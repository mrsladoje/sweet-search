# candle-flash-attn 0.10.2, patched

Source: crates.io `candle-flash-attn` 0.10.2 (MIT OR Apache-2.0), unpacked
unchanged except for the files below. CUTLASS is still fetched by
`build.rs` at the pinned commit.

## CUDA errors are reported

Upstream defines `C10_CUDA_CHECK` as a no-op and `run_mha` returns `void`.
A kernel that cannot launch (the sm_80-only build on sm_90 and sm_120) left
the output buffer uninitialised, and the call returned `Ok`: half-precision
CodeRankEmbed embeddings were NaN or noise on Blackwell.

- `kernels/error.h`: `C10_CUDA_CHECK` keeps the first error of the call in a
  thread-local.
- `kernels/flash_api.cu`: `run_mha` clears stale runtime errors, checks
  `cudaGetLastError()` after the launch and returns the first error;
  `flash_attn_error_name` maps a code to its CUDA name.
- `src/ffi.rs`, `src/lib.rs`: both call sites turn a non-zero code into
  `Err("flash-attn: CUDA error <code> (<name>)")`.

A launch error is caught at once. An error inside the running kernel
surfaces at the next synchronising call, as for any CUDA kernel; the numeric
self-check in `src/inference/varlen.rs` stays in place for that case.

Stream: `run_mha` launches on the legacy default stream (stream 0). The
product creates devices with `Device::new_cuda`, which also uses the default
stream, so the kernel is ordered with candle's own work. Do not switch to
`new_cuda_with_stream` without passing that stream through.

## Only the kernels the product runs, for Ampere, Hopper and Blackwell

Upstream builds 36 kernel files (head dims 32-512, causal and not) as SASS
for `CUDA_COMPUTE_CAP` only, so the x86-64 release (80) carried no kernel
for Hopper or Blackwell: the launch failed (CUDA error 209, now reported)
and standard attention ran instead.

- `build.rs` compiles `flash_api.cu` plus the two head-dim-64, non-causal
  files (fp16, bf16). NomicBERT, ModernBERT and the edge model all use
  64-wide heads with bidirectional or sliding-window attention.
- Besides the `CUDA_COMPUTE_CAP` SASS (sm_80 / sm_87), it adds sm_90 SASS
  and compute_90 PTX, which the driver JIT-compiles on 10.x and 12.x
  (CUDA 12.2 has no sm_100 / sm_120 target). The JIT result is cached by
  the driver (`~/.nv/ComputeCache`).
- `kernels/flash_api.cu`: `run_mha_fwd` refuses any other head dim or a
  causal call with `cudaErrorInvalidValue` instead of dispatching to a
  kernel that is not built. The addon gates flash-attn on head dim 64.
- The other `flash_fwd_hdim*.cu` files are removed from this copy.
