# Sweet Search Init and Packaging Strategy

**Last updated**: 2026-04-14
**Status**: Phases 1–8 all implemented. CoreML variant cascade (Phase 8) is
fetched from HuggingFace as part of the standard `sweet-search init` full
profile on M3+ Apple Silicon, with hardware-aware capability gating and a
local-build fallback for developers/air-gapped environments.

---

## Goal

A single command installs Sweet Search and all runtime artifacts for the selected profile.
No manual downloads, no post-install surprises.

```bash
npx sweet-search init
```

After the command completes the user has:

- the JS package and all npm-managed dependencies
- all first-party WASM and router assets (shipped inside the main package)
- platform-native binary and addon auto-selected via `optionalDependencies`
- profile-selected model artifacts fetched and verified in a managed local cache
- on M3+ Apple Silicon: a record of the CoreML variant cascade state (present,
  eligible-but-not-built, or not-applicable) so native inference can arm the
  CoreML fast path when artifacts are cached, and fall back to candle transparently
  otherwise
- a generated `.sweet-search/config.json` that records the hardware decision and
  cascade state alongside the profile
- a verified runtime

---

## Package Topology

| Package | Role |
|---------|------|
| `sweet-search` | Main: all JS, WASM, router assets, CLI dispatcher, init/uninstall |
| `@sweet-search/native-darwin-arm64` | Native addon + Rust CLI binary for macOS arm64 |
| `@sweet-search/native-darwin-x64` | Native addon + Rust CLI binary for macOS x64 |
| `@sweet-search/native-linux-x64-gnu` | Native addon + Rust CLI binary for Linux x64 glibc |
| `@sweet-search/native-linux-arm64-gnu` | Native addon + Rust CLI binary for Linux arm64 glibc |
| `@sweet-search/native-linux-x64-gnu-cuda` | As above + `cuda,flash-attn` Cargo features (NVIDIA SM 7.0+ on x86-64) |
| `@sweet-search/native-linux-arm64-gnu-cuda` | As above + `cuda,flash-attn` for Jetson Orin / Grace Hopper |

Native packages are `optionalDependencies`. npm installs only the one(s) matching the
current platform's `os`/`cpu`/`libc` fields. Other platforms fall back to WASM/JS. On
Linux with an NVIDIA driver, `core/infrastructure/native-resolver.js` prefers the `-cuda`
variant when both CPU and CUDA variants resolve.

Model artifacts are not distributed via npm. They are fetched by `sweet-search init` into a
managed local cache with checksum verification, atomic writes, retries, and resumable
downloads.

---

## Init Profiles

### `core`

Verifies: main package JS, WASM blobs (`core/infrastructure/maxsim.wasm`,
`core/infrastructure/simd-distance.wasm`), WASM router, CatBoost router, native package.
Does not fetch model artifacts. Suitable for CI and lightweight lexical search.

### `full` (default)

Everything in `core`, plus init-managed fetch of:

| Model | HF ID | Size | Used by |
|-------|-------|------|---------|
| Late interaction INT8 128d (standard) | `lightonai/LateOn-Code` | ~150 MB | ORT path |
| Late interaction FP32 (standard backbone) | `lightonai/LateOn-Code` (`model.safetensors`) | ~596 MB | Native (Metal/CUDA) path |
| Late interaction FP32 48d (edge) | `lightonai/LateOn-Code-edge` | ~68 MB | ORT path |
| Late interaction FP32 (edge backbone) | `lightonai/LateOn-Code-edge` (`model.safetensors`) | ~67 MB | Native (Metal/CUDA) path |
| Local reranker INT8 | `Alibaba-NLP/gte-reranker-modernbert-base` | ~151 MB | Opt-in (cascade) |
| Local embedding INT8 768d | `mrsladoje/CodeRankEmbed-onnx-int8` | ~139 MB | ORT path |
| Local embedding FP32 768d | `nomic-ai/CodeRankEmbed` (`model.safetensors`) | ~547 MB | Native (Metal/CUDA) path |
| FlashRank cross-encoder | `Xenova/ms-marco-TinyBERT-L-2-v2` | ~4.3 MB | Opt-in (cascade) |
| Semantic cache embedding | `Xenova/all-MiniLM-L6-v2` | ~23 MB | Query cache |

The standard `lateon-code` model is the active LI variant by default;
`lateon-code-edge` is opt-in via `SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge`
or the `--late-interaction-model=lateon-code-edge` CLI flag and is wired
through both ORT and native (Metal/CoreML/CUDA) paths.

**Accelerator gating of the FP32 native backbones.** The three "Native
(Metal/CUDA) path" FP32 safetensors above (`coderankembed-fp32`,
`lateon-code-fp32`, `lateon-code-edge-fp32`) are loaded only by the
candle/native inference path, which is armed exclusively for accelerated
indexing. On a host with no usable accelerator — `darwin-x64`, Linux without
a working CUDA addon, `SWEET_SEARCH_CUDA=0`/`--skip-cuda`, or any host whose
`inferenceBackendPreference` resolves to `ort-cpu` — init **skips** those
~1.2 GB of FP32 weights entirely. Such hosts index (and query) on the
optimized ORT INT8 CPU path, so the FP32 backbones would never load. The ORT
INT8 embedding (`coderankembed-int8`), the active LI ONNX model (unless
`--li-model none`), and the semantic cache model (`all-minilm-l6-v2`) are
still fetched; opt-in reranker env vars are still honored.

All artifacts are verified with SHA256 checksums from
`core/infrastructure/model-registry.js`. The registry lists every model
with `profile: 'full'`. Note: `core/infrastructure/manifest.json` currently
lists only the four ORT-side models in its `profiles.full.models` array;
the FP32 native backbones, FlashRank, and semantic cache models are
fetched via the registry's `getModelsForProfile()` but are not yet in
the manifest.

---

## CoreML Variant Cascade (M3+ Apple Silicon)

The CoreML variant cascade is a hardware-gated acceleration layer that runs
alongside the candle Metal backbone on M3+ Apple Silicon. It delivers ~18%
faster full indexing on an M3 Max vs the candle BF16 baseline (measured
2026-04-14 against `sweet-search-private` at 16,347 docs).

### What it is

A set of 18 pre-traced CoreML `.mlpackage` directories covering the shape
stair-step produced by the indexer's cache-aware bucketer:

