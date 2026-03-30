# Sweet Search NPM Init Plan

**Date:** 2026-03-24
**Status:** Proposed, with packaging mechanics validated and model-distribution details pending legal and size review
**Scope:** Make Sweet Search installable with a single npm-based init flow that brings down all required JS dependencies, shipped WASM assets, profile-selected model artifacts where redistribution is allowed, and platform-specific native binaries when available.

---

## Goal

Provide a one-command setup flow so a user can install and initialize Sweet Search without any manual artifact downloads for the selected install mode.

Target user experience:

```bash
npx sweet-search init
```

Secondary UX, only if later justified:

```bash
npm create sweet-search@latest
```

After the command completes, the user should have:

- the JS package installed
- all npm-managed third-party dependencies installed
- all required Sweet Search runtime assets present locally for the selected profile
- a working native binary path when a prebuilt package exists for the platform
- a working WASM fallback everywhere else
- a generated local config and a verified runtime

This plan intentionally separates two targets:

- `standard` install: normal npm dependency installation plus Sweet Search runtime assets and native optional packages
- `offline-bundle` install: a heavier mode intended for zero-runtime-download environments

This plan also assumes the public CLI name will be `sweet-search`, not `ss`, to avoid collision with the Linux `ss` utility.

---

## Problem Statement

Today Sweet Search has a mixed runtime model:

- normal npm JS dependencies from `package.json`
- first-party WASM assets in the repo
- native binaries that are platform-specific
- Hugging Face model artifacts that are downloaded lazily at runtime
- optional parser/runtime assets from third-party npm packages such as `tree-sitter-wasms`

That means `npm install` is not yet equivalent to "everything needed is ready locally".

To make init truly simple, Sweet Search needs to convert runtime downloads into npm-delivered artifacts where legally and operationally feasible, and it needs an explicit packaging strategy for native and heavy model assets.

There are also immediate shipping issues in the current package that this plan must treat as Phase 0 blockers, not as future cleanup:

- the public npm `bin` currently exposes `ss`, which collides with the Linux `ss` utility
- the shipped `./ss` artifact is currently a Linux x86-64 ELF binary, so the published CLI is dead on macOS
- the current late-interaction model downloader does not verify checksums, support resumable downloads, or defend against truncated cache writes
- `@huggingface/transformers` is currently a core runtime dependency in practice, but the packaging plan does not yet define how it is managed long-term

---

## Validation Level

This document mixes three kinds of statements:

### Confirmed by npm/runtime documentation

- `files` is the correct mechanism to control publish contents
- `optionalDependencies` is a valid mechanism for platform-native packages
- per-package `os`, `cpu`, and `libc` targeting is supported
- `bundleDependencies` can be used for a separate offline-style distribution

### Confirmed from the current Sweet Search codebase

- Sweet Search already ships some first-party WASM and generated router assets from the main package
- native and model assets are not yet fully npm-managed for a no-download runtime
- runtime currently mixes npm-installed dependencies with lazy downloads and local binary lookups
- the current package already declares `node >=18`, so the init/distribution design should preserve that floor
- the current published `bin` points to `ss`, and the current `./ss` artifact is a Linux x86-64 ELF binary rather than a portable Node CLI wrapper
- `@huggingface/transformers` is currently used by the late-interaction pipeline, local reranker, embedding pipeline, and Flashrank fallback paths
- the current Hugging Face downloader in `core/late-interaction-model.js` is a bare fetch-to-file implementation with no checksum or resumable-download protection

### Deliberate design choices, not yet proven

- making `full` the default profile
- distributing third-party model artifacts via npm instead of init-time managed download
- the exact package boundaries for model bundles and profile packages
- whether an offline bundle should be a separate package, a meta-package, or a tarball flow

Any item in the third category should be treated as a decision point, not as a pre-validated fact.

---

## Design Principles

1. Keep the default install path reliable.
2. Ship universal assets once, in the main package.
3. Ship native binaries per platform, not all platforms in one tarball.
4. Eliminate mandatory runtime HTTP downloads for the default init profile.
5. Preserve graceful fallback order: native -> WASM -> JS.
6. Make package contents verifiable with `npm pack --dry-run` in CI.
7. Separate "required for default runtime" from "optional/offline/advanced" assets.

---

## What "All Dependencies" Means

For this plan, "all dependencies" includes four categories:

1. JavaScript runtime dependencies
   These are normal npm `dependencies` and `optionalDependencies`.

2. First-party runtime assets
   These include:
   - `core/simd-distance.wasm`
   - `core/maxsim.wasm`
   - `wasm-router/pkg/*`
   - generated CatBoost router JS such as `training/output/v45_router_d4.js`

3. Platform-native runtime artifacts
   These include:
   - the N-API MaxSim addon `.node`
   - the native `sweet-search` binary

4. Third-party model artifacts currently fetched lazily
   These include:
   - Late Interaction ONNX + projection weights for `lightonai/LateOn-Code`
   - Late Interaction ONNX + projection weights for `lightonai/LateOn-Code-edge`
   - local reranker assets for `Alibaba-NLP/gte-reranker-modernbert-base`

If init is meant to be self-contained for a given profile, categories 1 through 4 must be satisfied by npm-delivered packages, locally cached artifacts, or an explicitly accepted runtime-download policy.

---

## Current Artifact Inventory

### Universal assets (shipped in main npm package)

