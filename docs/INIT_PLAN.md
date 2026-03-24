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

### Already npm-delivered or shippable in the main package

- main JS sources under `core/`
- MCP server code under `mcp/`
- translation code under `translation/`
- CatBoost router export under `training/output/v45_router_d4.js`
- WASM router bundle under `wasm-router/pkg/`
- MaxSim WASM blobs under `core/*.wasm`
- standard npm dependencies such as `better-sqlite3`, `undici`, `tree-sitter-wasms`, `web-tree-sitter`

### Currently not fully npm-managed for a no-download runtime

- `lightonai/LateOn-Code` artifacts used by `core/late-interaction-model.js`
- `lightonai/LateOn-Code-edge` artifacts used by `core/late-interaction-model.js`
- `Alibaba-NLP/gte-reranker-modernbert-base` artifacts used by `core/local-reranker.js`
- platform-specific native addon packages
- platform-specific `sweet-search` binary packages

### Already third-party npm dependencies and should remain so

- parser/runtime dependencies such as `tree-sitter-wasms`
- core JS libraries already in `package.json`

These should continue to come from npm rather than being re-vendored.

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

This dependency needs to be treated as an explicit architectural decision, not an incidental package.

Current reality:

- it is in `optionalDependencies` today
- it is used by late interaction tokenization
- it is used by the local reranker pipeline
- it is used by the embedding pipeline
- it is used by Flashrank fallback paths on some platforms

The plan must decide one of these paths:

#### Option A: keep `@huggingface/transformers` in `optionalDependencies`

Use when:

- Sweet Search still supports degraded operation without local model inference
- some profiles intentionally skip local model features

Risk:

- users may think the dependency is optional when their chosen profile actually requires it

#### Option B: move `@huggingface/transformers` to `dependencies`

Use when:

- the default `full` profile depends on it in practice
- local model execution is considered part of the standard product path

Risk:

- larger base install footprint

#### Option C: replace portions of it with direct `onnxruntime-node` integration

Use when:

- Sweet Search wants tighter control over inference/runtime packaging
- tokenizer and model loading can be handled directly with less indirection

Risk:

- higher implementation complexity
- more custom runtime code to maintain

Recommended interim decision:

- keep `@huggingface/transformers` explicit in the plan
- do not finalize model delivery without first deciding whether it remains `optionalDependencies`, moves to `dependencies`, or is partially replaced

Phase ownership:

- this decision belongs to Phase 0 because Phase 3 depends on it

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

### Phase 0a: Immediate blockers and namespace reservation

Deliverables:

- claim the npm package name `sweet-search`
- claim the npm scope or org intended for native/model packages before implementation begins
- if `@sweet-search` cannot be claimed, choose and freeze the replacement scope before any package naming work starts
- remove the Linux-only `ss` ELF from the public npm `bin` and `files` surface
- replace it with a portable Node.js CLI wrapper exposed as `sweet-search`
- document the current shipping incompatibility explicitly in release notes and migration notes

Exit criteria:

- package naming and npm scope decisions are frozen
- no platform-incompatible native binary is exposed as the default npm CLI entry point

### Phase 0b: Runtime inventory and prerequisite decisions

Deliverables:

- decide the packaging role of `@huggingface/transformers`: remain `optionalDependencies`, move to `dependencies`, or be partially replaced
- complete list of required artifacts
- classification into universal, platform-specific, profile-specific
- size estimates for each package bucket

Exit criteria:

- the `@huggingface/transformers` decision is made before Phase 3 starts
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

- init-managed model fetcher with checksums and resumability
- runtime local-first resolution
- full profile install flow
- model-on-npm decision memo after legal and size review

Exit criteria:

- full profile can run without ad hoc runtime downloads during normal command execution

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

#### 6a: CLI dispatch optimization

The Node.js CLI wrapper (`bin/sweet-search.js`) adds measurable startup overhead per invocation. For a CLI tool invoked frequently by agents and developers, this overhead compounds.

This sub-phase does not pre-commit to a specific optimization strategy. The correct approach depends on profiling data from real Sweet Search workflows and on which package manager layouts need to be supported.

**Prerequisite:**

- measure actual CLI dispatch overhead in representative workflows (single search, batch agent invocations, CI pipelines)
- determine whether the overhead is user-facing or masked by server startup, model loading, or network I/O

**Candidate strategies to evaluate after profiling:**

- minimize the Node wrapper itself (strip all unnecessary requires, avoid loading the full runtime for dispatch-only paths)
- compiled lightweight dispatcher binary (Rust or C) that replaces the Node wrapper
- shell-based dispatch with robust path resolution (must work across npm, pnpm, yarn, bun)
- direct native binary exposure via platform package `bin` fields if naming conflicts can be resolved

**Constraints:**

- do not mutate `node_modules/.bin/` — package managers own that directory
- do not introduce init-dependent state that the CLI requires to function (init should improve performance, not be required for correctness)
- any optimization must work across npm, pnpm, yarn, and bun without per-manager special cases
- the Node wrapper remains the safe fallback on all platforms

#### 6b: Expanded napi-rs acceleration

Extend the existing napi-rs crate to cover additional hot paths beyond MaxSim. All new native functions are added to the same crate and compiled into the same `.node` addon — no new packages, no new build targets, same CI matrix.

When the crate grows beyond MaxSim-only functionality, rename it from `native-maxsim` to `sweet-search-native` to reflect its broader scope.

Every native acceleration must have a JS or WASM fallback so unsupported platforms continue to work.

**Prerequisite:**

- profile the actual Sweet Search runtime to identify which hot paths have the highest time share
- prioritize based on measured data, not assumed bottlenecks

**Candidate hot paths for native acceleration:**

| Hot path | Current implementation | Native opportunity |
|---|---|---|
| MaxSim scoring | napi-rs (already native) | Done |
| SIMD distance computation | `core/simd-distance.wasm` | Move to same napi-rs addon |
| Tokenization | JS via `@huggingface/transformers` | Rust `tokenizers` crate (by HuggingFace) |
| Leiden clustering | Pure JS in `core/leiden-algorithm.js` | Rust graph crate |
| Binary HNSW operations | `usearch` (already native) | Already fast |
| SQLite / FTS5 | `better-sqlite3` (already native) | Already fast |

**Expected priority order (subject to profiling):**

1. **Tokenization** — likely highest impact. The Rust `tokenizers` crate is maintained by HuggingFace and is expected to be substantially faster than the JS pipeline. This also reduces the dependency surface on `@huggingface/transformers`.
2. **SIMD distances** — already have a WASM implementation; moving to native eliminates the WASM boundary overhead.
3. **Leiden clustering** — only impactful for large codebases with big graphs. Defer unless profiling shows it as a bottleneck.

**Implementation pattern for each new native function:**

1. Add the Rust function to the napi-rs crate with `#[napi]`
2. Add a JS/WASM fallback in the corresponding `core/*.js` module
3. Add a resolver check: try native import, fall back to JS/WASM
4. Add a parity test: native and JS/WASM must produce identical results
5. Rebuild the platform packages — same CI pipeline, same 4 targets

Exit criteria:

- profiling data exists for CLI dispatch and runtime hot paths
- at least one non-MaxSim hot path has a native acceleration with verified JS/WASM fallback
- parity tests confirm identical results across native and fallback paths
- the napi-rs crate is renamed to `sweet-search-native` if it now covers more than MaxSim

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
- the `ss` binary name is not used for public distribution

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