- 6 **NomicBERT embedding** variants (768d, shared by both LI variants)
- 6 **ModernBERT LI standard** variants (`lateon-code`, 768d backbone → 128d output)
- 6 **ModernBERT LI edge** variants (`lateon-code-edge`, 256d backbone → 2-stage 256→512→48 projection → 48d output)

The Rust native addon picks the smallest variant that fits each batch and
dispatches it to Apple's Neural Engine through a thin Obj-C shim. Anything
that exceeds the largest variant falls through to candle — the cascade
never replaces candle; it short-circuits it when profitable. Standard and
edge LI cascades live in separate dirs (`coreml-cascade/li/` vs
`coreml-cascade/li-edge/`) and use distinct filename prefixes
(`li_modernbert_b…` vs `li_modernbert_edge_b…`); only the cascade
matching the active `LATE_INTERACTION_CONFIG.model` is armed at runtime.

Single source of truth for the shape set: `core/infrastructure/coreml-cascade.json`.
Both the JS cascade module and `scripts/spike-coreml/trace_cascade.py` read this
file so the shapes traced during a local build always match the shapes the Rust
filename parser (`parse_embed_variant_filename` / `parse_li_variant_filename`)
looks for on disk.

### Hardware gating

`core/infrastructure/hardware-capability.js::detectHardwareCapability()` reads
`sysctl -n machdep.cpu.brand_string` and classifies the current machine. The
cascade is marked eligible iff:

- `platform === 'darwin'`
- `arch === 'arm64'`
- Apple chip generation ≥ 3 (M3, M4, M5, …)

The generation floor is empirical. M1/M2 ANE TOPS is below M3 and the cascade's
measured per-batch latency improvements on smaller shapes do not cover the
`mlmodelc` compile overhead for those generations. Rather than ship a feature
that regresses on older hardware, the gate is conservative. Unknown newer
chips (e.g., M5 before this file is updated) are admitted under the same
`>= 3` rule on the optimistic assumption that newer is not worse.

Non-eligible hardware silently hits the candle path — users have no action to
take and init does not log a noisy not-applicable line.

### Cache layout

When the cascade is built, artifacts live under the same managed cache root as
safetensors models, so `SWEET_SEARCH_MODEL_CACHE`, init, and uninstall all see
a consistent picture:

```
{modelCacheRoot}/coreml-cascade/
  embed/                                         ← 6 variant dirs (NomicBERT 768d)
    nomic_bert_b64_s96_fp16.mlpackage/
    nomic_bert_b64_s96_fp16.mlpackage.mlmodelc/  ← compiled cache sibling
    nomic_bert_b64_s192_fp16.mlpackage/
    nomic_bert_b64_s192_fp16.mlpackage.mlmodelc/
    ...
  li/                                            ← 6 variant dirs (LateOn-Code, 128d)
    li_modernbert_b128_s48_fp16.mlpackage/
    li_modernbert_b128_s48_fp16.mlpackage.mlmodelc/
    ...
  li-edge/                                       ← 6 variant dirs (LateOn-Code-edge, 48d)
    li_modernbert_edge_b128_s48_fp16.mlpackage/
    li_modernbert_edge_b128_s48_fp16.mlpackage.mlmodelc/
    ...
```

Each `.mlmodelc` sibling is written by `coreml_shim.m` after the first load
compile. Invalidation is **content-hash** (SHA256 of the source `.mlpackage/Manifest.json`)
stored as a sidecar inside the cached bundle. Writes are **stage-and-rename**
(compile → temp `.stage-PID-TS` dir → atomic `moveItemAtURL:` into place) so two
concurrent processes compiling the same variant cannot corrupt the cache. This
matches the robustness contract for the rest of the model cache (atomic writes,
checksum verification).

Cold compile overhead is amortised to a one-time cost per variant per machine;
warm loads collapse to single-digit milliseconds. Variants that `pick()` never
selects are never compiled — startup stays fast even with the full cascade.

### Delivery strategy

The cascade ships two ways, both landing at the same on-disk state:

