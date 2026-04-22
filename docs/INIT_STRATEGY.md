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

Native packages are `optionalDependencies`. npm installs only the one matching the current
platform's `os`/`cpu`/`libc` fields. Other platforms fall back to WASM/JS.

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

| Model | HF ID | Size |
|-------|-------|------|
| Late interaction INT8 128d | `lightonai/LateOn-Code` | ~150MB |
| Late interaction FP32 48d | `lightonai/LateOn-Code-edge` | ~68MB |
| Local reranker INT8 | `Alibaba-NLP/gte-reranker-modernbert-base` | ~151MB |
| Local embedding INT8 768d | `mrsladoje/CodeRankEmbed-onnx-int8` | ~139MB |
| FlashRank cross-encoder | `Xenova/ms-marco-TinyBERT-L-2-v2` | ~4.3MB |
| Semantic cache embedding | `Xenova/all-MiniLM-L6-v2` | ~23MB |

All artifacts are verified with SHA256 checksums from
`core/infrastructure/model-registry.js`. The registry lists all 6 models with
`profile: 'full'`. Note: `core/infrastructure/manifest.json` currently lists only the first 4 in its
`profiles.full.models` array; the FlashRank and semantic cache models are fetched via
the registry's `getModelsForProfile()` but are not yet in the manifest.

---

## CoreML Variant Cascade (M3+ Apple Silicon)

The CoreML variant cascade is a hardware-gated acceleration layer that runs
alongside the candle Metal backbone on M3+ Apple Silicon. It delivers ~18%
faster full indexing on an M3 Max vs the candle BF16 baseline (measured
2026-04-14 against `sweet-search-private` at 16,347 docs).

### What it is

A set of 12 pre-traced CoreML `.mlpackage` directories — 6 NomicBERT embedding
variants and 6 ModernBERT LI variants — covering the shape stair-step produced
by the indexer's cache-aware bucketer. The Rust native addon picks the smallest
variant that fits each batch and dispatches it to Apple's Neural Engine through
a thin Obj-C shim. Anything that exceeds the largest variant falls through to
candle — the cascade never replaces candle; it short-circuits it when profitable.

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
  embed/
    nomic_bert_b64_s96_fp16.mlpackage/           ← 6 variant dirs
    nomic_bert_b64_s96_fp16.mlpackage.mlmodelc/  ← compiled cache sibling
    nomic_bert_b64_s192_fp16.mlpackage/
    nomic_bert_b64_s192_fp16.mlpackage.mlmodelc/
    ...
  li/
    li_modernbert_b128_s48_fp16.mlpackage/       ← 6 variant dirs
    li_modernbert_b128_s48_fp16.mlpackage.mlmodelc/
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

1. **HuggingFace fetch (default, shipped).** The 12 pre-traced `.mlpackage`
   directories are tarballed (~253 MB each for NomicBERT embed, ~275 MB each
   for ModernBERT LI, ~3.2 GB total) and hosted at
   [`mrsladoje/sweet-search-coreml-cascade`](https://huggingface.co/mrsladoje/sweet-search-coreml-cascade).
   `sweet-search init --profile full` on M3+ Apple Silicon fetches each
   tarball via `core/infrastructure/coreml-cascade.js::fetchCoremlCascade()`
   using the same `model-fetcher.js::fetchModelFile` primitive as the other
   models (atomic writes, SHA256 verification, retries, resumable). Each
   tarball is checksum-verified against
   `core/infrastructure/coreml-cascade.json` and atomically extracted into
   `{modelCacheRoot}/coreml-cascade/{embed,li}/`. Takes ~5 minutes on a
   typical home connection; zero Python dependency on the end-user machine.

   The `hfRepo` field in `coreml-cascade.json` is the single source of truth
   for the cascade's HF location — bump it there and re-run a cascade build
   to point at a different repo or mirror.

2. **Local build fallback (developer / air-gapped / shape retracing).**
   `scripts/build-coreml-cascade.js` wraps
   `scripts/spike-coreml/trace_cascade.py` to trace the full cascade from the
   already-fetched source safetensors (`nomic-ai/CodeRankEmbed` and
   `lightonai/LateOn-Code`). Takes ~7 minutes on M3 Max. Requires Python 3.10+
   with `torch`, `coremltools`, `safetensors`, `packaging`, `numpy`. The output
   `.mlpackage` dirs are written directly into the managed cache at
   `{modelCacheRoot}/coreml-cascade/{embed,li}/` so the next `sweet-search`
   process loads them automatically via
   `native-inference.js::resolveCoremlCascadeForAddon()`.

   Invoke via `sweet-search init --build-coreml-cascade` (explicit opt-in,
   overrides the default HF fetch path) or directly via
   `node scripts/build-coreml-cascade.js`. Use cases: (a) developers making
   changes to the shape set and retracing locally before publishing; (b)
   air-gapped environments that can't reach huggingface.co; (c) new Apple
   chip generations where upstream retrace hasn't happened yet.

Either delivery path produces the same on-disk layout and the same runtime
behaviour — `native-inference.js` doesn't care how the cascade got there.

**Republishing workflow for maintainers.** When shapes change or new variants
are added, the release workflow is:

1. Update the variants list in `core/infrastructure/coreml-cascade.json`
2. Run `node scripts/build-coreml-cascade.js` on an M3+ Mac to retrace
3. `tar -czf` each variant and compute SHA256
4. Update the `tarballSha256` + `tarballSizeBytes` fields in the JSON
5. Upload the new tarballs to `hfRepo` via `huggingface_hub.upload_file`
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

`native-inference.js` calls `getCoremlCascadeResolvedDirs()` exactly once per
process (at first addon load), passes the resolved `embedDir` / `liDir` as the
third / fourth arguments to `NativeEmbeddingModel.load` and
`NativeLateInteractionModel.load`, and logs a single diagnostic line recording
the decision. The Rust constructors run a startup parity check against the
smallest variant before admitting dispatch; parity failure drops the CoreML
backend and the addon runs candle-only.

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
`--build-coreml-cascade`, `--skip-coreml-cascade`, `--skip-dedup`.

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
3. **Candle CPU (Linux / darwin-x64)**: Accelerate BLAS on macOS, stock CPU
   kernels elsewhere. Currently the only native path outside Apple Silicon.

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

Publish order:

1. Build and test universal assets; verify `npm pack --dry-run`.
2. Publish platform-native packages for all four targets.
3. Publish main `sweet-search` package.

CI verification: `npm test`, native/WASM parity, pack dry-run, install smoke tests on
macOS and Linux, runtime smoke tests (router, MaxSim tier, model loads, MCP startup),
provenance.

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
