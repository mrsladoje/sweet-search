# Alpine Native Support Plan

**Status**: planned
**Scope**: add native support for Alpine Linux / musl targets without regressing existing `gnu` platforms

## Goal

Support Alpine users with the same native fast path currently available on:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64-gnu`
- `linux-arm64-gnu`

Target new native packages:

- `@sweet-search/native-linux-x64-musl`
- `@sweet-search/native-linux-arm64-musl`

If native musl artifacts are unavailable, runtime must continue to fall back cleanly to JS/WASM.

## Why This Is Separate

Alpine uses `musl`, not `glibc`.

Current native resolution only supports:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64-gnu`
- `linux-arm64-gnu`

That means Alpine currently runs the fallback path, which is correct but slower.

## Desired End State

On Alpine:

1. npm installs the matching optional native package.
2. `resolveNativeAddon()` finds `sweet-search-native.node`.
3. `resolveNativeBinary()` finds `sweet-search`.
4. `sweet-search init` reports native availability.
5. smoke tests pass on real musl containers for `core` and `full`.

## Required Work

### 1. Add musl native packages

Create package directories parallel to the existing GNU packages:

- `packages/native-linux-x64-musl/`
- `packages/native-linux-arm64-musl/`

Each package should mirror the existing native package structure:

- `package.json`
- `manifest.json`
- `sweet-search-native.node`
- `sweet-search`

## 2. Extend runtime target detection

Update [native-resolver.js](/Users/admin/Projects/sweet-search-private/core/infrastructure/native-resolver.js) to distinguish:

- `linux-x64-gnu`
- `linux-arm64-gnu`
- `linux-x64-musl`
- `linux-arm64-musl`

This requires real libc detection, not the current hardcoded Linux `-gnu` suffix.

Likely approaches:

- inspect `process.report?.getReport()?.header?.glibcVersionRuntime`
- inspect `ldd --version` output in scripts/tests only, not hot runtime paths
- use a small libc detection helper at startup

Requirement: unsupported or ambiguous detection must still return `null`, not guess.

## 3. Add optionalDependencies

Update the main [package.json](/Users/admin/Projects/sweet-search-private/package.json) with:

- `@sweet-search/native-linux-x64-musl`
- `@sweet-search/native-linux-arm64-musl`

## 4. Teach build scripts about musl

Update native packaging scripts so they can build and place artifacts into the new musl package directories:

- [build-native-package.sh](/Users/admin/Projects/sweet-search-private/scripts/build-native-package.sh)
- [cross-target-validation.sh](/Users/admin/Projects/sweet-search-private/scripts/cross-target-validation.sh)
- [run-validation.sh](/Users/admin/Projects/sweet-search-private/scripts/run-validation.sh)

The output artifact names should remain:

- `sweet-search-native.node`
- `sweet-search`

Only the package name / target key should vary.

## 5. Extend release workflow

Update [.github/workflows/release.yml](/Users/admin/Projects/sweet-search-private/.github/workflows/release.yml) to build, assemble, smoke test, and publish:

- `linux-x64-musl`
- `linux-arm64-musl`

Likely implementation:

- use Alpine-based build containers for musl targets
- keep GNU and musl jobs separate
- run smoke tests inside real Alpine containers, not Debian-based containers

## 6. Validate native addon compatibility

Confirm the napi addon can be built and loaded correctly on musl for:

- tokenizer paths
- native grep
- sparse gram
- SIMD helpers
- MaxSim entrypoints

This is the highest technical risk in the plan.

## 7. Validate native CLI compatibility

Confirm the Rust `sweet-search` binary works on musl and that:

- socket behavior matches current Linux behavior
- exit codes match the JS dispatcher expectations
- no dynamic libc dependency leaks remain

## 8. Add musl smoke coverage

Add CI verification that proves the native path is active on Alpine:

- `resolveNativeAddon()` returns non-null
- `resolveNativeBinary()` returns non-null
- addon can be `require()`d successfully
- `sweet-search --help` works
- `scripts/smoke-test.js --profile core`
- `scripts/smoke-test.js --profile full`

## 9. Update docs

After implementation, update:

- [INIT_STRATEGY.md](/Users/admin/Projects/sweet-search-private/docs/INIT_STRATEGY.md)

Specifically:

- package topology
- supported native targets
- validation matrix
- fallback expectations

## Risks

- `napi-rs` musl builds may need different linker/toolchain setup than GNU builds.
- arm64 musl may require QEMU or dedicated container flows in CI.
- some native dependencies may compile differently under musl.
- Alpine support can silently regress if CI only validates Debian/Ubuntu.

## Non-Goals

- Windows native support outside WSL2
- replacing the JS/WASM fallback path
- changing current GNU package names
- changing current artifact names again

## Rollout Order

1. Add libc detection in resolver.
2. Add musl package directories and metadata.
3. Make one target work first: `linux-x64-musl`.
4. Add Alpine smoke test in CI.
5. Add `linux-arm64-musl`.
6. Update docs after the matrix is green.

## Done Criteria

- Alpine x64 native package installs and resolves correctly.
- Alpine arm64 native package installs and resolves correctly.
- Release workflow publishes both musl packages.
- CI proves native path activation on Alpine for both `core` and `full`.
- Existing GNU and Darwin paths remain green.