1. **HuggingFace fetch (default, shipped).** The 18 pre-traced
   `.mlpackage` directories are tarballed (~253 MB each for NomicBERT
   embed, ~275 MB each for standard ModernBERT LI, ~31 MB each for the
   smaller edge ModernBERT LI variant, ~3.4 GB total) and hosted at
   [`mrsladoje/sweet-search-coreml-cascade`](https://huggingface.co/mrsladoje/sweet-search-coreml-cascade)
   under `embed/`, `li/`, and `li-edge/` subdirs.
   `sweet-search init --profile full` on M3+ Apple Silicon fetches each
   tarball via `core/infrastructure/coreml-cascade.js::fetchCoremlCascade()`
   using the same `model-fetcher.js::fetchModelFile` primitive as the other
   models (atomic writes, SHA256 verification, retries, resumable). Each
   tarball is checksum-verified against
   `core/infrastructure/coreml-cascade.json` and atomically extracted into
   `{modelCacheRoot}/coreml-cascade/{embed,li,li-edge}/`. Takes ~5 minutes
   on a typical home connection; zero Python dependency on the end-user
   machine.

   The `hfRepo` field in `coreml-cascade.json` is the single source of truth
   for the cascade's HF location — bump it there and re-run a cascade build
   to point at a different repo or mirror.

2. **Local build fallback (developer / air-gapped / shape retracing).**
   `scripts/build-coreml-cascade.js` wraps
   `scripts/spike-coreml/trace_cascade.py` to trace the full cascade from
   the already-fetched source safetensors (`nomic-ai/CodeRankEmbed`,
   `lightonai/LateOn-Code`, and `lightonai/LateOn-Code-edge`). Takes ~7
   minutes on M3 Max for the full 18 variants (~22 seconds for the 6
   edge variants alone — the edge backbone is much smaller). Requires
   Python 3.10+ with `torch`, `coremltools`, `safetensors`, `packaging`,
   `numpy`. The output `.mlpackage` dirs are written directly into the
   managed cache at `{modelCacheRoot}/coreml-cascade/{embed,li,li-edge}/`
   so the next `sweet-search` process loads them automatically via
   `native-inference.js::resolveCoremlCascadeForAddon()`.

   Invoke via `sweet-search init --build-coreml-cascade` (explicit opt-in,
   overrides the default HF fetch path) or directly via
   `node scripts/build-coreml-cascade.js`. Add `--li-edge-only` to retrace
   just the edge cascade (or `--embed-only` / `--li-only` for the others).
   Use cases: (a) developers making changes to the shape set and
   retracing locally before publishing; (b) air-gapped environments that
   can't reach huggingface.co; (c) new Apple chip generations where
   upstream retrace hasn't happened yet.

Either delivery path produces the same on-disk layout and the same runtime
behaviour — `native-inference.js` doesn't care how the cascade got there.

**Republishing workflow for maintainers.** When shapes change or new variants
are added, the release workflow is:

1. Update the variants list in `core/infrastructure/coreml-cascade.json`
   (the `embed`, `li`, and/or `liEdge` sections — only the touched
   family needs retracing)
2. Run `node scripts/build-coreml-cascade.js` on an M3+ Mac to retrace.
   Use `--embed-only`, `--li-only`, or `--li-edge-only` to scope the
   build to a single family (e.g. when only the edge cascade changed).
3. `tar -czf` each retraced variant and compute SHA256
4. Update the `tarballSha256` + `tarballSizeBytes` fields in the JSON
5. Upload the new tarballs to `hfRepo` via `huggingface_hub.upload_file`
   under the matching subdir (`embed/`, `li/`, or `li-edge/`)
6. Commit and publish the sweet-search package — end-user init now fetches
   the new cascade automatically

### Runtime wiring

`core/infrastructure/coreml-cascade.js` owns the state machine. Its public API
is imported through the `core/infrastructure/index.js` barrel:

```javascript
import {
  detectHardwareCapability,        // hardware gate
  getCoremlCascadeState,           // "what's present/missing"
  getCoremlCascadeResolvedDirs,    // "what dirs does the addon load?"
  getCoremlCascadeReport,          // "what does init log?"
} from './core/infrastructure/index.js';
```

`native-inference.js` calls `getCoremlCascadeResolvedDirs(liVariantKey)`
exactly once per process (at first addon load) — `liVariantKey` is read
from `LATE_INTERACTION_CONFIG.model` so the resolver returns the
matching `liDir` (`coreml-cascade/li/` for `lateon-code`,
`coreml-cascade/li-edge/` for `lateon-code-edge`). The resolved
`embedDir` / `liDir` are passed to `NativeEmbeddingModel.load` and
`NativeLateInteractionModel.load`, and a single diagnostic line records
the decision. The Rust constructors run a startup parity check against
the smallest variant before admitting dispatch; parity failure drops
the CoreML backend and the addon runs candle-only. The Rust LI parser
recognises both `li_modernbert_b…` and `li_modernbert_edge_b…`
filenames and refuses any variant whose implied `token_dim` doesn't
match the active model's final projection dim.

There is **no env-var bypass**. The old spike flags
(`SWEET_SEARCH_COREML_EMBED_MLPACKAGE_DIR`,
`SWEET_SEARCH_COREML_LI_MLPACKAGE_DIR`,
`SWEET_SEARCH_INFERENCE_BACKEND=coreml`) have been removed. Configuration
flows through `coreml-cascade.js` so init, uninstall, and the addon see the
same source of truth. Only one diagnostic env var remains:
`SWEET_SEARCH_COREML_CASCADE=0` force-disables the cascade for benchmarking.

`SWEET_SEARCH_COREML_STATS=1` dumps a per-variant dispatch report on addon
shutdown:

```
[CoremlEmbedding] dispatch stats (6 variants, 18421 dispatched, 12 fell through)
  b1×s2048     3 dispatches   [compiled]
  b4×s1024    92 dispatches   [compiled]
  b16×s512  1205 dispatches   [compiled]
  b32×s384  3718 dispatches   [compiled]
  b64×s192  4582 dispatches   [compiled]
  b64×s96   8821 dispatches   [compiled]
```

The report answers the question the 18% headline number alone can't: which
variants pulled their weight, and which never fired. A variant with zero
dispatches over a full index run is dead weight and should be cut from the
cascade JSON.

### Uninstall

`scripts/uninstall.js` detects the cascade cache dir via
`getCoremlCascadeRoot()` and adds it to the removal list, gated by
`--keep-models`. The removal is a single `rm -rf` of the root, which also
takes out the `.mlmodelc` compiled siblings next to each `.mlpackage`.

---

## CUDA Backend (Linux + NVIDIA)

The CUDA path is a candle backend toggle — fundamentally simpler than the
CoreML variant cascade. Candle JITs CUDA kernels via cudarc + candle-kernels,
so there is no pre-traced `.mlpackage` equivalent to fetch, no variant JSON,
no HuggingFace tarballs. Installation is an npm optional-dependency decision;
runtime selection is a `nvidia-smi` probe + an addon-side `Device::new_cuda(0)`
check.

### Packaging

CUDA support ships as SEPARATE platform packages alongside the standard
CPU-only Linux variants:

| Package | Target | Built with |
|---------|--------|-----------|
| `@sweet-search/native-linux-x64-gnu` | Linux x86-64 glibc | CPU only |
| `@sweet-search/native-linux-x64-gnu-cuda` | Linux x86-64 glibc + CUDA | `cuda,flash-attn` |
| `@sweet-search/native-linux-arm64-gnu` | Linux arm64 glibc | CPU only |
| `@sweet-search/native-linux-arm64-gnu-cuda` | Linux arm64 glibc + CUDA (Jetson Orin, Grace Hopper) | `cuda,flash-attn` |

The `accelerate` Cargo feature seen in the macOS `build:native` script is APPLE-ONLY
(`accelerate-src` links against Apple's Accelerate.framework) and is NOT used on any
Linux build, CUDA or otherwise.

Why separate rather than a single auto-fallback binary: candle 0.10 uses
`cudarc` with dynamic-linking by default. A binary built with the `cuda`
feature fails at load time if `libcuda.so` is missing — it is NOT a
graceful CPU fallback. Shipping CUDA support in the main Linux package
would break every Linux install without an NVIDIA driver. Separate
packages give the user explicit opt-in with a clear failure mode.

`core/infrastructure/native-resolver.js` prefers the `-cuda` variant on
Linux hosts when resolvable. If `libcuda.so` is absent at runtime, the
addon load will fail; `hardware-capability.js` surfaces this as
`cudaAddonEnabled: true, cudaAvailable: false` with a message pointing
the user at the standard CPU-only package.

### Build + publish pipeline

The CUDA-enabled addon and CLI are pre-built and shipped to npm via two
parallel workflows:

- `.github/workflows/publish-native-linux-x64-gnu-cuda.yml` — runs on
  GitHub-hosted `ubuntu-latest` (x86-64) inside
  `nvidia/cuda:12.2.2-devel-ubuntu22.04`. Builds for
  `x86_64-unknown-linux-gnu` with `CUDA_COMPUTE_CAP=80` (Ampere A100,
  A10, RTX 3090/4090, L4; SM 8.6/8.9/9.0 forward-compatible).
- `.github/workflows/publish-native-linux-arm64-gnu-cuda.yml` — runs on
  GitHub-hosted `ubuntu-22.04-arm` (GA January 2025) inside the same
  multi-arch CUDA image. Builds for `aarch64-unknown-linux-gnu` with
  `CUDA_COMPUTE_CAP=87` (Jetson Orin baseline, Grace Hopper SM 9.0
  forward-compatible). No QEMU — native arm64 toolchain on native
  arm64 runner.

Both containers supply the CUDA 12.2 toolkit (`nvcc`, `libcudart`,
headers) required by candle-flash-attn. Outputs per workflow:

- `sweet-search-native.node` — built with `--features cuda,flash-attn`
  for the target triple
- `sweet-search` — the standard Rust CLI (no CUDA features required;
  CUDA lives in the napi addon, not the CLI)

Each workflow stages its outputs into `packages/native-linux-<arch>-gnu-cuda/`
alongside the package's `manifest.json` and `README.md`. On tag push `v*`
both workflows publish their assembled directories as
`@sweet-search/native-linux-x64-gnu-cuda` and
`@sweet-search/native-linux-arm64-gnu-cuda` respectively with
`npm publish --provenance --access public` — the same publish path used
for the plain CPU variants. No HuggingFace channel is involved:
candle-cuda JITs kernels at runtime, so unlike CoreML there are no
per-shape pre-traced artifacts to host outside npm.

Both workflows cap nvcc memory pressure with `CARGO_BUILD_JOBS=2` and a
single-SM `CUDA_COMPUTE_CAP` target. Without these, flash-attn kernel
compilation OOMs the standard 7 GB GitHub-hosted runner.

End-user install flow is the standard npm one, driven by
`optionalDependencies` in the main `sweet-search` package:

```bash
npm install sweet-search   # npm auto-selects -cuda on Linux x64 or arm64 glibc
npx sweet-search init      # hardware-capability detects GPU, arms candle-cuda
```

No symlinks, no local rebuild. No postinstall hook: runtime detection in
`hardware-capability.js` is the single source of truth for "is CUDA
armed?" — the addon either loads and passes its `Device::new_cuda(0)`
probe (CUDA armed) or fails to load, and the resolver transparently
falls back to the matching `@sweet-search/native-linux-<arch>-gnu` CPU
variant. The init report line and
`.sweet-search/config.json::runtime.hardware` both record the decision.

**Parity check — manual, not CI-enforced.** GitHub-hosted runners have
no NVIDIA GPU (x64 or arm64), so both CUDA workflows build and package
but cannot execute the addon. Before pushing a `v*` tag, the maintainer
must, **for each CUDA variant they intend to ship**:

1. Trigger the workflow via `workflow_dispatch` with `skip_publish=true`
   and confirm it builds end-to-end (flash-attn kernel compilation is
   the step most likely to regress on toolchain updates).
2. Download the built artifact to a real NVIDIA host of the matching
   architecture (x86-64 + Ampere/Ada/Hopper for x64; Jetson Orin or
   Grace for arm64) and run `node scripts/parity-cuda.js`; confirm
   exit code 0.
3. Only then push the `v*` tag.

This is a social contract, not a technical gate — there is no CI step
that blocks publishing if parity is skipped. A self-hosted GPU runner
(e.g., an L4 spot instance) remains the stronger long-term fix.

`@sweet-search/native-linux-arm64-gnu-cuda` ships via a parallel workflow
(`.github/workflows/publish-native-linux-arm64-gnu-cuda.yml`) that mirrors
the x64-cuda pipeline on GitHub's native `ubuntu-22.04-arm` runner
(GA January 2025). No QEMU is involved — nvcc cross-compilation of
flash-attn kernels under QEMU is prohibitively slow and was explicitly
avoided. The arm64 build targets `CUDA_COMPUTE_CAP=87` (Jetson Orin
baseline, Grace Hopper SM 9.0 forward-compatible); SM 7.x hosts run the
naive attention path at runtime. Private-repo note:
`ubuntu-22.04-arm` is paid for private repositories — if billing is a
concern, swap the runner for a self-hosted arm64 host in the workflow's
`runs-on:` field.

### Hardware gating

`core/infrastructure/hardware-capability.js::detectHardwareCapability()`
combines two signals:

1. **`nvidia-smi` probe** (authoritative for "what GPU is installed"): runs
   `nvidia-smi --query-gpu=name,compute_cap,memory.total,driver_version --format=csv,noheader,nounits`
   with a 2-second timeout. Output is parsed by `parseNvidiaSmiOutput()`.
2. **Addon probe** (authoritative for "is CUDA usable end-to-end"): calls
   the Rust NAPI export `native_cuda_available()` which returns:
   - `Some(true)` — built with `cuda` feature AND `Device::new_cuda(0)` succeeds
   - `Some(false)` — built with `cuda` but device init failed (driver issue)
   - `null` — addon is the CPU-only variant, no `cuda` feature compiled in

CUDA is marked available iff:

- `platform === 'linux'`
- `nvidia-smi` returns a valid GPU row
- Compute capability ≥ 7.0 (`MIN_CUDA_COMPUTE_CAPABILITY`)
- Addon probe returns `Some(true)`
- `SWEET_SEARCH_CUDA` is not set to `0` / `false` / `off`

Rationale for SM 7.0 floor: SM 6.x Pascal has no tensor cores; candle's
matmul on CUDA cores runs slower than modern CPU BLAS at our batch/seq
shapes. SM 7.0 (Volta) has first-gen tensor cores with F16 matmul
(F32 accumulate). SM 7.5 (Turing) adds cleaner F16 tensor cores. SM 8.0+
(Ampere/Ada/Hopper) adds BF16.

### Per-model CUDA dtype policy

Implemented in `crates/sweet-search-native/src/inference/mod.rs::optimal_dtype`.

**Current default: model-specific.**

| Model | CUDA SM | Default dtype | Rationale |
|---|---:|---|---|
| NomicBERT embedding | ≥ 8.0 | **BF16** | Verified pooled-output parity is retrieval-safe on RTX 4090 while enabling Tensor Core / memory-bandwidth speedups. |
| NomicBERT embedding | < 8.0 or unknown | **F32** | No BF16 tensor cores, and older F16 paths are not quality-gated. |
| ModernBERT late interaction | all | **F32** | BF16 valid-token parity is not retrieval-safe for per-token MaxSim vectors (min ≈ 0.70, mean ≈ 0.974 on RTX 4090), even after flash-attn and mask fixes. |

This is intentionally not a single process-wide CUDA dtype. Embedding outputs
are mean-pooled and tolerate BF16 storage noise; LI outputs are per-token
vectors used directly by MaxSim, so the same BF16 drift changes the vector
geometry enough to fail retrieval quality gates.

`SWEET_SEARCH_NATIVE_DTYPE=f32` forces global F32 reference precision.
`SWEET_SEARCH_NATIVE_DTYPE=bf16|f16` is a safe preference: CUDA embeddings use
the requested fast dtype where available, while LI remains F32. For diagnostic
experiments only, `SWEET_SEARCH_NATIVE_LI_DTYPE=bf16|f16|f32` and
`SWEET_SEARCH_NATIVE_EMBED_DTYPE=bf16|f16|f32` force a per-model dtype.

Recovering BF16 cleanly was the v2.4 work item. **Status:**

- ✅ **Embedding model (NomicBERT, 12 layers)**: flash-attn varlen path
  wired in `crates/sweet-search-native/src/inference/varlen.rs` and
  activated in `nomic_bert_sdpa.rs::forward`. Pure-padding mask, no
  sliding-window — calls `flash_attn_padded(.., window_size=None)`.
- ✅ **LI model (ModernBERT, 22 layers)**: same flash-attn path,
  activated in `modernbert_sdpa.rs::forward`. Sliding-window applied via
  the kernel's `window_size_left/_right` arguments (routed through
  `candle_flash_attn::flash_attn_varlen_windowed`), NOT via the additive
  `combined_attention_mask`. `ModernBertAttention` stores
  `local_window: Option<usize> = config.local_attention / 2` for local
  layers, `None` for global ones. The layer always passes BOTH masks to
  attention; attention picks based on which kernel runs (flash-attn uses
  the global mask + window arg; naive uses the combined mask with window
  baked into bias).

Common gate for both paths:
`cfg(feature = "flash-attn") && Device::Cuda(_) && SM ≥ 8.0 && dtype ∈ {F16, BF16} && seq_len > 8`.
Inputs are packed around `cu_seqlens` (mask sentinel `< -100` = padding);
the fused kernel runs; output is unpacked back to `(B, H, S, D)`.
Online-softmax keeps F32 accumulators internally, but the final verified
numbers showed LI drift matches the pure-BF16 baseline almost exactly. The
remaining LI error is therefore BF16 storage/linear/residual drift across 22
ModernBERT layers, not a flash-attn kernel or packing bug. The shipped policy
captures the practical result: BF16 by default where validated (embeddings),
F32 where required for quality (LI).

The Metal F16 MRR regression (82%→64%, April 2026) is unrelated to CUDA
work — different kernels, different accumulators — but the same parity
gate below is enforced.

### Parity gate

Before shipping any CUDA build, run:

```bash
node scripts/parity-cuda.js
```

on the target GPU. It encodes a fixed corpus on CUDA and CPU, computes
per-pair cosine similarity, and asserts min ≥ 0.999 / mean ≥ 0.9998 for
both embedding and per-token LI output. Exit codes:

- `0` — parity passed, ship-ready
- `1` — parity failed, do not ship
- `2` — CUDA not available on this host, skipped

### Runtime wiring

`core/infrastructure/native-inference.js` handles the CUDA device-kind
plumbing:

- `loadNativeEmbeddingModelWithDevice('cuda')` and
  `loadNativeLiModelWithDevice('cuda')` skip cascade resolution (CUDA has
  no cascade), propagate `SWEET_SEARCH_CUDA_COMPUTE_CAP` to the addon env,
  and pass `'cuda'` through to `NativeEmbeddingModel.loadWithDevice` /
  `NativeLateInteractionModel.loadWithDevice`.
- `core/indexing/model-pool.js::initIndexGpuPool()` picks `deviceKind='cuda'`
  when `hw.inferenceBackendPreference === 'candle-cuda'`.
- No env-var bypass at the Rust boundary — all configuration flows through
  JS infrastructure, mirroring the CoreML routing contract.

Concurrency: candle's CUDA backend is thread-safe for forward passes (unlike
Metal). A process-wide `cuda_lock()` guards ONLY weight loading in
`embedding_model.rs::load_on_device` and `li_model.rs::load_on_device`,
since candle 0.10 has a known H2D-copy race during concurrent
`VarBuilder::from_mmaped_safetensors` calls. `forward()` runs lock-free.