- main JS sources under `core/`
- MCP server code under `mcp/`
- translation code under `translation/`
- JS CLI fallback dispatcher under `bin/sweet-search.js`
- CatBoost router export under `training/output/v45_router_d4.js`
- WASM router bundle under `wasm-router/pkg/`
- MaxSim WASM blobs under `core/*.wasm` (`maxsim.wasm` ~4KB, `simd-distance.wasm` ~1KB)
- standard npm dependencies such as `better-sqlite3`, `undici`, `tree-sitter-wasms`, `web-tree-sitter`

### Platform-specific (future `@sweet-search/native-*` optional packages)

- native MaxSim addon `.node` (`maxsim.{platform}-{arch}.node`, ~400KB per target, currently only darwin-arm64 built)
- Rust CLI launcher binary (`sweet-search`, ~350KB per target, built from `sweet-search-cli/`)
- targets: aarch64-apple-darwin, x86_64-apple-darwin, x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu

### Third-party model artifacts (init-managed download, Phase 3)

- `lightonai/LateOn-Code` ONNX + projection weights used by `core/late-interaction-model.js`
- `lightonai/LateOn-Code-edge` ONNX + projection weights used by `core/late-interaction-model.js`
- `Alibaba-NLP/gte-reranker-modernbert-base` INT8 ONNX used by `core/local-reranker.js`
- `jalipalo/CodeRankEmbed-onnx` / `mrsladoje/CodeRankEmbed-onnx-int8` used by `core/embedding-local-model.js`

### Transitional dependency (to be removed after migration)

- `@huggingface/transformers` (`optionalDependencies`, `^4.0.0-next.4`) — used for JS tokenization and model loading. Full replacement decided 2026-03-26; see `@huggingface/transformers` policy section.

### Standard npm dependencies (remain as-is)

- parser/runtime dependencies such as `tree-sitter-wasms`
- core JS libraries already in `package.json`

These should continue to come from npm rather than being re-vendored.

### Not published (development/build only)

- `ss` — Linux x86-64 ELF binary (removed from `files` in Phase 0a)
- `ss.sh` — bash launcher script (never in `files`)
- `ss-fast/` — C source for original launcher (reference only)
- `sweet-search-cli/` — Rust launcher source and build artifacts
- `native-maxsim/` — napi-rs addon source and build artifacts
- `wasm-maxsim/` — WASM MaxSim source and build artifacts
- `training/` (except explicitly listed output files)
- `eval/`, `evaluation/`, `__tests__/`, `tests/` — test infrastructure

---

## Recommended Package Topology

Use a multi-package publish strategy.

### 1. Main package: `sweet-search`

Responsibilities:

- ship all JS code
- ship all first-party universal assets
- provide the CLI entrypoints
- install standard JS runtime dependencies
- declare platform-native packages as `optionalDependencies`
- expose `init`
- verify runtime after install

Main package should include in `files`:

- `core/`
- `bin/`
- `mcp/`
- `translation/`
- `wasm-router/pkg/`
- `training/output/v45_router_d4.js`
- `scripts/` files needed at runtime or init time
- generated asset manifests

### 2. Platform-native packages

Initial launch targets:

- `@sweet-search/native-darwin-arm64`
- `@sweet-search/native-darwin-x64`
- `@sweet-search/native-linux-x64-gnu`
- `@sweet-search/native-linux-arm64-gnu`

Deferred targets, only after demand justifies the added release complexity:

- `@sweet-search/native-linux-x64-musl`
- `@sweet-search/native-linux-arm64-musl`
- `@sweet-search/native-win32-x64-msvc`
- `@sweet-search/native-win32-arm64-msvc`

Each platform package should contain:

- the MaxSim native addon `.node`
- the `sweet-search` native executable for that platform
- a tiny manifest file describing paths and versions

Each platform package should set:

- `os`
- `cpu`
- `libc` where relevant

These packages should be listed under `optionalDependencies` in `sweet-search`.

### 3. Model asset packages

This is the least certain part of the plan and should be gated by legal review and package-size review.

Recommended packages:

- `@sweet-search/model-lateon-code`
- `@sweet-search/model-lateon-code-edge`
- `@sweet-search/model-gte-reranker-modernbert-base-int8`

Each model package should contain only the artifacts needed for local runtime:

- tokenizer assets
- ONNX model files
- projection weight files
- metadata manifest describing model id, version, checksum, and local target path

Target state for a no-download profile:

- do not leave these as mandatory runtime HTTP downloads

Recommended default strategy:

- do not package heavy third-party model artifacts into npm by default
- instead, have `sweet-search init` perform an explicit, user-visible download with progress, checksums, caching, and resumability
- reserve model-on-npm packaging for cases where redistribution rights are clear and the package-size tradeoff is acceptable

Decision gate before implementation:

- verify redistribution rights for each model and tokenizer asset
- estimate install and publish size impact
- compare npm packaging against init-time managed fetch
- only ship model packages through npm if that comparison still looks clearly favorable

### 4. Optional future asset packages

Only if needed later:

- translation model bundles
- larger offline grammar bundles
- evaluation corpora

These should stay out of the default install unless they are required for the default product path.

---

## Recommended Init UX

Support both of these:

### Primary UX

```bash
npx sweet-search init
```

This is the primary recommended path because Sweet Search is mainly installed into existing repositories, not used to scaffold brand-new application templates.

Implementation:

- install or invoke `sweet-search`
- detect the current repository
- install or verify required runtime assets for the selected profile
- generate config and verify runtime

### Secondary UX

```bash
npm create sweet-search@latest
```

