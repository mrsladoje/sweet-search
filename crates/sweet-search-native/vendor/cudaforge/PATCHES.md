# cudaforge 0.1.5, patched

Source: crates.io `cudaforge` 0.1.5 (MIT OR Apache-2.0), unpacked unchanged
except for `src/builder.rs`.

## PTX cache keyed by target

`build_ptx` skipped a kernel when its `.ptx` was newer than the `.cu`. Cargo
reruns the build script when `CUDA_COMPUTE_CAP` changes, but in the same
`OUT_DIR`, so the old PTX survived and the addon carried kernels for the
previous target. `build_ptx` now writes `<kernel>.ptx.target` (the
`-gencode` argument and extra nvcc arguments) after a successful compile and
reuses a `.ptx` only when that stamp matches. Clean builds (the release CI)
were not affected; local and pod rebuilds were.