### Uninstall

No changes required. CUDA has no managed cache (unlike the CoreML cascade).
Removing the `-cuda` package via `npm uninstall` cleans up the native
binary; `scripts/uninstall.js` is a no-op for CUDA.

### Opt-outs

- `--skip-cuda` on `sweet-search init` — translates to
  `SWEET_SEARCH_CUDA=0` for the current process
- `SWEET_SEARCH_CUDA=0` env var — force-disables CUDA detection; indexing
  falls back to the optimized ORT INT8 CPU path (`inferenceBackendPreference`
  becomes `ort-cpu`; candle/native is never armed and the FP32 backbones are
  skipped at init)
- `SWEET_SEARCH_NATIVE_INFERENCE=0` env var — force-disables native inference
  entirely; init treats the host as non-accelerated for FP32 fetch gating, so
  indexing stays on ORT INT8 CPU even if Metal/CUDA hardware is present
- `SWEET_SEARCH_NATIVE_DEVICE=cpu` — forces the Rust addon to return CPU
  from `select_device()` regardless of hardware

### Config persistence

`.sweet-search/config.json` records CUDA state under `runtime.hardware`:

```json
{
  "runtime": {
    "hardware": {
      "platform": "linux",
      "arch": "x64",
      "nvidiaGpu": {
        "name": "NVIDIA GeForce RTX 3090",
        "computeCapability": "8.6",
        "computeCapabilityFloat": 8.6,
        "memoryMB": 24576,
        "driverVersion": "535.129.03"
      },
      "cudaAddonEnabled": true,
      "cudaAvailable": true,
      "cudaReason": "NVIDIA GeForce RTX 3090 (compute 8.6, 24576 MB, driver 535.129.03) — suitable for candle-cuda",
      "candleGpuBackend": "cuda",
      "inferenceBackendPreference": "candle-cuda"
    }
  }
}
```

