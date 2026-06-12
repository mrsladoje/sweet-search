# @sweet-search/native-linux-x64-gnu-cuda

NVIDIA CUDA-enabled native binaries for [sweet-search](https://github.com/mrsladoje/sweet-search) on Linux x86-64 (glibc).

This package is a platform-scoped `optionalDependency` of the main `sweet-search`
package. npm installs it automatically on matching hosts:

- `os === 'linux'`
- `cpu === 'x64'`
- `libc === 'glibc'` (Debian/Ubuntu/RHEL/SUSE — not Alpine/musl)

On non-matching platforms, npm silently skips this package.

## What's inside

- `sweet-search-native.node` — napi-rs addon built with the `cuda,flash-attn`
  Cargo features. Embedding + late-interaction inference dispatch to
  candle-cuda when `libcuda.so.1` is present at runtime; otherwise the addon
  fails to load and sweet-search falls back to the CPU-only
  `@sweet-search/native-linux-x64-gnu` variant via
  `core/infrastructure/native-resolver.js`.
- `sweet-search` — Rust CLI binary (identical to the non-CUDA Linux x64
  package; the CUDA feature lives in the napi addon, not the CLI).

## Runtime requirements

- Linux x86-64 with glibc ≥ 2.31 (Ubuntu 20.04 / Debian 11 / RHEL 9 or newer)
- NVIDIA driver ≥ 525 providing `libcuda.so.1`
- Compute capability ≥ 7.0 (Volta V100 / Turing T4 / Ampere A100, H100, RTX
  3090/4090 / Ada L4 / Hopper)
- `libcudart.so.12` from CUDA Toolkit 12.x — the binary is linked against
  CUDA 12.2 at build time

Flash-attention kernels require SM 8.0+ (Ampere+). On SM 7.0/7.5 hardware the
flash-attn path is skipped at runtime and candle's naive attention is used
instead — the binary supports both paths.

## Install

This package is normally installed automatically as an `optionalDependency`:

```bash
npm install sweet-search
```

On a Linux x64 host with a working NVIDIA driver, npm pulls this CUDA-enabled
addon, `core/infrastructure/native-resolver.js` prefers it over the plain
`@sweet-search/native-linux-x64-gnu` variant, and indexing uses the GPU.

## Detecting whether CUDA is armed

Runtime detection is authoritative. Run `sweet-search init` — its report
prints one of:

- `NVIDIA GPU: <name> (CC x.y, N MB, driver M.m.p) — candle-cuda armed`
  when this addon loaded cleanly and `nvidia-smi` + `Device::new_cuda(0)`
  both succeeded.
- A warning that the standard CPU-only package should be installed when
  the `-cuda` addon was resolved but failed to initialize (typically
  missing `libcuda.so.1` or an incompatible driver).

`.sweet-search/config.json` records the decision under `runtime.hardware`
(`cudaAddonEnabled`, `cudaAvailable`, `cudaReason`, `candleGpuBackend`,
`inferenceBackendPreference`). See `docs/INIT_STRATEGY.md` → "CUDA Backend"
for the full contract.

## Troubleshooting

To force-disable CUDA without uninstalling the package:

```bash
export SWEET_SEARCH_CUDA=0    # or pass --skip-cuda to `sweet-search init`
```

Parity between the CUDA path and the CPU reference is validated pre-release
with `node scripts/parity-cuda.js` (see `docs/INIT_STRATEGY.md` for the
check's min/mean thresholds).