This is optional and should be deferred unless Sweet Search later needs a true project-scaffolding experience.

If implemented later, it is useful for:

- existing repos
- CI bootstrap
- guided setup in a fresh directory

---

## Install Modes

This plan should explicitly support two install modes instead of conflating them.

### `standard`

Definition:

- normal npm dependency installation
- first-party WASM and generated assets shipped in the main package
- platform-native packages installed via `optionalDependencies`
- model assets installed by profile via init-managed fetch by default, or from npm model packages only where explicitly chosen

This is the primary recommended mode.

### `offline-bundle`

Definition:

- a separate distribution intended for environments where runtime downloads are unacceptable
- may use bundled dependencies, profile meta-packages, or a generated offline tarball

This is a secondary mode and should not drive the default public package design unless required.

---

## Init Profiles

A single universal install is mechanically possible, but may become too large to be practical. The cleaner approach is profile-based init with an explicit install mode.

### Recommended profiles

#### `core`

Installs:

- main package
- JS dependencies
- all shipped WASM
- router assets
- platform-native optional package if available

Does not install:

- late interaction model packages
- local reranker model package

Use case:

- lightweight search setup
- CI smoke tests

#### `full` (candidate default)

Installs:

- everything in `core`
- default late interaction model assets
- default reranker model assets

Delivery for those model assets should default to init-time managed fetch, not npm packaging, unless later review says otherwise.

This is a product choice, not a packaging fact. It should only become the default after measuring setup time, download size, and user friction.

#### `offline-max`

Installs:

- everything in `full`
- optional translation/offline extras if later packaged

Use case:

- air-gapped environments
- "zero runtime downloads after npm install" where redistribution rights allow it

---

## Exact Runtime Resolution Strategy

### Native and WASM loader order

At runtime, Sweet Search should resolve artifacts in this order:

1. installed platform-native package
2. local first-party shipped WASM
3. JS fallback

For MaxSim:

1. `@sweet-search/native-<platform>` addon
2. `core/maxsim.wasm`
3. JS fallback in `core/late-interaction-index.js`

For router:

1. `wasm-router/pkg/*`
2. JS fallback if router WASM load fails

For the primary CLI binary:

1. packaged native executable from installed platform package
2. JS CLI fallback

### Model resolution order

For late interaction and reranker models:

1. init-managed local model cache
2. local packaged model asset directory, if such packages are enabled for a given profile
3. existing configured local cache path
4. optional runtime download only when explicitly enabled by config

For profiles that claim local-only runtime, step 1 or 2 must be sufficient. For lightweight profiles, step 4 may remain available if explicitly enabled.

---

## Package.json Strategy

### Main package `dependencies`

Keep standard JS runtime packages here.

Examples:

- `better-sqlite3`
- `undici`
- `tree-sitter-wasms`
- `web-tree-sitter`
- `zod`

These already download through npm and do not need custom handling.

### `@huggingface/transformers` policy

#### Decision: full replacement (decided 2026-03-26)

`@huggingface/transformers` will be completely replaced and removed from the dependency tree. This is a fixed end-state decision, not an interim hedge. Options A (keep optional) and B (move to dependencies) were evaluated and rejected.

Current reality:

- it is in `optionalDependencies` today
- it is used by late interaction tokenization (`core/late-interaction-model.js`)
- it is used by the local reranker pipeline (`core/local-reranker.js`)
- it is used by the embedding pipeline (`core/embedding-local-model.js`, `core/embedding-cache.js`)
- it is used by Flashrank fallback paths (`core/flashrank.js`)

Rationale for full replacement:

- the late interaction path already uses `onnxruntime-node` directly for ONNX inference — `@huggingface/transformers` is only used there as a tokenizer
- the embedding pipeline already bypasses the HF pipeline wrapper via Direct ORT (L7 bypass in `core/embedding-local-model.js`)
- the Rust `tokenizers` crate (maintained by HuggingFace) is 20-50x faster than the JS tokenizer
- removing the dependency eliminates ~50MB of transitive install weight and a prerelease version pin (`^4.0.0-next.4`)
- direct `onnxruntime-node` integration gives tighter control over session options and binary distribution

Replacement architecture:

- Rust `tokenizers` crate compiled into the napi-rs addon (same crate as MaxSim) provides native tokenization
- Direct `onnxruntime-node` sessions for all model inference (late interaction, embeddings, reranker)
- JS fallback tokenizer for platforms without the native addon

Rollout (the decision is fixed; the rollout is phased):

1. Phase 3: Rust tokenizer added to napi-rs addon. Late interaction migrated first (highest indexing speedup, cleanest swap — already uses raw ORT).
2. Phase 6b: Reranker and embedding pipelines migrated to Rust tokenizer + direct ORT.
3. Final: `@huggingface/transformers` removed from `optionalDependencies` after all 8 modules are migrated.

During the transition, the dependency stays in `optionalDependencies` and existing code continues to work. No code changes in Phase 0.

### Main package `engines`

The main package should keep an explicit Node floor and all native/WASM plans should be consistent with it.

Current floor in the repo:

```json
{
  "engines": {
    "node": ">=18.0.0"
  }
}
```

Do not lower or implicitly bypass this requirement in init logic. Fail fast with a clear message on unsupported Node versions.

### Main package `bin`

The main package should publish a single branded CLI entrypoint:

```json
{
  "bin": {
    "sweet-search": "./bin/sweet-search.js",
    "sweet-search-mcp": "./mcp/server.js"
  }
}
```