---

## Init Command Behavior

`scripts/init.js` is idempotent. Re-running is always safe.

1. Check Node.js version (fails fast below 18.0.0).
2. Detect project root (walk up from cwd to find `.git` or `package.json`).
3. Create `.sweet-search/` directory.
4. Resolve profile from `--profile` flag or default.
5. Verify all universal assets (WASM, router) are present in the package.
6. Resolve native package for current platform; log notice if absent (not error).
7. For `full`: fetch missing model artifacts via `core/infrastructure/model-fetcher.js`.
   - 3 retry attempts with exponential backoff from 1s.
   - Written to `.tmp` file first; atomically renamed on success.
   - SHA256 verified against `core/infrastructure/model-registry.js` for every LFS file.
   - Resumable (sends `Range` header for partial content).
8. Resolve hardware capability + CoreML cascade state (`full` profile only).
   - `detectHardwareCapability()` classifies chip generation.
   - `getCoremlCascadeReport()` inspects the managed cache dir.
   - On M3+ with `--build-coreml-cascade`, runs `scripts/build-coreml-cascade.js`
     as a child process; on failure, logs the error and continues with candle only.
   - Never blocks init: ineligible hardware, missing cache, and build failure all
     collapse to "cascade disabled, candle path unchanged".
8.5. Inspect **near-duplicate dedup readiness**. `inspectDedupReadiness()`
   checks whether the native dedup NAPI surface (`dedup_fingerprint_batch`,
   `dedup_cluster`) is callable. `--verify-deep` additionally runs a
   fingerprint-determinism smoke test on 3 in-process fixtures to assert
   cross-platform bit-equality. Never blocks init: if the addon is missing
   or disabled, every chunk becomes its own exemplar at index time and the
   pipeline proceeds without any dedup work.
