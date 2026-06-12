# @sweet-search/native-linux-arm64-gnu-cuda

NVIDIA CUDA-enabled native binaries for [sweet-search](https://github.com/mrsladoje/sweet-search) on Linux arm64 (glibc) — **Jetson Orin**, **Grace Hopper**, and arm64 SBSA server GPUs.

This package is a platform-scoped `optionalDependency` of the main `sweet-search`
package. npm installs it automatically on matching hosts:

- `os === 'linux'`
- `cpu === 'arm64'`
- `libc === 'glibc'` (Ubuntu/Debian/RHEL on arm64 — not Alpine/musl)

On non-matching platforms, npm silently skips this package.

## What's inside

- `sweet-search-native.node` — napi-rs addon built with the `cuda,flash-attn`
  Cargo features for `aarch64-unknown-linux-gnu`. Embedding + late-interaction
  inference dispatch to candle-cuda when `libcuda.so.1` is present at runtime;
  otherwise the addon fails to load and sweet-search falls back to the
  CPU-only `@sweet-search/native-linux-arm64-gnu` variant.
- `sweet-search` — Rust CLI binary (identical to the non-CUDA Linux arm64
  package).

## Runtime requirements

- Linux arm64 (aarch64) with glibc ≥ 2.31
- NVIDIA driver providing `libcuda.so.1`
- Compute capability ≥ 7.0 (Jetson Orin is SM 8.7, Grace Hopper is SM 9.0;
  older Jetson Xavier at SM 7.2 also qualifies but is EOL)
- CUDA Toolkit 12.x runtime components; the binary is linked against CUDA
  12.2 at build time

Flash-attention kernels are compiled for `CUDA_COMPUTE_CAP=87` (Jetson Orin)
with forward compatibility to SM 9.0 (Grace Hopper). On SM 7.x hardware the
flash-attn path is skipped at runtime and candle's naive attention is used
instead — the binary supports both paths.

## Install

Automatic via the main `sweet-search` package:

```bash
npm install sweet-search
```

On a Linux arm64 host with a working NVIDIA driver, npm pulls this
CUDA-enabled addon and `core/infrastructure/native-resolver.js` prefers it
over the plain `@sweet-search/native-linux-arm64-gnu` variant.

## Detecting whether CUDA is armed

Runtime detection is authoritative. Run `sweet-search init` — its report
prints either `NVIDIA GPU: <name> ... candle-cuda armed` or a warning that
the standard CPU-only package should be installed. `.sweet-search/config.json`
records the decision under `runtime.hardware`. See
`docs/INIT_STRATEGY.md` → "CUDA Backend" for the full contract.

## Troubleshooting

Force-disable CUDA without uninstalling:

```bash
export SWEET_SEARCH_CUDA=0    # or pass --skip-cuda to `sweet-search init`
```

Parity between the CUDA path and the CPU reference is validated pre-release
with `node scripts/parity-cuda.js` on a real Jetson Orin or Grace host.