Do not publish `ss` as the public command name.

The `sweet-search-mcp` entrypoint is a JS-only CLI and is not part of the native dispatch path.

### Main package `optionalDependencies`

Use this for platform-native packages:

```json
{
  "optionalDependencies": {
    "@sweet-search/native-darwin-arm64": "x.y.z",
    "@sweet-search/native-darwin-x64": "x.y.z",
    "@sweet-search/native-linux-x64-gnu": "x.y.z",
    "@sweet-search/native-linux-arm64-gnu": "x.y.z"
  }
}
```

Deferred packages such as musl and Windows targets should not appear in the initial `optionalDependencies` block until they are actually built, published, and supported in CI.

### Model package selection

Use one of two approaches:

#### Option A: init-managed fetch from `sweet-search init`

`sweet-search init --profile full` downloads the required model artifacts into a managed local cache with checksums and resumable behavior.

This Phase 3 work must start by replacing the current bare downloader implementation rather than layering new behavior on top of it.

Pros:

- keeps npm package sizes smaller
- avoids pushing large opaque model blobs through npm by default
- explicit profile control
- easier to cache and migrate independently from JS package updates

Cons:

- init takes longer on first run
- requires explicit download and cache management code

Recommended choice:

- use Option A first
- consider npm model packages only for approved offline-focused distributions or clearly beneficial cases

Required sub-work before this option is production-ready:

- checksum verification for every downloaded artifact
- resumable and retryable downloads
- temporary-file writes plus atomic rename to avoid poisoning the cache with truncated files
- progress reporting
- stale-cache detection

#### Option B: publish model packages to npm

Examples, if later approved:

- `@sweet-search/model-lateon-code`
- `@sweet-search/model-lateon-code-edge`
- `@sweet-search/model-gte-reranker-modernbert-base-int8`

Pros:

- fully npm-delivered model assets
- simpler no-download offline story

Cons:

- much larger package/install sizes
- redistribution/legal review required
- slower publish/install cycles

Decision:

- Option A is the default plan
- Option B remains conditional

#### Optional profile meta-packages

Examples:

- `@sweet-search/profile-core`
- `@sweet-search/profile-full`
- `@sweet-search/profile-offline-max`

These are optional future simplifications, not part of the initial plan.

### `bundleDependencies`

Do not use `bundleDependencies: true` for the public normal path unless you specifically want a giant offline tarball.

Reason:

- npm already installs JS dependencies for normal users
- bundling all dependencies into the published tarball makes updates heavier
- it is not the right mechanism for platform-specific native selection

Use `bundleDependencies` only for a separate offline-distribution package or explicitly generated offline tarball if you later need one.

---

## File Layout Plan

### Main package

Recommended runtime-visible layout:

```text
sweet-search/
  core/
    maxsim.wasm
    simd-distance.wasm
  bin/
    sweet-search.js
  wasm-router/pkg/
  training/output/
    v45_router_d4.js
  assets/
    manifest.json
  scripts/
    init.js
    verify-runtime.js
```

Generated local runtime state:

```text
.sweet-search/
  config.json
  ...
```

### Platform package

Example:

```text
@sweet-search/native-darwin-arm64/
  package.json
  manifest.json
  maxsim.darwin-arm64.node
  sweet-search
```

### Model package

Example:

```text
@sweet-search/model-lateon-code/
  package.json
  manifest.json
  model/
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json
    model_int8.onnx
    1_Dense/model.safetensors
```

---

## Init Command Responsibilities

Implement `sweet-search init` as an idempotent command.

## CLI Dispatch Strategy

The public npm `bin` should point to a Node.js wrapper, not directly to a platform-specific native binary.

Required behavior:

1. npm `bin` points to `bin/sweet-search.js`
2. `bin/sweet-search.js` resolves the current platform and attempts to locate the matching `@sweet-search/native-<platform>` package
3. package-management and wrapper-owned commands always run in JS:
   - `init`
   - `init --upgrade`
   - `--version`
   - package-install or repair subcommands
4. runtime/search commands may dispatch to the packaged native binary named `sweet-search` when present
5. native dispatch should use `child_process.spawnSync()` with `stdio: 'inherit'` and explicit exit-code forwarding, not `execFileSync()`
6. if no native binary is available, the wrapper runs the JS implementation directly
7. the user-facing command name remains `sweet-search` in both cases

This preserves one brand, one command, and transparent native acceleration.

### Responsibilities

1. Detect project root.
2. Create `.sweet-search/` directories.
3. Resolve requested profile.
4. Install missing npm packages for the profile.
5. Verify presence of:
   - core WASM
   - router WASM bundle
   - selected model assets in the managed cache or local package
   - native package for current platform if published
6. Generate local config at `.sweet-search/config.json`:
   - selected profile
   - selected late interaction model
   - reranker enabled/disabled
   - paths to packaged artifacts
7. Run a post-install verification:
   - fast verification by default: file existence, manifest entries, checksums
   - optional deep verification: actual load of router, MaxSim tier, late interaction model, reranker model
8. Print a concise report.

### Output example

```text
Sweet Search init complete

Profile: full
MaxSim: native
Router: wasm
Late interaction model: init-managed cache
Reranker model: init-managed cache
Runtime verification: fast-pass
```

---

## Runtime Configuration Changes Required

### 1. Replace direct HTTP-first model fetch logic

Current late interaction and reranker code should stop assuming runtime download is normal for the `full` and `offline-max` profiles.

Instead:

