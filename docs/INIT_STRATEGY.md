# Sweet Search Init and Packaging Strategy

**Last updated**: 2026-04-01
**Status**: All phases implemented except Phase 7 (native end-to-end model execution)

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
- a generated `.sweet-search/config.json`
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
`profile: 'full'`. Note: `assets/manifest.json` currently lists only the first 4 in its
`profiles.full.models` array; the FlashRank and semantic cache models are fetched via
the registry's `getModelsForProfile()` but are not yet in the manifest.

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
8. Write `.sweet-search/config.json`.
9. Run runtime verification.
10. Install index-maintainer daemon to `.claude/hooks/`.
11. Print concise report.

```
Sweet Search init complete

Profile: full
MaxSim: native
Router: wasm
Late interaction model: init-managed cache
Reranker model: init-managed cache
Runtime verification: fast-pass
```

Flags: `--profile <core|full>`, `--verify-deep`, `--force`, `--verbose`.

---

## CLI Dispatch

`bin/sweet-search.js` is the npm `bin` entry point. It is a Node.js wrapper.

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

1. WASM bundle: `wasm-router/pkg/`
2. CatBoost JS fallback: `training/output/v46_router_d4.js` (runtime import in
   `query-router-catboost.js`; `assets/manifest.json` references v45 as `catboostRouter`)

### CLI binary

1. Native Rust from `@sweet-search/native-<platform>`
2. JS implementation via `core/search/index.js`

### Model artifacts

1. Init-managed local cache (checksum-verified)
2. Configured `modelCacheRoot` override (enterprise mirrors)
3. Remote fetch only when `allowRuntimeModelDownload = true` (default: `false` for `full`)

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
- Idempotent: second run reports "nothing to remove"
- Works even when runtime is partially broken (graceful degradation)

Flags: `--dry-run`, `--keep-models`, `--purge` (also npm uninstall), `--force` (skip
confirmation).

Constraints: never touches files outside `.sweet-search/`, the managed model cache, and
(with `--purge`) `node_modules`. Never deletes user source code, indexes, or databases.

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
  bin/sweet-search.js           # npm bin dispatcher
  mcp/server.js                 # MCP server
  translation/
  wasm-router/pkg/
  training/output/v45_router_d4.js
  training/output/v46_router_d4.js
  training/features/
  assets/manifest.json
  scripts/init.js
  scripts/uninstall.js
```

### Platform package

```
@sweet-search/native-<platform>/
  package.json
  manifest.json
  maxsim.<platform>.node
  sweet-search
```

### Generated local state

```
.sweet-search/config.json
~/.cache/sweet-search/models/<normalized-hf-id>/
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

### Phase 7: Native end-to-end model execution

`@huggingface/transformers` has been removed from all dependencies and is no longer
imported by any module in `core/`. Tokenization and model loading now use direct
`onnxruntime-node` sessions and the native tokenizer from the napi-rs addon where
available.

What remains is completing the native pipeline consolidation:

- Move remaining JS tokenization and tensor preparation into native Rust code
  (napi-rs addon, same crate as MaxSim) for indexing throughput gains
- Add rayon-parallel batch embedding and chunk encoding in native code
- Buffer reuse and pipeline ownership in native code to reduce JS/native allocation churn
- Parity tests against existing JS/ORT behavior
- Throughput benchmarks (indexing, batch embedding) and single-query latency benchmarks

Exit criteria:

- All local model paths work end-to-end through native code
- Measured throughput gains for indexing/batch workloads
- No regression in warmed single-query latency