9. Write `.sweet-search/config.json` including `runtime.hardware`,
   `runtime.coremlCascade`, and `runtime.dedup` diagnostics.
10. Run runtime verification.
11. Install index-maintainer daemon to `.claude/hooks/`.
12. Print concise report.

```
Sweet Search init complete

  Profile:              full
  Hardware:             Apple M3 Max (darwin-arm64)
  MaxSim:               native
  Router:               wasm
  lateon code: cached
  lateon code edge: cached
  ...
  CoreML cascade:       present (12 variants ready (6 embed + 6 LI))
  Dedup:                ready (MinHash-LSH (k=128, 16 bands, τ=0.7) + SimHash (Hamming ≤ 3) + LI reuse (τ≥0.95))
  Runtime downloads:    disabled
  Verification:         fast-pass (23/23)
```

Flags: `--profile <core|full>`, `--verify-deep`, `--force`, `--verbose`,
`--build-coreml-cascade`, `--skip-coreml-cascade`, `--skip-dedup`,
`--skip-cuda`.

### Near-Duplicate Dedup (SimHash + MinHash-LSH)

Dedup is a **pure-compute feature** — no model artifacts, no runtime downloads.
The NAPI addon built as part of `@sweet-search/native-<platform>` exposes
`dedup_fingerprint_batch` and `dedup_cluster`; init only inspects readiness.

Two tiers:
- **Bi-encoder reuse** at Jaccard ≥ 0.7 (16 × 8 LSH bands + SimHash Hamming ≤ 3
  secondary filter) — aliases skip the local embedding model; their row in
  `vectors` gets a COPY of the exemplar's Float32 BLOB.
- **LI per-token matrix reuse** at Jaccard ≥ 0.95 — only near-exact duplicates
  borrow the exemplar's per-token matrix via an alias sidecar JSON next to
  the SSLX binary. Aliases between 0.7 and 0.95 Jaccard still skip bi-encoder
  but ARE encoded by the LI model.

Config surface (`SWEET_SEARCH_DEDUP_*` env vars via
`core/infrastructure/config/dedup.js`):
- `SWEET_SEARCH_DEDUP_ENABLED` (default `1`)
- `SWEET_SEARCH_DEDUP_LI_REUSE` (default `1`)
- `SWEET_SEARCH_DEDUP_JACCARD` (default `0.7`)
- `SWEET_SEARCH_DEDUP_LI_JACCARD` (default `0.95`)
- `SWEET_SEARCH_DEDUP_NGRAM` (default `5`), `NUM_PERM` (`128`), `BANDS` (`16`),
  `SIMHASH_H` (`3`), `SEED` (`42`)

Init does NOT download or install anything for dedup. If the native addon is
unavailable on the current platform, `isDedupAvailable()` returns false and
`runDedupPhase()` collapses to a no-op — every chunk stays its own exemplar
and the indexing pipeline runs unchanged. Orphan alias cleanup runs at
`insertAliasVectors()` time for incremental re-index safety.

---

## CLI Dispatch

`core/cli.js` is the npm `bin` entry point. It is a Node.js wrapper.

1. `init` and `uninstall` subcommands always run in JS.
2. All other subcommands attempt to resolve the native Rust binary via
   `core/infrastructure/native-resolver.js`.
3. If found: `spawnSync(nativeBin, args, { stdio: 'inherit' })` with explicit exit code
   forwarding.
4. If not found: falls through to `core/search/index.js` JS implementation.

The user-facing command is always `sweet-search`. `sweet-search-mcp` (`mcp/server.js`) is
a separate JS-only entrypoint.

### Cold-start fix (Phase 6a)

Three root causes were found and fixed:

1. Missing `await` in `core/search/search-cli.js` caused fire-and-forget `startServer()`;
   Node exited with code 13.
2. Circular import (`sweet-search.js` -> `search-cli.js` -> `sweet-search.js`). Fixed by
   adding `core/start-server.js` as a minimal entry point importing `search-server.js`.
3. macOS code signing: copying a Mach-O binary invalidates the ad-hoc signature. Darwin CI
   workflows now run `codesign -s -` after binary copy.

`SWEET_SEARCH_SOCKET_PATH` env var added to both Rust CLI and Node server for test isolation.

---

## Runtime Resolution Order

### MaxSim