- first check the init-managed model cache
- then check packaged model locations if enabled for the profile
- then check configured cache locations
- only then allow remote download if explicitly enabled

Add config flags:

- `allowRuntimeModelDownload`
- `artifactProfile`
- `artifactRoot`
- `modelCacheRoot`
- `modelMirror`
- `hfEndpoint`

Default:

- `allowRuntimeModelDownload = false` for `full` and `offline-max`
- `allowRuntimeModelDownload = true` only for explicit lightweight/dev modes
- `hfEndpoint` should default to the upstream Hugging Face endpoint but remain overrideable for enterprise mirrors and proxy environments

### 2. Add artifact manifest

Add a generated manifest so runtime code does not hardcode too many relative paths.

Suggested structure:

- `assets/manifest.json`
  - `runtimeAssets`
  - `nativePackages`
  - `profiles`
  - `modelSources`

### 3. Add native package resolver

Create a single resolver module that:

- identifies current platform
- maps platform to expected optional package
- resolves native addon path
- resolves native `sweet-search` binary path
- returns null cleanly when not installed

### 4. Explicit no-`postinstall` policy

The initial distribution plan should avoid `postinstall` scripts for platform-native packages.

Reason:

- they slow installs
- they create more security scrutiny
- the `optionalDependencies` pattern already solves the main cross-platform selection problem

Allowed exception:

- a clearly documented repair/install helper invoked by `sweet-search init`, not by npm automatically

---

## CI and Release Plan

### Build matrix

Create CI jobs for initial launch targets:

- macOS arm64
- macOS x64
- Linux x64 glibc
- Linux arm64 glibc

Add later only if required:

- Linux x64 musl
- Linux arm64 musl
- Windows x64
- Windows arm64 if supported

### Publish order

1. Build and test universal assets.
2. Publish model packages that passed redistribution review, if any are used.
3. Publish platform-native packages.
4. Publish main `sweet-search` package.
5. Publish `create-sweet-search` only if that package exists.

### CI verification steps

Every release should run:

1. `npm test`
2. native/WASM parity tests
3. `npm pack --dry-run`
4. install smoke tests:
   - `npm i sweet-search`
   - `npx sweet-search init --profile core`
   - `npx sweet-search init --profile full`
   - `npm ci` on both macOS and Linux from the same lockfile
5. runtime smoke tests:
   - router load
   - MaxSim tier resolution
   - reranker model load
   - late interaction model load
   - `sweet-search-mcp --help` or equivalent MCP entrypoint smoke test
6. publish integrity:
   - provenance enabled where supported

### Release artifacts to verify

- main tarball contents
- each platform tarball contents
- each model tarball contents
- checksums for binary/model packages
- provenance metadata for published packages where supported

---

## Tests to Add

### Packaging tests

- main package `files` contains all required WASM and router assets
- platform package manifest points to valid binary names
- model package manifests point to valid model files
- `npm pack --dry-run` snapshot test for required assets

### Runtime resolution tests

- native resolver picks the correct package for the platform
- missing native package falls back to WASM
- missing WASM falls back to JS
- packaged model path is preferred over runtime download
- init-managed model cache is preferred over runtime download

### Init command tests

- `init --profile core` creates config and passes verification
- `init --profile full` downloads and verifies required model assets when using init-managed fetch
- rerunning init is idempotent
- init reports useful failures when a package is missing
- init reports useful failures when checksums fail or cached artifacts are stale

### End-to-end smoke tests

- fresh temp directory -> `npx sweet-search init`
- fresh temp directory -> `npm create sweet-search@latest` if that package exists
- runtime command can execute after init without network

---

## Implementation Phases

### Phase 0a: Immediate blockers, namespace reservation, and CLI architecture

Deliverables:

- claim the npm package name `sweet-search` **(done 2026-03-26)**
- claim the npm scope or org intended for native/model packages before implementation begins
- if `@sweet-search` cannot be claimed, choose and freeze the replacement scope before any package naming work starts
- remove the Linux-only `ss` ELF from the public npm `bin` and `files` surface **(done 2026-03-27)**
- replace the C CLI launcher with a Rust CLI launcher (`sweet-search-cli/`) that preserves native startup speed **(done 2026-03-27)**
- add a thin JS fallback dispatcher (`bin/sweet-search.js`) for npm portability — this is a packaging workaround for Phase 0, not the long-term default path
- the Rust launcher is the long-term CLI direction: one codebase, per-target binaries for aarch64-apple-darwin, x86_64-apple-darwin, x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu (WSL covered by Linux targets, no native Windows)

Exit criteria:

- package naming and npm scope decisions are frozen
- no platform-incompatible native binary is exposed as the default npm CLI entry point
- Rust CLI launcher built and validated on at least one platform with no warm-path regression versus the C launcher

### Phase 0b: Runtime inventory and prerequisite decisions

Deliverables:

- `@huggingface/transformers` decision: **full replacement decided 2026-03-26** (see `@huggingface/transformers` policy section above for rationale and rollout plan)
- complete list of required artifacts
- classification into universal, platform-specific, profile-specific
- size estimates for each package bucket

Exit criteria:

- the `@huggingface/transformers` full-replacement decision is recorded and Phase 3 can proceed
- no required runtime asset remains "implicitly downloaded later" without a documented reason

### Phase 1: Universal asset packaging

Deliverables:

- main package ships all first-party WASM and router assets
- `npm pack --dry-run` CI check
- asset manifest generation

Exit criteria:

- main package alone contains all first-party universal runtime assets

