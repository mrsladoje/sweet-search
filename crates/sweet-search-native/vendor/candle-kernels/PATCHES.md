# candle-kernels 0.10.2, patched

Source: crates.io `candle-kernels` 0.10.2 (MIT OR Apache-2.0), unpacked
unchanged except for `build.rs` and `src/lib.rs`.

## Two PTX sets: Volta/Turing and the build target

Upstream compiles every kernel to one PTX set for `CUDA_COMPUTE_CAP`. PTX
only JIT-compiles forward, so the x86-64 release (80) could not load a
single kernel on Volta (7.0) or Turing (7.5).

- `build.rs` builds the kernels twice: `ptx_low/` for compute_70 and
  `ptx_high/` for `CUDA_COMPUTE_CAP`, and writes `ptx.rs` with both
  (`AFFINE`, `AFFINE_LOW`, ...) plus `HIGH_PTX_CAP` / `LOW_PTX_CAP`.
  `CUDA_COMPUTE_CAP` is required.
- `src/lib.rs`: `select_compute_capability(cap_x10)` records the device's
  capability; `Module::ptx()` returns the LOW set below `HIGH_PTX_CAP`.
  sweet-search-native calls it when it creates the CUDA device, before any
  kernel loads.

The LOW set has no bf16 or fp8 kernels (they sit behind `__CUDA_ARCH__ >=
800` / `>= 890` guards), so a device on the LOW set must run F32 or F16;
the addon's dtype policy enforces that.
