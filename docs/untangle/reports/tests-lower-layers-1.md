# tests-lower-layers-1 report

Result: 38 of 38 runnable files pass (612 tests), twice in a row. Files and edits are under `tests/` only.

## 1. Counts
- Test files: 41 -> 40 (removed `tests/embedding/embedding-perf.test.js`).
- `it` blocks: 635 (inventory) -> 623 (inventory minus removed; vitest ran 622 tests before and 612 after, the 3 files excluded by config are not counted in the vitest numbers).
  - db-utils 33 -> 31, native-resolver 28 -> 25, llm-provider 29 -> 24, embedding-perf 2 -> 0. Other files unchanged.

## 2. Removed
- `tests/embedding/embedding-perf.test.js` (both tests): rule 5 and 3. The vitest config excludes it, so it never ran. It also asserted only result length and 60 s / 300 s bounds. Result length is covered by `embedding-correctness.test.js`. Note: `docs/INDEXING_ARCHITECTURE.md` (line ~408) still names this file.
- `tests/infrastructure/llm-provider.test.js`, "Batch Processing" (3 tests): rule 3. They asserted only on arrays the test built itself.
- `tests/infrastructure/llm-provider.test.js`, "Provider Priority Logic" (4 tests) and "Retry Delay Calculation" (3 tests): rule 1. They tested a copy of the logic inside the test file. Replaced by tests on the real exports (see section 3).
- `tests/infrastructure/native-resolver.test.js`, "returns a string path or null" (twice, for `resolveNativeAddon` and `resolveNativeBinary`): rule 3 (`null || string` cannot fail).
- `tests/infrastructure/native-resolver.test.js`, "resolution order > prefers local dev path over packages/ path for addon": rule 4/3. It asserted nothing unless this machine was darwin-arm64 with a built addon, and it was CI-skipped. Replaced by a fixture test.

## 3. Rewritten
- `llm-provider.test.js`: the whole file defined its own copies of `isRetryable`, `calculateRetryDelay`, `generateStaticSummary`, `selectProvider`, `createSummaryPrompt` and imported nothing from product code (rule 1). Now it imports the real `isRetryable`, `generateWithRetry`, `generateStaticSummary`, `createSummaryPrompt`, `providers`, `RETRY_CONFIG` and `HCGS_CONFIG`. New behavior tests: retries with exponential backoff checked with fake timers (jitter bounds from `RETRY_CONFIG`), no retry on 4xx, last error after `maxRetries`, provider order (cloud first, static last), static provider output, token limits read from the config. The old static-summary and prompt cases are kept against the real functions. The old "prompt.length < 5000" became "no run of 2001 x characters".
- `db-utils.test.js` `applyReadPragmas`: four tests asserted which pragma strings a mock received (rule 1). Now two tests read `cache_size`, `mmap_size` and `temp_store` back from a real SQLite handle. The error-resilience tests (which need a throwing handle) are unchanged.
- `native-resolver.test.js`: "finds the local dev addon on darwin-arm64" depended on this machine's built addon. Now "prefers the local dev addon over the packages/ template addon" uses a temp root and the `rootDir` option.
- `coreml-provider.test.js`: `isAppleSilicon` and `shouldUseCoreML` tests computed the expected value from `process.platform` in the test (rule 1, host-dependent). They now fake the host (`process.platform` plus `os.arch`) and check darwin-arm64 -> true, darwin-x64 and linux -> false on any machine. Env-parsing tests also fake the host, so the "on" variants now really test the true branch on every machine.

## 4. Fixed flaky / environment dependent
- `rate-limiter-concurrency.test.js`: the file already used fake timers. The 20 s was CPU time: while a window is full the limiter polls every 1 ms (see section 7), so every simulated minute costs about 60 000 fake timers. Under load that exceeded timeouts. Cause fixed by using fewer simulated minutes: "never exceed RPM" 25 -> 15 requests (2 windows -> 1 window), "RPM=1" 3 -> 2 requests, which also now asserts the 60 s gap between the two grants. It still checks the same invariant (no 60 s window above RPM, still crossing one full window).
- `native-resolver.test.js` and `coreml-provider.test.js`: see section 3.

## 5. Speed (alone, `npx vitest run <file>`, runs taken close together)
- `tests/embedding/rate-limiter-concurrency.test.js`: 7.6 s -> 4.0 s and 4.2 s (the inventory's 20 s was taken under load). Remaining 3.6 s is two tests that simulate one 60 s window each at 1 ms polling.
- `tests/infrastructure/model-fetcher.test.js`: 4.4 s, unchanged. 3.0 s comes from "keeps the partial file after the last failed attempt" (real retry back-off 1 s + 2 s), 1.3 s from "aborts a stalled transfer" (1 s back-off). Faking `setTimeout` breaks the HTTP client (undici uses it), which made the test slower (6 s), so I reverted. See section 7.
- The whole package: 4.8 s and 6.3 s wall time for 38 files.
- Files that start a real server or HTTP client keep doing so (model-fetcher, shared-model-server).

## 6. Kept source-text tests
- `coreml-cascade-parity.test.js` "Rust source files use the exact same literal prefixes as the JS constants": reads `crates/.../embedding_model.rs` and `li_model.rs`. Contract: JS-vs-Rust parity of the CoreML cascade filename prefixes. The Rust side does not read the JSON, so no behavior can show a drift.
- Other flagged "READS_PRODUCT_SOURCE" files (`embedding-correctness`, `embedding-perf`, `embedding-telemetry`, `rescoring-fix-phase0`, `model-fetcher*`) only read files the test itself writes, or contain JS strings; they do not read product source.

## 7. Needs a product seam
- `model-fetcher.test.js` "keeps the partial file after the last failed attempt" (3.0 s) and "aborts a stalled transfer..." (1.0 s of 1.3 s): `RETRY_BASE_MS` in `core/infrastructure/model-fetcher.js` is a constant. An option such as `options.retryBaseMs` would make both near-instant.
- Product observation (not changed): `TimeWindowRateLimiter.acquire` in `core/embedding/embedding-remote.js` polls every 1 ms while the minute window is full. When the per-second window is empty, `_nextWaitMs` returns 1 ms instead of the minute wait. This burns CPU in production while the limiter waits. Computing the wait as the max of the blocking windows would fix it.

## Kept on purpose (not changed)
- Skips: dedup (`describe.skip` when the native dedup addon is absent) and `maxsim-native-parity` (when the native kernels are absent): optional-dependency gates. `maxsim-native-parity` is a kernel-vs-JS parity test, left unchanged. `model-fetcher-verification-cache` and the removed native-resolver one were CI filesystem gates; the former is kept (planted-sidecar tests cover the same logic deterministically in CI).
- `int8-stage2-rescore` "O(1) lookup": already min-of-5 batches with a 10 us bound; still catches a linear scan.
- `hardware-capability` host-conditional tests: each branch asserts on every host, no injection point exists in `detectHardwareCapability`. Kept.
- `model-registry` data tests: guard registry entries that the fetcher needs; kept.

## 8. Leftover processes
- None from my runs after the final run. During one earlier check, two daemons from other agents' tests were visible: PID 27434 (cwd under `/private/var/folders/.../T/ss-daemon-life-THe0oe`) and PID 27694 (cwd `/Users/admin/Projects/sweet-search-private`, age 1 s). Both were gone at the final check; not mine and not killed.