### Phase 2: Native package split

Deliverables:

- per-platform native packages
- loader/resolver module
- optionalDependencies wiring

Exit criteria:

- supported platforms can resolve native addon and `sweet-search` binary via npm-installed packages

### Phase 3: Model delivery

Deliverables:

- model registry (`core/model-registry.js`) with SHA256 checksums for all full-profile models, verified against HuggingFace API
- robust model fetcher (`core/model-fetcher.js`) with checksums, resumable downloads, atomic writes, retries, and configurable HF endpoint
- `MODEL_DELIVERY_CONFIG` in `core/config.js`: `allowRuntimeModelDownload`, `modelCacheRoot`, `hfEndpoint`
- late interaction fully migrated to managed delivery (download, cache, and load from managed cache)
- runtime-download gating and model verification for reranker and embeddings (managed fetcher acts as gate; HF transformers still handles actual loading from its own cache format)
- full managed-cache loading for reranker and embeddings is deferred to Phase 7 (native end-to-end model execution), when `@huggingface/transformers` is replaced entirely

Exit criteria:

- late interaction loads exclusively from managed cache with checksum-verified artifacts
- reranker and embedding paths are gated by `allowRuntimeModelDownload` — blocked with clear error when disabled and model files are unavailable
- model registry covers all full-profile models with verified checksums
- `scripts/verify-model-registry.js` can regenerate/verify registry checksums against HuggingFace API

### Phase 4: Init UX

Deliverables:

- `sweet-search init`
- optional later `create-sweet-search`
- verification report

Exit criteria:

- a new user can bootstrap with one npm command

### Phase 5: Release automation

Deliverables:

- CI build matrix
- publish order automation
- smoke tests

Exit criteria:

- publish is reproducible and validated

### Phase 6: Native acceleration

This phase is profiling-gated. It should only begin after Phases 0-5 are complete and the system is working end-to-end with the Node.js CLI wrapper as the default dispatch mechanism.

#### 6a: CLI dispatch optimization **(done 2026-03-28)**

**Cold-start auto-spawn bug — fixed**

The Rust CLI's `auto_start_server()` failed to start the Node server on cold start. Three root causes were found and fixed:

1. Missing `await` in `core/search-cli.js` — `startServer()` was fire-and-forget, causing `runCli()` to return and Node to exit with code 13 ("unsettled top-level await").
2. Circular import chain — `sweet-search.js` → `search-cli.js` → `sweet-search.js` caused Node's ESM evaluator to short-circuit. Fixed by adding `core/start-server.js`, a minimal server entry point that imports `search-server.js` directly.
3. macOS code signing — copying a binary invalidates the Mach-O ad-hoc signature, causing SIGKILL. Added `codesign -s -` steps to the CI smoke-test and publish workflows for darwin platforms.

Additional improvements:
- `SWEET_SEARCH_SOCKET_PATH` env var added to both Rust CLI and Node server for test isolation and parallel-safe integration tests.
- `find_server_script()` now canonicalizes paths to absolute before passing to Node, so `import.meta.url` matches `process.argv[1]` in the CLI guard.
- Cold-start integration test added to `tests/native-launcher.integration.test.js`.

**Profiling results (M3 Max, ~17K files indexed):**

Warm-query search latency breakdown (p50 = 28ms total):

| Component | p50 | % of total |
|---|---|---|
| Embedding (ORT, L7 direct) | 5.7ms | 20.4% |
| LI inference (ORT session.run) | 3.5ms | 12.6% |
| HNSW binary search (usearch) | 2.6ms | 9.4% |
| HNSW int8 rescore | 0.2ms | 0.7% |
| LI tokenization (JS) | 0.105ms | 0.4% |
| Float rescore | 0.09ms | 0.3% |
| SIMD distance (WASM) | <0.01ms | <0.1% |

CLI dispatch overhead:

| Path | p50 |
|---|---|
| Native Rust (warm) | 2.9ms |
| Native Rust (cold) | 108ms |
| JS fallback | 64.7ms |

Cross-encoder reranker runs asynchronously in the cascade path (~27ms when invoked).

Profiling harness: `scripts/profile-pipeline.js`
LI timing probes: `core/late-interaction-model.js` (`getLateInteractionTimings()`)

#### 6b: Expanded napi-rs acceleration — **deferred based on profiling**

The profiling data from 6a shows that the top three warm-query-latency components (embedding, LI inference, HNSW binary) are **already native** (ORT via `onnxruntime-node`, usearch). JS tokenization is 0.4% of total search time (105 microseconds) — not a warm-query bottleneck.

SIMD distance functions (`simd-distance.wasm`) did not register in profiling — sub-microsecond per call via WASM SIMD.

Remaining candidate: native tokenization via Rust `tokenizers` crate for **indexing throughput** (encoding thousands of documents), not for query latency. This is deferred to Phase 7 where the full `@huggingface/transformers` replacement is scoped.

The napi-rs crate rename (`native-maxsim` → `sweet-search-native`) is deferred until the crate's scope actually expands.

Exit criteria (revised):

- profiling data exists for CLI dispatch and runtime hot paths **(done)**
- cold-start auto-spawn bug is fixed and proven by integration test **(done)**
- profiling conclusion recorded: no warm-query hot path justifies new native acceleration at this time **(done)**
- native tokenization for indexing throughput deferred to Phase 7 **(recorded)**

### Phase 7: Native End-to-End Model Execution

Replace `@huggingface/transformers` completely for all local model paths. Build native Rust pipelines via napi-rs for every model path.