1. Native addon from `@sweet-search/native-<platform>`
2. `core/infrastructure/maxsim.wasm` (WASM SIMD)
3. JS fallback in `core/ranking/late-interaction-index.js`

### Query router

1. WASM bundle: `crates/wasm-router/pkg/`
2. CatBoost JS fallback: `core/training/query-router/output/v46_router_d4.js` (runtime import in
   `query-router-catboost.js`; `core/infrastructure/manifest.json` references v45 as `catboostRouter`)

### CLI binary

1. Native Rust from `@sweet-search/native-<platform>`
2. JS implementation via `core/search/index.js`

### Model artifacts

1. Init-managed local cache (checksum-verified)
2. Configured `modelCacheRoot` override (enterprise mirrors)
3. Remote fetch only when `allowRuntimeModelDownload = true` (default: `false` for `full`)

### Native embedding / LI inference

1. **CoreML variant cascade (M3+ Apple Silicon only)**: if
   `getCoremlCascadeResolvedDirs()` returns non-null dirs, the Rust addon
   loads the cascade and dispatches batches whose shape fits any variant
   through Apple's Neural Engine. Parity check against candle at startup
   gates admission. See the CoreML cascade section above for full detail.
2. **Candle Metal (Apple Silicon)**: always-loaded backbone. Handles every
   batch the cascade doesn't fit, and runs as the full path on non-M3
   hardware where the cascade is ineligible.
3. **Candle CUDA (Linux + NVIDIA, SM 7.0+)**: Ampere BF16 / Turing F16 /
   Volta F32 via candle-cuda with optional fused SDPA on Ampere+
   (flash-attn). Requires the `-cuda` native package AND libcuda.so
   present at load time. See the CUDA Backend section above.
4. **Candle CPU (Linux / darwin-x64 / Linux without NVIDIA)**: Accelerate
   BLAS on macOS, stock CPU kernels elsewhere. Baseline path for any
   platform without a GPU acceleration backend.

---

## Model Delivery

Managed by `core/infrastructure/model-fetcher.js` with metadata in
`core/infrastructure/model-registry.js`.

SHA256 checksums are stored for all LFS files. Small non-LFS files (tokenizer.json,
config.json) are verified by size. Run `scripts/verify-model-registry.js` to regenerate or
verify checksums against the HuggingFace API.

### Config flags

| Flag | Default | Description |
|------|---------|-------------|
| `allowRuntimeModelDownload` | `false` (full) | Gate on runtime HTTP fetch |
| `modelCacheRoot` | OS cache dir | Root for managed model cache |
| `hfEndpoint` | HuggingFace CDN | Overrideable for enterprise mirrors |

---

## Uninstall

`sweet-search uninstall` (`scripts/uninstall.js`) reverses everything `sweet-search init`
created.

- Removes `.sweet-search/` config directory
- Removes init-managed model cache contents (reports size before deletion)
- Removes the CoreML variant cascade cache at
  `{modelCacheRoot}/coreml-cascade/` including the sibling `.mlmodelc`
  compiled caches (also gated by `--keep-models`)
- Idempotent: second run reports "nothing to remove"
- Works even when runtime is partially broken (graceful degradation)

Flags: `--dry-run`, `--keep-models`, `--purge` (also npm uninstall), `--force` (skip
confirmation).

Constraints: never touches files outside `.sweet-search/`, the managed model cache
(including the CoreML cascade subtree), and (with `--purge`) `node_modules`. Never
deletes user source code, indexes, or databases.

---

## Published File Layout

### Main package

```
sweet-search/
  core/
    infrastructure/
      maxsim.wasm
      simd-distance.wasm
      model-registry.js
      model-fetcher.js
      native-resolver.js
      config/
    ranking/
    embedding/
    search/
    indexing/
    graph/
    vocabulary/
    vector-store/
    query/
    config.js                   # Compatibility facade
    start-server.js             # Rust CLI entry point
  cli.js                        # npm bin dispatcher
  mcp/server.js                 # MCP server
  translation/
  crates/wasm-router/pkg/
  core/training/query-router/output/v45_router_d4.js
  core/training/query-router/output/v46_router_d4.js
  core/training/query-router/features/
  core/infrastructure/manifest.json
  scripts/init.js
  scripts/uninstall.js
```

### Platform package

```
@sweet-search/native-<platform>/
  package.json
  manifest.json
  sweet-search-native.<platform>.node
  sweet-search
```

The CUDA-enabled variants carry one additional user-facing file and ship
for both Linux architectures:

```
@sweet-search/native-linux-x64-gnu-cuda/     (x86-64 + NVIDIA, SM 7.0+)
@sweet-search/native-linux-arm64-gnu-cuda/   (arm64 + NVIDIA — Jetson Orin, Grace Hopper)
  package.json
  manifest.json
  sweet-search-native.node  (built with --features cuda,flash-attn)
  sweet-search
  README.md                 (user-facing install + troubleshooting)
```

Identical schema to the CPU variants — the only on-disk differences are
the `-cuda` suffix in `package.json::name`, the Cargo feature set baked
into the `.node` binary, and the presence of `README.md`.

### Generated local state

```
.sweet-search/config.json
~/.cache/sweet-search/models/<normalized-hf-id>/
~/.cache/sweet-search/models/coreml-cascade/     (M3+ Apple Silicon with cascade built)
  embed/
    nomic_bert_b{B}_s{S}_fp16.mlpackage/           (6 variants)
    nomic_bert_b{B}_s{S}_fp16.mlpackage.mlmodelc/  (compiled sibling cache)
  li/
    li_modernbert_b{B}_s{S}_fp16.mlpackage/        (6 variants)
    li_modernbert_b{B}_s{S}_fp16.mlpackage.mlmodelc/
```

---

## Profiling Data (M3 Max, ~17K files indexed)

Warm-query latency (p50 = 28ms):

| Component | p50 | % |
|-----------|-----|---|
| Embedding (ORT, L7 direct) | 5.7ms | 20.4% |
| LI inference (ORT) | 3.5ms | 12.6% |
| HNSW binary search | 2.6ms | 9.4% |
| HNSW int8 rescore | 0.2ms | 0.7% |
| LI tokenization (JS) | 0.105ms | 0.4% |
| SIMD distance (WASM) | <0.01ms | <0.1% |

CLI dispatch: native warm 2.9ms, native cold 108ms, JS fallback 64.7ms.