**Prerequisite:** Phase 3 (model delivery) and Phase 6b (expanded napi-rs) must be complete.

**Scope:**

- Replace `@huggingface/transformers` for all local model paths:
  - late interaction tokenization + pre/post-processing
  - local embedding pipeline (tokenization, inference orchestration, pooling, normalization)
  - local reranker pipeline (tokenization, inference, sigmoid)
- Use Rust `tokenizers` crate directly for all tokenization
- Use ONNX Runtime directly from native code via the C API / Rust binding for native pipelines; keep Node bindings (`onnxruntime-node`) only for JS fallback paths
- Do NOT replace ORT internals with custom SIMD — ORT already handles optimized inference kernels
- Move tensor prep, pooling, normalization, and post-processing into native code
- Reuse buffers and avoid JS/native allocation churn
- Add batching and pipeline ownership in native code
- Use rayon where it actually helps:
  - batch embedding (parallel across documents)
  - indexing throughput (parallel chunk encoding)
  - reranking many documents (parallel scoring)
  - multi-vector post-processing
- Do NOT claim rayon helps every step equally — it helps CPU-parallel batch work, not single-query latency
- Native speedups focus on: tokenization, tensor prep, buffer reuse, batching, pooling, normalization, pipeline overhead reduction
- Platform-specific optimizations (CoreML, OpenVINO) are incremental gains on top, not the primary speedup source

Deliverables:

- native tokenizer path for all models
- native embedding pipeline
- native reranker pipeline
- native late-interaction tokenizer + pre/post path
- parity tests against existing JS/ORT behavior
- throughput benchmarks (indexing, batch embedding) and single-query latency benchmarks
- clear fallback behavior when native path is unavailable

Exit criteria:

- `@huggingface/transformers` is no longer required for any local model path
- local model execution works end-to-end through native code paths
- parity is verified against the previous implementation
- measured throughput gains exist for indexing and/or batch workloads
- no regression in warmed single-query latency

### Phase 8: Cross-target validation

This phase is the final verification pass. Its purpose is to prove that Sweet Search works correctly across every supported target, packaging mode, and runtime profile before the plan is considered complete.

Deliverables:

- explicit validation matrix for all supported targets
- automated smoke tests for every supported platform package
- profile coverage for `core` and `full`
- package manager coverage for npm, pnpm, yarn, and bun where supported
- Linux validation that closes the remaining Rust-vs-C launcher benchmark gap
- publish-time verification checklist for native package resolution, JS fallback, model delivery, and init flows

Target matrix:

- macOS arm64 (`aarch64-apple-darwin`) on real hardware
- macOS x64 (`x86_64-apple-darwin`) on Intel hardware or CI
- Linux x64 GNU (`x86_64-unknown-linux-gnu`) on native Linux or Linux CI
- Linux arm64 GNU (`aarch64-unknown-linux-gnu`) on native Linux arm64, arm64 VM, or arm64 container host
- WSL validation on a representative Ubuntu/Debian-based environment using the Linux GNU target

Validation dimensions:

- install path:
  - fresh install from npm
  - local pack/install from `npm pack`
  - upgrade/reinstall path
- runtime path:
  - native launcher present and selected
  - JS fallback path when native package is absent
  - native addon present
  - WASM/JS fallback when native addon is absent
- product profile:
  - `init --profile core`
  - `init --profile full`
- package manager:
  - npm
  - pnpm
  - yarn
  - bun

Required checks on each supported target:

1. Install `sweet-search` into a fresh temp directory.
2. Verify the `sweet-search` command resolves and runs.
3. Run `sweet-search --help`.
4. Run `sweet-search init --profile core`.
5. Run `sweet-search init --profile full` where model/network policy allows it.
6. Execute a real query against a warm server.
7. Verify native launcher selection where a native package exists.
8. Verify fallback behavior when the native package is intentionally missing.
9. Verify native addon selection where supported.
10. Verify fallback to WASM/JS when native addon is intentionally missing.
11. Run MCP entrypoint smoke test (`sweet-search-mcp --help` or equivalent startup check).
12. Run `sweet-search uninstall --dry-run` and verify reported artifacts match what init created.
13. Run `sweet-search uninstall` and verify no orphaned state remains.
14. Capture timing data for launcher startup and warm-path queries.

Benchmark requirements:

- Linux CI or a Linux machine must benchmark the Rust launcher against the previous C launcher baseline to close the remaining Phase 0 verification gap.
- macOS must benchmark the Rust launcher against `ss.sh` as the secondary baseline.
- benchmark results must be stored with the release evidence for the validated targets.

Exit criteria:

- every supported target in the matrix has a passing install, init, and query smoke test
- native launcher and native addon resolution work on all supported targets
- fallback paths are explicitly tested and pass
- package-manager-specific install differences are accounted for
- Linux benchmark evidence exists for Rust-vs-C launcher parity or improvement
- release evidence exists for all supported targets before public publish

### Phase 9: Clean uninstall

An honest install story needs an honest uninstall story. `sweet-search uninstall` reverses everything `sweet-search init` created, leaving no orphaned files, caches, or config on the user's machine.

Deliverables:

- `sweet-search uninstall` command that removes all Sweet Search local state for the current project
- remove `.sweet-search/` config directory and all generated config
- remove init-managed model cache contents for the current project, with size reporting before deletion
- `--dry-run` flag that shows exactly what would be removed and how much disk space would be reclaimed, without deleting anything
- `--keep-models` flag to preserve the model cache (it may be shared or expensive to re-download) while removing everything else
- `--purge` flag that additionally runs `npm uninstall sweet-search` and removes scoped `@sweet-search/*` packages from `node_modules`
- interactive confirmation by default; `--force` flag for CI and scripted use
- profile-aware: only report and clean artifacts that were actually installed for the active profile
- idempotent: running uninstall twice does not error; the second run reports "nothing to remove"
- clear post-uninstall summary showing what was removed, what was kept, and any manual steps remaining (e.g., removing the npm package itself if `--purge` was not used)

Design constraints:

- uninstall must not touch files outside of `.sweet-search/`, the init-managed model cache, and (with `--purge`) `node_modules`
- uninstall must not delete user source code, indexes, or database files unless they live inside `.sweet-search/`
- the command must work even if the Sweet Search runtime is partially broken (corrupted config, missing native addon, etc.) — it should degrade gracefully and still clean up what it can
- the model cache location must be resolved from the same config and defaults that init uses, not hardcoded

Exit criteria:

- `sweet-search uninstall` removes all local state created by `sweet-search init`
- `sweet-search uninstall --dry-run` accurately reports what would be removed and total disk space to be reclaimed
- uninstall is idempotent
- no orphaned model cache, config, or generated files remain after uninstall
- Phase 8 cross-target validation matrix includes uninstall smoke tests on every supported target

---

## Acceptance Criteria

This plan is complete when all of the following are true:

- `npx sweet-search init --profile full` works in an existing directory
- full profile requires no runtime HTTP fetch for core search features, unless the chosen model strategy explicitly keeps runtime fetch as a documented exception
- model downloads, if used, happen during explicit init rather than implicitly during normal runtime
- the main package always contains first-party WASM and router assets
- supported platforms get native addon and `sweet-search` binary automatically through npm
- unsupported platforms fall back cleanly to WASM/JS
- CI verifies package contents and runtime resolution
- the supported target matrix has passing Phase 7 validation evidence
- the `ss` binary name is not used for public distribution
- `sweet-search uninstall` cleanly reverses `sweet-search init` with no orphaned state

---

## Recommended Defaults

Use these defaults unless legal review or package-size data says otherwise:

- default init command: `npx sweet-search init`
- default profile: `full`
- default runtime policy: local assets first, explicit init-managed model download, remote runtime download disabled for `full`
- native strategy: platform-specific optional packages
- WASM strategy: ship directly in main package
- JS third-party dependencies: normal npm `dependencies`
- giant offline bundle: defer until explicitly needed
- create-package scaffolding: defer until clearly needed

---

## Risks and Tradeoffs

### Package size

If model artifacts are shipped through npm, install size will increase materially.

Mitigation:

- profile-based installs
- separate model packages
- make `full` the default only after measuring actual publish/install size

### Redistribution rights

Some third-party model artifacts may not be appropriate to republish through npm without review.

Mitigation:

- perform a license and redistribution audit for each model package
- keep a fallback path that uses explicit first-run download when redistribution is not approved
- document which profiles are fully offline-capable versus partially offline

### Release complexity

Multi-package publish is more complex than a single tarball.

Mitigation:

- automate publish order in CI
- use manifests and smoke tests

### Native coverage gaps

Not every platform may have a prebuilt native package immediately.

Mitigation:

- make WASM fallback first-class
- clearly report active MaxSim tier

### Dependency churn

Large third-party model packages may change more slowly than app code.

Mitigation:

- version model packages independently
- pin manifests by exact asset version

### Upgrade and migration

Users need a clear story when:

- model versions change
- cache formats change
- native package names or binary layouts change

Mitigation:

- add `sweet-search init --upgrade`
- version the managed model cache and manifest schema
- detect stale or incompatible artifacts during init
- re-download or migrate only what is necessary

### Enterprise network constraints

Some users will have internet access but will be unable to reach `huggingface.co` directly because of proxies, mirrors, or corporate egress rules.

Mitigation:

- support `modelMirror` and `hfEndpoint` overrides
- document proxy-friendly init behavior
- ensure init-managed download code does not assume direct access to the public Hugging Face host

---

## Concrete Recommendation

Implement this plan with:

1. one main `sweet-search` package
2. one primary `sweet-search init` flow
3. per-platform native packages in `optionalDependencies`
4. init-managed model downloads by default, with npm model packages only after redistribution review
5. `full` as the candidate default init profile
6. zero implicit runtime model downloads in the default profile

This gets you the npm UX you want without forcing every user on every platform to download every native binary for every operating system.

If redistribution review blocks model-on-npm packaging, the fallback recommendation is:

1. keep universal WASM and router assets in the main package
2. keep native artifacts in platform packages
3. let `sweet-search init` perform an explicit, user-visible first-run model fetch for the selected profile
4. reserve "fully offline" for a later dedicated distribution

---

## External References

- npm `package.json` docs: https://docs.npmjs.com/cli/v11/configuring-npm/package-json/
- npm publish docs: https://docs.npmjs.com/cli/v11/commands/npm-publish/
- Sentry on shipping binaries with npm: https://sentry.engineering/blog/publishing-binaries-on-npm
- napi-rs package template: https://github.com/napi-rs/package-template
- napi-rs WebAssembly docs: https://napi.rs/docs/concepts/webassembly
- napi-rs v3 notes on optional dependency handling: https://napi.rs/blog/announce-v3
- napi-postinstall helper: https://github.com/un-ts/napi-postinstall