Conclusion: top three warm-query components are already native (ORT, usearch). JS
tokenization is 0.4% of total. No warm-query hot path justifies new napi-rs acceleration.
Native tokenization for indexing throughput deferred to Phase 7.

These measurements were taken during Phase 6a on real hardware and are not stored as
artifacts in the codebase. The profiling harness can reproduce them.

---

## Cross-Target Validation (2026-03-31)

All four launch targets passed 27/27 checks:

| Target | Method |
|--------|--------|
| darwin-arm64 | Real hardware (M3 Max) |
| darwin-x64 | Rosetta; x64 Node v20.20.2 |
| linux-x64-gnu | Docker node:20-slim Debian bookworm amd64 |
| linux-arm64-gnu | Docker node:20-slim Debian bookworm arm64 |

WSL equivalence: Docker Debian bookworm matches WSL2 Ubuntu/Debian runtime (same kernel,
glibc 2.36, same Node binary).

Package managers: npm, pnpm, bun validated. Yarn v1 excluded (treats optionalDependencies
as mandatory). Yarn berry v4+ works correctly.

Rust-vs-C launcher (Linux arm64, 30 runs): Rust p50=425us, C p50=338us. Both sub-ms.

---

## Release Automation

Three workflows run on each tag push (`v*`):

1. `.github/workflows/release.yml` — builds and publishes the main
   `sweet-search` package and the four CPU-only native packages
   (`@sweet-search/native-{darwin-arm64,darwin-x64,linux-x64-gnu,linux-arm64-gnu}`).
2. `.github/workflows/publish-native-linux-x64-gnu-cuda.yml` — builds and
   publishes `@sweet-search/native-linux-x64-gnu-cuda` from the
   `nvidia/cuda:12.2.2-devel-ubuntu22.04` container on `ubuntu-latest`.
3. `.github/workflows/publish-native-linux-arm64-gnu-cuda.yml` — builds
   and publishes `@sweet-search/native-linux-arm64-gnu-cuda` from the
   same multi-arch container, running on the native `ubuntu-22.04-arm`
   runner (no QEMU).

Publish order inside the main workflow:

1. Build and test universal assets; verify `npm pack --dry-run`.
2. Publish platform-native packages for all four CPU targets.
3. Publish main `sweet-search` package.

Both CUDA workflows run in parallel with the main workflow. Each published
package is picked up by npm's `optionalDependencies` resolution on the
matching Linux + NVIDIA host (x64 or arm64), independent of the main
workflow's ordering.

CI verification: `npm test`, native/WASM parity, pack dry-run, install
smoke tests on macOS and Linux, runtime smoke tests (router, MaxSim tier,
model loads, MCP startup), provenance.

CUDA parity (`scripts/parity-cuda.js`) is a **manual release checklist
item**, not a CI-enforced gate. GitHub-hosted runners have no GPU, so
the CUDA workflow builds and packages but cannot exercise the addon
end-to-end. See the [Build + publish pipeline](#build--publish-pipeline)
section above for the maintainer's pre-tag checklist.

macOS binaries require `codesign -s -` after any copy step.

---

## Remaining Work

### Phase 7: Native end-to-end model execution — COMPLETED (2026-04-12)

`@huggingface/transformers` has been removed from all dependencies and is no longer
imported by any module in `core/`. Tokenization and model loading now use direct
`onnxruntime-node` sessions and the native tokenizer from the napi-rs addon.
Batch embedding + LI encoding run through candle on Metal BF16 with asynchronous
napi tasks. See `project_native_metal_inference_status` in project memory for the
2026-04-12 completion note — the 34-minute full-index baseline is the measured
candle Metal path described in that entry.

### Phase 8: CoreML variant cascade — COMPLETED (2026-04-14)

The CoreML cascade is a capability-aware acceleration layer on top of the
Phase 7 native path. Ships automatically via HuggingFace for end users on M3+
Apple Silicon; other hardware is filtered out before any download. See the
"CoreML Variant Cascade" section above for the full contract. Status summary:

- Shape set in `core/infrastructure/coreml-cascade.json` (single source of truth)
- JS resolver in `core/infrastructure/coreml-cascade.js` (barrel-exported through
  `core/infrastructure/index.js` and `core/embedding/index.js`)
- Hardware detection in `core/infrastructure/hardware-capability.js` (M3+ gate)
- Rust constructors accept `coreml_cascade_dir` through the normal `load()`
  factory argument — no env-var bypass
- `coreml_shim.m` uses content-hash invalidation (SHA256 of Manifest.json) and
  stage-and-rename atomic cache writes
- Per-variant dispatch counters + `SWEET_SEARCH_COREML_STATS=1` drop
- Init records state in `.sweet-search/config.json` under `runtime.coremlCascade`
- Uninstall cleans the cascade cache dir and sibling `.mlmodelc`s
- HF fetch path as the default: 12 variant tarballs hosted at
  `mrsladoje/sweet-search-coreml-cascade`, fetched by
  `fetchCoremlCascade()` via the same `fetchModelFile` primitive as the
  other models, verified against per-tarball SHA256 in
  `coreml-cascade.json`, extracted into the managed cache with
  stage-and-rename atomicity
- Local-build fallback via `scripts/build-coreml-cascade.js` preserved for
  developers, air-gapped environments, and shape-set retraces
- Unit tests: `tests/infrastructure/hardware-capability.test.js` (24 tests)
  and `tests/infrastructure/coreml-cascade.test.js` (25 tests) covering
  parsing, state inspection, malformed fixtures, env opt-out, and the full
  set of expected variant shapes

Exit criteria (all met):

- Running `sweet-search init --profile full` on a fresh M3+ machine installs
  the cascade via the HF download path with no Python dependency
- Cascade state in the init report is "present" after init completes
- `sweet-search uninstall` cleans the cascade cache dir alongside the regular
  model cache
- Non-eligible hardware (Intel Mac, Linux, M1/M2) never downloads the cascade
  because `getModelsForProfile`-equivalent capability gating filters the
  entries before fetch

### Phase 9: Test coverage gap closure (carried over from DDD_ARCHITECTURE.md)

See `docs/DDD_ARCHITECTURE.md` for the domain-level coverage gap. Cascade-side
test coverage was added in Phase 8; remaining work is the pre-existing gap in
the other infrastructure modules (notably `init-integration.test.js` which
does not yet cover the HF fetch path end-to-end — the roundtrip was verified
manually during the 2026-04-14 publish).
