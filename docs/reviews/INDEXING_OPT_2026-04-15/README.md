# Sweet Search — Indexing Optimization Review (2026-04-15)

**Date**: 2026-04-15
**HEAD**: `34089b2 fix(indexing): LI staged-save aliasing + 10 more swarm-review fixes`
**Scope**: commits `8be7e09..34089b2` on the full-indexing pipeline
**Audience**: Codex (human reviewer) — this file is the synthesis; specialist companion reports are in the same directory.
**Reviewers**: qe-queen-coordinator orchestrating six specialists run in parallel (read-only):
- `correctness.md` — code review of the 11 claimed fixes and new defects
- `performance.md` — claim verification, hot-path attribution, optimization gaps
- `security.md` — threat model, trust anchors, supply chain
- `integration.md` — DDD boundary compliance, barrel surface, cyclic audit
- `complexity.md` — file-size, cognitive hotspots, refactor seams
- `devils_advocate.md` — contrarian meta-review of the above
- `queen_synthesis.md` — system-level health, ship/hold decision

Incremental indexing (`incremental-tracker.js`, `merkle-tracker.js`, `index-maintainer.mjs`, `fullRebuild=false`) was explicitly excluded per user instruction.

---

## 1. Executive summary

The fix-pack moves the pipeline from *"two known data-integrity bugs in the hot path"* to *"no known data-integrity bugs in the hot path"*, which is a real qualitative jump. Nine of the eleven prior-review findings are cleanly resolved; the self-heal migration added in the C1 fix is genuinely elegant code; the H6 SHA256 stall fix (~2 min → ~1 s) is a meaningful production improvement; the CoreML cascade HF distribution path is well-designed (hardware-gated, atomic, checksum-verified, never blocks init); the H1 DDD violation is properly resolved with a slot pattern that keeps the dependency direction one-way.

**But the swarm found twelve new issues spanning correctness, performance, security, and integration**, three of which Codex should treat as blocking follow-ups within one release cycle:

1. **N1 (HIGH, correctness)** — `atomicSwapLateInteractionIndex` rollback path at `indexer-phases.js:108-111` is broken; on stub-swap failure after segments rename, the predicate `!existsSync(finalSegDir)` is always false, so rollback never executes. Torn state: old stub + new segments + original segments in `.bak`. Same severity class as the C1 bug it was meant to replace. Zero test coverage of the helper.
2. **Cross-language schema drift in `coreml-cascade.json`** — the JSON is consumed by JS + Python at format time, but the Rust filename parser at `embedding_model.rs:140` and `li_model.rs:127` uses hardcoded literal prefixes (`"nomic_bert_b"`, `"li_modernbert_b"`). A schema edit (model rename, variant rename) would silently disarm the cascade and lose the 18% gain with no failing test and no runtime warning. `INIT_STRATEGY.md`'s "single source of truth" claim is half-false.
3. **C1 verification-cache sidecar forgeable by same-user attacker** — `model-fetcher.js::isVerified` lines 100-127 trust a JSON sidecar's `sha256` field without re-hashing. Any local process with write access to the model cache dir can forge the sidecar and bypass SHA256 verification. The Rust loader at `embedding_model.rs:333` / `li_model.rs:333` provides no defense-in-depth (mmap without re-verify). The comment block at `model-fetcher.js:45-56` acknowledges this as an invariant but the code does not enforce it.

**Overall grade**: **B+** for the fix-pack as a piece of work; **C+** for the indexing pipeline as a system on this commit (the deferred items from the prior review still exist and the fix-pack's growth made file-size and duplicate-dispatcher problems modestly worse).

**Ship recommendation**: **SHIP** as a patch release. N1 has a 30-day SLA; the schema-drift and sidecar-forgery items have 60-day SLAs. The series is a net improvement and does not regress any previously-working boundary.

---

## 2. Commit series under review

```
34089b2 fix(indexing): LI staged-save aliasing + 10 more swarm-review fixes
3fa180c refactor(li): honor project-config excludes + collapse dir/file split
bde9b26 refactor(li): unify LI skip policy with FILE_PATTERNS.exclude globs
cf04213 feat(init): CoreML cascade HF distribution + hardware-aware init/uninstall
4fd9c9a feat(native): CoreML variant cascade + mlmodelc disk cache, 18% faster full index
504ad66 feat(native): Rust CoreML + Apple Neural Engine backend for NomicBERT + LI
b8816c1 perf(native): Float32Array napi return for embed + LI (~2× faster)
277f83f Revert "perf(native): fuse NomicBERT SwiGLU fc11+fc12 (~8% faster)"
c397dc4 [reverted]
1366903 perf(native): default Metal inference to BF16 — ~1.6x, no MRR regression
7aa15e8 fix(native): correctness fixes for Metal inference + CPU+GPU split opt-in
7470009 perf(embed): weights-aware cache budget for local embedding bucketer
ad09ab7 perf(li): weights-aware cache budget for long-seq batches → 1.7x tail speedup
059fffb perf(li): native Metal inference + LI skip policy + opt-in hybrid dispatcher
8be7e09 perf: eliminate BigInt allocations via Uint32Array overlay in tokenizer + ORT feed
```

Total: **8 files, +2969/-114 lines** in `34089b2` alone; ~5800 lines of JS + Rust source inspected across the series.

---

## 3. Verdict on each prior-review finding (`INDEXING_REVIEW_2026-04-14.md`)

| Prior # | Item | Verdict | Notes |
|---|---|---|---|
| **C1** | LI staged-save aliasing clobbers live segments | FIXED with caveats | New helper `atomicSwapLateInteractionIndex` is the right shape, `resetForSave({stagingSegmentDir, finalIndexPath})` works, stub basename strategy is correct. **But** the new helper's rollback path is broken (N1 below), and the 96-LOC self-heal migration is defensive theater for a population-of-one machine (see §4.2). |
| **C2** | `buildAndSaveFloatStore` undefined | FIXED | `artifact-builder.js:655,757` now call `buildAndSaveFloatStoreFromDb(db, ...)` with try/finally handle lifetime. **Caveat**: C2 was fixed *inside* `updateArtifacts` which has zero in-core callers — dead code fixed. The function should be deleted, not fixed. |
| **H1** | embedding→indexing DDD violation | FIXED | Duck-typed slot at `embedding-local-model.js:368-377`; construction moved to `indexer-pool.js:723-746`. Zero static or dynamic imports of `../indexing` from `core/embedding/`. `scripts/check-boundaries.js` reports "All domain boundaries clean." **Caveat**: type contract is informal — no JSDoc typedef, no runtime shape check. |
| **H2** | In-memory summary backup destroyed on crash | FIXED for the happy path | `summary-manager.js:68-188` persists to `{dbPath}.summaries.bak.json` via atomic `.tmp + rename`; crash-recovery via orphan detection works when live DB is empty or missing. **Caveats**: (a) N5 — partial-restore edge silently overwrites orphan when live DB has K<original summaries; (b) single `JSON.stringify(payload)` has a V8 ~512 MB string-limit ceiling for 200K+ symbol corpora; `late-interaction-index.js` already streams to avoid the exact same limit. |
| **H4** | tmp segments dir leaks on failed rebuild | FIXED | `cleanupStagedLateInteractionIndex` at `indexer-phases.js:60-66` now `rm -rf`s the staged segments dir. |
| **H6** | Per-worker SHA256 serialization stall | FIXED | Two-layer cache (in-process Map + on-disk sidecar) at `model-fetcher.js:58-140`; invalidation on atomic rename at line 304 is correct; pre-warm at `indexer-phases.js:448-462` complements it. **Caveats**: (a) the commit message conflates `596 MB LateOn-Code` with "worker pool contention" but native LI loads on the main thread — the actual stall site is workers loading `coderankembed-int8`; (b) the in-process Map layer is redundant with the pre-warm in the default pipeline; (c) trust model is weaker than the comment block claims — see §4.3 (security C1). |
| **M2** | `artifact-builder.js` used `process.cwd()` | FIXED | Lines 68, 88 use `path.resolve(PROJECT_ROOT, ...)`. |
| **M3** | Dynamic imports uncounted by `check-boundaries.js` | FIXED (Section 2 only) | Script at `scripts/check-boundaries.js:135-153` sums static + dynamic; cap raised from 2 to 6 with inline enumeration. **But**: the raise legalizes existing coupling rather than reducing it (M4 unification would have dropped it to 3), and a **separate pre-existing bug** in Section 4 of the same script makes external-barrel enforcement silently dead — see §4.5. |
| **M5** | HNSW stale checkpoint on throw | FIXED | `indexer-ann.js:446-511` wraps the build loop in try/finally; `buildCompleted` flag gates cleanup; DB handle closes in either path. |
| **L1** | `li-skip-policy.js` reached into config sub-module | FIXED | Line 31 now imports from `../infrastructure/config/index.js` barrel. |
| **L2/L3** | Indexing barrel under-exports | FIXED structurally | `core/indexing/index.js:58-79` explicitly exports `planAllocation`, `detectResources`, `EmbeddingPool`, `LateInteractionPool`, `initEmbeddingPool`, `shutdownEmbeddingPool`, `applyLiSkipPolicy`, `buildSparseGramArtifact`. **Caveat**: `tests/contracts/barrel-contracts.test.js` was not updated to assert these, so a `export *` shadow can silently un-export them without CI noticing. |
| **L4** | `SWEET_SEARCH_LI_ATTENTION_BUDGET` read in two places | SOFT-FIXED | Comment at `indexer-ann.js:158-168` clarifies env precedence but the two read sites remain (`indexer-ann.js:170` AND `indexer-pool.js:349`). |
| **L8** | Windows-path LI id split | FIXED | Regex `/:\d+-\d+:\d+$/` at `indexer-ann.js:626` is right-anchored and drive-letter safe. **Caveat**: silent fallback to `id` itself when the regex doesn't match (zero tests for `fileFromId`). |

**Net**: **13/13 attempted** (including H4 silently shipped despite not being in the commit's fix list); **9/13 cleanly resolved**; **4/13 have latent issues** (C1 rollback, C2 dead-code, H2 scale ceiling + N5, H6 doc/trust drift).

**Deferred per the fix-pack punchlist**: H3 (out of scope per our instructions), H5 (file-size decompositions, made worse by the fix-pack), M4 (three duplicate hybrid dispatchers), M6 (HNSW rowid gap on resume), M7 (binary HNSW atomic write), plus L5/L6/L7/L9 not mentioned in the commit message.

---

## 4. New defects (cross-validated across specialists)

Severity uses the commit's convention: **CRITICAL** (data integrity / data loss / exploit in hot path), **HIGH** (silent degradation, exploit under realistic threat, broken invariant), **MEDIUM** (correctness edge case, observability hole), **LOW** (cosmetic, latent, bounded).

### 4.1 — HIGH — N1: `atomicSwapLateInteractionIndex` rollback is broken

**File**: `core/indexing/indexer-phases.js:87-120`

```
102    try {
103      if (existsSync(stagedSegDir)) {
104        await fs.rename(stagedSegDir, finalSegDir);
105      }
106      await atomicSwapDatabase(stagedStubPath, finalStubPath);
107    } catch (err) {
108      if (hadOriginalSeg && existsSync(bakSegDir) && !existsSync(finalSegDir)) {
109        try { await fs.rename(bakSegDir, finalSegDir); } catch (_e) { /* best effort */ }
110      }
111      throw err;
112    }
```

**Failing trace**:
1. Line 98 (pre-try) succeeds: `finalSegDir → bakSegDir`; `hadOriginalSeg=true`.
2. Line 104 succeeds: `stagedSegDir → finalSegDir` — `finalSegDir` now contains NEW segments.
3. Line 106 `atomicSwapDatabase` throws (Windows EBUSY after the 5-attempt retry, OOM, process kill).
4. Catch at 108: `hadOriginalSeg=true` ✓, `existsSync(bakSegDir)=true` ✓, **`existsSync(finalSegDir)=true`** (the rename at 104 made it exist). Predicate is **false**. **Rollback does not execute.**

**Torn state**: OLD stub + NEW segments in `finalSegDir` + ORIGINAL segments in `bakSegDir`. The OLD stub's `segmentDir` basename resolves to `finalSegDir` → next loader reads the new manifest (different `totalDocuments`) against the old stub. **Silent data inconsistency** — no version check between stub and manifest catches it.

**Additional gap**: the helper does its own raw `fs.rename` for the segments dir at lines 98 and 104 with no EBUSY retry (N4). `atomicSwapDatabase` retries 5× but the segment-dir renames do not. Compounds N1 on Windows/SMB/WSL where concurrent readers hold handles inside `live.db.segments/*.bin`.

**Zero test coverage of the helper.** `tests/indexing/li-staged-save.test.js` exercises the `LateInteractionIndex` class round-trip but never constructs the torn-state scenario (monkey-patch `atomicSwapDatabase` to throw between segment-rename and stub-rename).

**Fix direction (do not implement in this review)**: swap the stub FIRST, then the segments dir. A failure mid-segments-rename leaves the new stub pointing at a missing dir, which the existing self-heal at `late-interaction-index.js:1779-1793` migrates from `bakSegDir` (after extending the heal to look there). Alternatively, rename `finalSegDir → finalSegDir.failed-swap` before raising and restore from `bakSegDir` in the catch. Add a test that monkey-patches `atomicSwapDatabase` to throw and asserts full restoration.

**Why HIGH**: same severity class as the C1 bug it was meant to replace — silent data inconsistency, realistic triggers, zero CI coverage.

### 4.2 — HIGH — Cross-language schema drift in `coreml-cascade.json`

**Files**: `core/infrastructure/coreml-cascade.json:2,8,9`; `crates/sweet-search-native/src/inference/embedding_model.rs:140`; `crates/sweet-search-native/src/inference/li_model.rs:127`; `docs/INIT_STRATEGY.md` Phase 8 section.

The cascade spec JSON declares `filePattern: "nomic_bert_b{batch}_s{seq}_fp16.mlpackage"`. JS at `core/infrastructure/coreml-cascade.js:108-112` formats this with `pattern.replace('{batch}', ...).replace('{seq}', ...)`. Python (`scripts/spike-coreml/trace_cascade.py`) reads the same field. **The Rust addon does not read `filePattern`** — it uses hardcoded literal prefixes `"nomic_bert_b"` and `"_fp16.mlpackage"` (embed side) and `"li_modernbert_b"` (LI side).

The files happen to match because the convention is maintained by code review, not by code. A future maintainer who edits the JSON to rename a variant (e.g., `nomic_bert_v2`, `li_modernbert_short`) without coordinating a Rust release would **silently disarm the cascade**. The Rust parser would scan the cascade dir, find no matching files, and fall back to candle. The 18% gain evaporates. The only log line is a soft warning (`embedding_model.rs:114-119`) that is easy to miss in production logs.

**There is no schema validator, no JSON schema, no integration test that round-trips a formatted filename through the Rust regex, and no startup check that asserts the JSON's `filePattern` prefix matches what Rust looks for.**

`INIT_STRATEGY.md` Phase 8 claims *"Single source of truth for the shape set: core/infrastructure/coreml-cascade.json. Both the JS cascade module and scripts/spike-coreml/trace_cascade.py read this file so the shapes traced during a local build always match the shapes the Rust filename parser ... looks for on disk."* — the last clause is **not accurate**. Rust doesn't read the file at all.

**Fix direction**: add a 5-line parity test (`tests/infrastructure/coreml-cascade-rust-parity.test.js`) that loads the JSON, formats one variant, and asserts the prefix matches the Rust regex hardcoded in `embedding_model.rs:140`. OR add a schema validator in `getCascadeSpec()` that checks `filePattern.startsWith('nomic_bert_b')` and the LI equivalent. OR rewrite the Rust parser to receive the pattern from JS via an FFI call (most work, highest correctness).

**Why HIGH**: silent failure mode with a clean blast radius (loses 18% perf) and a direct trust-topology concern (the JSON becomes a cross-language contract that none of the three languages enforces).

### 4.3 — CRITICAL (security) — H6 verification-cache sidecar is forgeable

**File**: `core/infrastructure/model-fetcher.js:100-127` (`isVerified`).

`isVerified` returns `true` based on three-field comparison (`sidecar.sha256 === expectedSha256 && sidecar.size === stat.size && sidecar.mtimeMs === stat.mtimeMs`). It does **not** re-hash the file contents. An attacker with same-user write access to `~/.cache/sweet-search/models/<model>/` (a compromised VS Code extension, a malicious `postinstall` in a transitive dep, a sandboxed editor task) can:

1. Write a malicious `model.safetensors` of any content.
2. Write `model.safetensors.verified.json` with `{"sha256":"<registry_hash>","size":<malicious_size>,"mtimeMs":<malicious_mtime>,"verifiedAt":1}`. The registry hash is **public** in `core/infrastructure/model-registry.js`, reviewed via git.
3. On the next sweet-search invocation, `isCacheValid` calls `isVerified`, the three-field comparison succeeds, and line 181's stream-hash is skipped. The Rust loader mmaps the malicious bytes at `embedding_model.rs:333-337` / `li_model.rs:333-337` with no re-verification.

**The comment block at `model-fetcher.js:45-56` claims**: *"The cache never skips verification against a NEW expected hash, only against a previously-verified hash for an unchanged file."* This is true *if* the sidecar is written only by `recordVerified`, but the sidecar is a plain JSON file in a user-writable directory — it can be forged. The comment conflates *"cached fact about a previous verification"* with *"sidecar contents on disk"*.

**Impact**: Silent code-search quality regression (adversarial embeddings degrade retrieval without triggering any MRR alarm), plus parallel attack surface on the mlmodel parser in `coreml_shim.m` for the CoreML cascade path. The safetensors loader in candle has had memory-safety bugs historically; mmap'ing attacker-controlled bytes that pass no cryptographic check enlarges that surface.

**Why CRITICAL**: the security specialist flagged this as a CRITICAL because the H6 fix introduced a memoization optimization that is **exploitable as a trust anchor** given the loader path's zero defense-in-depth. The bar (A1: same-user write) is moderate on a developer workstation.

**Fix directions** (security specialist, prioritized):
1. **Rust loader re-verifies SHA256 before mmap** at `embedding_model.rs::load` and `li_model.rs::load` — the expected hash is already in the registry; thread it through. Defense-in-depth that survives any Node-side cache compromise.
2. **HMAC the sidecar** with a per-install secret in `.sweet-search/install-secret` (mode 600). Local attacker cannot forge without reading the secret.
3. **At minimum**, add `(dev, inode)` to the cache key. Local attackers replacing files via `unlink + write` get a new inode; `stat.ino !== sidecar.ino` invalidates.
4. Update the `model-fetcher.js:45-56` comment to describe what the cache actually guarantees (memoize a previously-verified file as long as `(size, mtime)` is unchanged; not a trust anchor).

### 4.4 — HIGH (security) — Tarball decompression bomb in `extractVariantTarball`

**File**: `core/infrastructure/coreml-cascade.js:417-462`.

`fetchModelFile` verifies the tarball's **compressed** download size and SHA256 against `coreml-cascade.json`. `extractVariantTarball` then runs `tar -xzf <tarball> -C <stagingDir>` with **no extracted-size cap**. A malicious tarball (requires A4 HF-repo compromise OR A3+A4 chain) with a high compression ratio — say, 250 MiB compressed → 2 TiB extracted — fills the disk before the "exactly one top-level entry" check at line 438 runs.

bsdtar's default refusal to extract `..` / absolute / symlinked entries DOES mitigate the classic path-traversal case, and the cascade fetch is hardware-gated to `darwin-arm64` at `hardware-capability.js:113-129` so GNU tar (with different defaults) never runs this path. **Verified safe** for path traversal; **not** mitigated for extraction bomb.

**Fix direction**: switch to the `tar` npm package (which supports `maxBytes`), or pre-flight `tar -tzvf | awk` size sum, or sum the `tarballSizeBytes` from the spec and refuse to extract if that × 10 > free disk space (`statvfs`).

### 4.5 — HIGH — `check-boundaries.js` Section 4 (external barrel enforcement) silently dead

**File**: `scripts/check-boundaries.js:196-251`.

A shell-escape bug makes the external-bypass check a no-op. The grep template literal embeds a character class `[^'"]` inside a double-quoted shell argument:

```js
`grep -rn --include='*.js' --include='*.mjs' -E "from ['\"].*core/${domain}/[^'\"]+['\"]" tests/ scripts/ ...`
```

JavaScript escapes `'\"'` to `"`, producing shell text `grep ... -E "from ['"].*core/.../[^'"]+['"]" ...`. The unescaped `"` terminates the double-quoted argument early; shell emits `bad pattern: from ['].*core/.../[^"]+[]`. The script swallows this with `2>/dev/null || true`, so `result` is empty for every domain.

**Independent grep confirmed 39 hidden external bypasses**, including:
- `scripts/uninstall.js:19` reaching directly into `core/infrastructure/coreml-cascade.js` (NEW bypass introduced by `cf04213`; `scripts/init.js:23` goes through the barrel correctly — one-line divergence)
- `scripts/spike-coreml/*.js` (6 files) reaching into `native-tokenizer.js` / `native-inference.js`
- `tests/diagnose-metal-*.js` (5 files), `tests/diagnose-hybrid-*.js`, `tests/diagnose-cpu-*.js`, `tests/native-li-accuracy.js`, `tests/native-inference-accuracy.js` reaching into `core/ranking/late-interaction-model.js`
- `tests/indexing/li-staged-save.test.js:28` reaching into `core/ranking/late-interaction-index.js` (allowlisted for `indexing/` but not `ranking/`)
- `eval/scripts/maxsim-quant-correlation.js:16`, `eval/scripts/grep-latency-bench.js:27`

The bug **pre-exists `8be7e09`** — it is not a regression — but `DDD_ARCHITECTURE.md:264-275` claims four checks run. Only three actually find anything. The fix-pack was blind to the broken check, and so is CI.

**Fix direction** (follow-up): replace the template literal with a single-quoted shell argument that does not require JS-side escape:
```js
const cmd = `grep -rn --include='*.js' --include='*.mjs' -E 'from ["\\x27].*core/${domain}/[^"\\x27]+["\\x27]' tests/ scripts/ eval/ mcp/ bin/ 2>/dev/null || true`;
```
Or drop `execSync` for Section 4 entirely and walk the filesystem with `node:fs` + apply the regex in-process.

**Why HIGH**: the "0 BARREL BYPASS" line that `check-boundaries.js` reports is **fictitious**. CI has no ability to catch regressions on external boundary compliance, meaning any of the 39 hidden bypasses could double or triple without noise.

### 4.6 — HIGH (performance) — Stale `LI_DTYPE_BYTES` constant vs actual Rust dtype

**File**: `core/indexing/indexer-pool.js:320-333`.

The comment block claims:

> Native LateOn-Code is loaded as F32 (per the native correctness fix — F16 corrupted MRR via mask saturation), so the dtype here is 4 bytes for both weights and activations.

**But** `li_model.rs:330` calls `optimal_dtype(&device)` which returns BF16 on Metal per `mod.rs:96-112`. The `LI_DTYPE_BYTES = 4` constant used by the cache-aware L2 budget computation at `indexer-pool.js:339-346` is **wrong** — it should be 2 for BF16 weights, OR the Rust loader should pin LI to F32 to match the comment.

Current impact on M3 Max (L2=16 MB): `perLayerWeightBytes = 12 × 768² × 4 ≈ 27 MB > 16 MB L2 → usableCache=0 → B=1`. With dtype-bytes=2, `perLayerWeightBytes ≈ 13.5 MB < 16 MB → usableCache≈2.5 MB → B≈1` anyway (still rounds to 1). **The cap formula gives the same answer today for completely different reasons**, so there is no visible regression on this dev box. On larger L2 chips (future M-series with more cache per cluster), the dtype mismatch could cause silent under-batching.

The bigger problem is the foundation: the `ad09ab7` commit's "1.7× tail speedup" claim is built on this formula, and the formula's dtype is wrong. The claim is unverified end-to-end anyway (the microbench file that supposedly validated B=1 is not in `tests/diagnose-*`), but now the arithmetic backing the claim is suspect.

**Fix direction**: pick one — either (a) fix `LI_DTYPE_BYTES = 2` and update the comment, or (b) pin LI to F32 in `li_model.rs::load` and document why LI keeps F32 while embed moves to BF16. Then re-measure the tail speedup on the current machine.

### 4.7 — HIGH (performance) — Hybrid CPU+GPU dispatcher has no runtime guard

**Files**: `core/indexing/indexer-ann.js:670-861`; `core/indexing/indexer-phases.js:326-600`.

The hybrid dispatcher at `indexer-ann.js:670-861` is opt-in via `SWEET_SEARCH_LI_HYBRID=1`. The comment at lines 680-689 explicitly documents the constraint: *"in the default pipeline (parallel embedding + LI phases) the GPU device queue is shared, and the embedding phase's continuous Metal command stream effectively starves the LI GPU encoder"*. The constraint requires **also** setting `SWEET_SEARCH_PARALLEL_LI=0` AND bumping the libuv pool.

**There is no runtime enforcement**. A user who sets `SWEET_SEARCH_LI_HYBRID=1` in isolation (without reading the comment) ends up with the hybrid dispatcher running against a default-parallel pipeline where the Metal queue is contended. Best case: silent underperformance. Worst case: hang — `tests/diagnose-hybrid-hang.js` exists as a smoking gun (the file name itself).

**Additional concerns** caught by the performance specialist:
- The meet-in-middle algorithm assumes a unimodal length distribution. For bimodal distributions (many short chunks + a few huge generated files), the CPU sits idle for most of the run while GPU chews the middle. No histogram check before deciding to hybrid.
- CPU encoder and GPU encoder have different warmup costs (ORT compiles on first call, ~3-5 s; candle Metal first dispatch ~1-2 s). No pre-warm before the cursor enters; the first CPU batch eats the warmup on the critical path.
- `finalizeBatchResults` at `indexer-ann.js:769-792` is a single-threaded JS step inside `liIndex.add` — with the cursor running at near-saturation, the finalizer becomes the actual bottleneck because both encoders wait for the previous finalize before the next.

**Fix direction**: add a guard at the top of the `if (!hybridDisabled)` block:
```js
if (hybridEnabled && EMBEDDING_CONFIG.parallelLateInteraction) {
  log('LI hybrid: ignored — SWEET_SEARCH_LI_HYBRID requires SWEET_SEARCH_PARALLEL_LI=0', 'yellow');
  // Fall through to single-encoder path
}
```

### 4.8 — MEDIUM — `projectRoot` not threaded from `indexer-phases.js` to LI build (3fa180c regression)

**Files**: `core/indexing/indexer-phases.js:473-490`; `core/indexing/indexer-ann.js:534`; `core/indexing/li-skip-policy.js:50`.

Commit `3fa180c` added `projectRoot` as an option to `buildLateInteractionIndex` with the comment *"honored by LI skip policy for .sweet-search.config.json excludes"*. Inside the function, `applyLiSkipPolicy(chunks, { projectRoot })` is called at line 551. **But** the only caller of `buildLateInteractionIndex` is `indexer-phases.js:473-490`, and that call **does not pass `projectRoot`**. Fall-through: `applyLiSkipPolicy({projectRoot: undefined}) → loadProjectConfig(undefined || process.cwd())`.

For `sweet-search index` invocations launched from the project root, this works (`process.cwd() === PROJECT_ROOT`). For any invocation from a different cwd (CI runners that `cd` elsewhere, MCP tool callers, editor hooks, future daemon modes), **the LI skip policy silently loads the wrong config or no config**. The embedding indexer sees `PROJECT_ROOT` correctly (`indexer-utils.js:482` uses `projectRoot = PROJECT_ROOT` default), so **embed and LI may now disagree about which files are skip-listed**, defeating the entire point of the `bde9b26` unification.

`indexer-phases.js:10` already imports `PROJECT_ROOT` from infrastructure config, so the fix is a one-line addition to the options bag at line 473: `projectRoot: PROJECT_ROOT`.

### 4.9 — MEDIUM — `initEmbeddingPool` TOCTOU race can leak a pool

**File**: `core/indexing/indexer-pool.js:723-730`.

```js
export async function initEmbeddingPool(options = {}) {
  const existing = _getEmbeddingPoolSlot();
  if (existing) return existing;
  const pool = new EmbeddingPool(options);
  await pool.init();
  _setEmbeddingPoolSlot(pool);
  return pool;
}
```

Two concurrent callers see `existing=null`, both construct pools, both await `pool.init()`. First setter wins; second setter overwrites — first pool's workers are leaked. Production impact today is zero (single call site at `indexer-phases.js:421`), but the function is exported via the indexing barrel and documented "idempotent". Compare `getNativeEmbeddingModel` at `native-inference.js:140-182` which correctly memoizes the in-flight promise — same pattern needed here.

### 4.10 — MEDIUM — H2 disk backup overwritten when live DB has a partial restore

**File**: `core/graph/summary-manager.js:162-188`.

The orphan-recovery branch at line 162 only fires when `summaries.length === 0`. Scenario:
1. Run #1 backs up 100 summaries to disk. `restoreSummaries` commits 80 (20 entities removed in a schema change). Process crashes after commit but before unlink.
2. Run #2: live DB has 80 summaries. `orphan.count=100`. Line 162 check fails (80 ≠ 0). Falls to the live-DB path. `writeDiskBackup` overwrites the 100-summary orphan with the 80-summary backup. **The 20 unrestorable summaries are gone from the recovery surface forever.**

If the user reverts the offending code change before re-running, the 20 entities would exist again but their summaries are gone.

Also in the same file, H2's single `JSON.stringify(payload)` call at line 79 with base64-encoded `summary_embedding` blobs has a **V8 ~512 MB string-limit ceiling** for 200K+ symbol corpora — and `late-interaction-index.js` already streams documents to avoid the exact same limit (see the comment at `late-interaction-index.js:1456-1457`). **The fix-pack reintroduced the pattern its sibling works around.**

### 4.11 — MEDIUM — H6 cache documentation + redundancy

**File**: `core/infrastructure/model-fetcher.js:45-56, 100-127`.

Two issues:
1. **Doc overclaim**: the comment block claims to "preserve INIT_STRATEGY.md's guarantee that 'all artifacts are verified with SHA256 checksums'". The implementation defines "unchanged" as a stat-MAC, not a cryptographic check. See §4.3 for the exploit path and the rephrase.
2. **Redundancy with pre-warm**: the in-process Map cache is dead code for the default Metal pipeline. The pre-warm at `indexer-phases.js:448-462` serializes SHA256 verification on the main thread before workers spawn, so worker_threads never race the hash. The disk sidecar is load-bearing for the **cross-process re-run** case (back-to-back `sweet-search index` calls) and the **ORT CPU worker pool** case (`SWEET_SEARCH_EMBED_USE_CPU=1` spawns N workers each loading `coderankembed-int8`). The commit message conflates these with the 596 MB native LateOn-Code fetch, which loads on the main thread and is covered by the pre-warm — the cited "worker pool contention" pathology is for `coderankembed-int8` (~250 MB), not LateOn-Code.

The fix is correct; the messaging is misleading. The commit message should describe what each layer actually catches.

### 4.12 — LOW — Tight `indexing → ranking` cap, zero headroom

**File**: `scripts/check-boundaries.js:40`.

`max: 6` and current count is exactly 6:
- `indexer-phases.js:25` static `late-interaction-model.js` (configureLateInteractionRuntime etc.)
- `indexer-ann.js:11` static `LateInteractionIndex`
- `indexer-ann.js:706` dynamic `late-interaction-model.js` (hybrid probe)
- `indexer-ann.js:745` dynamic `late-interaction-model.js` (single-encoder fallback)
- `indexer-pool.js:695` dynamic `late-interaction-model.js` (LI pool fallback)
- `indexer-worker.js:98` dynamic `late-interaction-model.js` (worker entrypoint)

**A 7th import would break CI.** The cap was raised 2→6 in the fix-pack because M3's dynamic-import counter discovered 4 previously-uncounted sites — i.e., **the raise counted the existing coupling, it did not reduce it**. M4 (unify the three duplicate hybrid dispatchers) would eliminate 3 of the 6 sites and was explicitly deferred.

CI should warn at `n >= max - 1` so devs know they're one coupling away from breaking. Better fix: the LI runtime exposes a single facade (`liRuntime.encode`, `liRuntime.configure`) so the four dynamic fallbacks collapse to one site. A symmetric slot pattern in `core/ranking/late-interaction-model.js` (mirroring H1's solution) would let `indexer-pool.js` install its `LateInteractionPool` once and drop the coupling surface from 6 to 4.

### 4.13 — LOW — Several leaks the specialist swarm caught

- **N6**: `cleanupStagedLateInteractionIndex` at `indexer-phases.js:60-66` doesn't remove `DB_PATHS.lateInteraction + '.segments.bak'`, which `atomicSwapLateInteractionIndex` creates at line 98. Each failed swap leaks hundreds of MB of stale segments.
- **N7**: unconditional `rmDirIfExists(finalStubPath + '.tmp.segments')` at lines 117-119 races stale concurrent processes during the migration window. Gate on mtime or drop once users have upgraded.
- **N8**: `readDiskBackup` at `summary-manager.js:83-103` checks `Array.isArray(parsed.summaries)` but not the `version` field. A future v2 format would deserialize incorrectly. Writer already sets `version: 1`; reader should check.
- **L8 silent fallback**: `fileFromId` at `indexer-ann.js:626-631` returns `id` itself when the regex doesn't match. The caller then checks `filesToRemove.includes(docFile)` — which can never match a chunk ID against a file path. **Zero tests for `fileFromId`.**
- **No fsync in LI save path**: `late-interaction-index.js:1459-1685` — `grep fsync` returns 0 hits. The atomic-swap crash-safety claim assumes POSIX rename atomicity, which may not hold on NFS/SMB. `fs.rename` returning success does not mean bytes are durable.
- **`_internals.resetCache` never fires in long-running processes**: `li-skip-policy.js:44-63` caches exclude lists keyed by `projectRoot`. In a daemon mode, new project roots grow the Map unbounded. Not currently a daemon; note for future agentic work.

---

## 5. Well-done fixes (honest praise)

- **`late-interaction-index.js:1706-1793` self-heal migration**: the two-pass migration is elegant. First pass catches the documented `.tmp.segments` absolute-path state; second pass catches the missing-canonical-dir + orphan case. Both guard with `existsSync(canonicalSegDir)` before stub rewrite. Both use `writeStubAtomic` (1745-1754) which writes to `.selfheal.tmp` and renames, so a crash mid-heal cannot leave a truncated stub. `maybeMigrate` at 1726-1741 tolerates ENOENT/EEXIST/ENOTEMPTY/EPERM but does not swallow other errors. Race-safe across concurrent loaders via POSIX `fs.rename` atomicity. **Caveat from the devil's advocate**: after the original dev box is healed (which it is — current `.sweet-search/codebase-late-interaction.db` confirms), the self-heal runs on every load forever for a population of one. Strip it in the next cleanup pass, OR snapshot the actual broken state as a test fixture so the code justifies its existence.
- **`artifact-builder.js:751-760` try/finally around the secondary DB open** is the right pattern: open, apply pragmas, work in try/finally, close in finally. (Caveat: the fix lives inside `updateArtifacts` which has zero in-core callers — the function should be deleted, not fixed.)
- **Two-layer H6 SHA256 cache layering** (`model-fetcher.js` + pre-warm at `indexer-phases.js:448-462`) is genuinely fast (~2 min → ~1 s under worker-pool contention). The invalidation order at line 304 (invalidate → rename → record) is correct. The trust model caveat does not change the fact that the latency win is real.
- **`scripts/check-boundaries.js:135-153` dynamic-import counting** in Section 2 is clean. The cap raise 2→6 is correct, not a workaround.
- **`indexer-ann.js:626` right-anchored regex** handles Windows drive letters correctly and passes through legacy IDs; the comment explains why `split(':')[0]` would have been wrong.
- **Commit `b8816c1` Float32Array napi return** is the honest commit of the series: clean A/B benchmark, newer run first to equalize cache/thermal, baseline measured. It also silently fixed an l2_normalize NaN poisoning bug on fully-padded batch rows — a detail not flagged in the commit bullet but a real correctness win. **Follow-up**: `native-inference.js:248-249, 341` use `.slice(i*dim, ...)` which is a copy, not a view — switching to `.subarray()` recovers another 200-500 ms. 5-line PR, no risk.
- **`hardware-capability.js` + `coreml-cascade.js` design**: the "cascade is ALWAYS optional" invariant is properly enforced; every error path in `fetchCoremlCascade` returns a status rather than throwing; uninstall enumerates cleanup paths via `getAllCoremlCachePaths()` so future cache additions don't silently leak. **49 new tests** (24 for hardware-capability, 25 for coreml-cascade) with good coverage of eligibility, spec loading, env opt-out, and synthetic cache states.
- **The fix-pack commit message is honest**: the "Deferred to follow-up refactors" section explicitly names H3 (out of scope), H5 (file-size), M4 (duplicate dispatchers), M6/M7 (HNSW robustness). It does silently ship H4 (cleanup leak) without mentioning it in the fix list — inverse drift, which is fine.

---

## 6. Performance claim verification

From the performance specialist's claim-verification table:

| Commit  | Claim | Verified? | Confidence |
|---|---|---|---|
| `c1f7ac9` | 14.8% speedup from ORT thread spinning/warmup | NO (pre-scope) | — |
| `8be7e09` | BigInt elimination via Uint32Array overlay | PARTIAL | MEDIUM-HIGH — real change, no microbench in tree |
| `059fffb` | Native Metal LI + skip policy + opt-in hybrid | PARTIAL | MEDIUM — hybrid has no stand-alone benchmark, `diagnose-hybrid-hang.js` is a tell |
| `ad09ab7` | L2-aware long-seq cap → 1.7× tail speedup | PARTIAL | MEDIUM — microbench file not in tree, inline claim of 2.13× does not match 1.7× headline |
| `7470009` | Cache budget in local embed bucketer | YES | HIGH — symmetrical change, follows LI |
| `7aa15e8` | Metal correctness fixes | YES | HIGH — `prepare_4d_attention_mask` uses -1e4, SDPA gated on seq_len>8, MRR 25% → 97% story |
| `1366903` | BF16 default → 1.6× index, no MRR regression | PARTIAL | HIGH direction, MEDIUM magnitude — **commit says 1.6×, code comment `mod.rs:74-75` says 1.32×/1.36×, gencodesearchnet shows 1.20×/1.32×**. Contradiction. |
| `277f83f` | Revert of SwiGLU fusion | N/A — reverted | — |
| `b8816c1` | Float32Array napi return → ~2× | PARTIAL | MEDIUM-HIGH — microbench embed b32×s512 1974→996 ms (1.98×), LI b32×s2048 26289→12157 ms (2.16×). Clean A/B. |
| `504ad66` | Rust CoreML + ANE | YES | HIGH — code exists, parity check at startup with cosine ≥ 0.998 |
| `4fd9c9a` | CoreML cascade → 18% faster | NOT VERIFIABLE | LOW — no benchmark file, dispatch-stats gated behind `SWEET_SEARCH_COREML_STATS=1` |
| `cf04213` | HF distribution + hardware-aware init | YES | HIGH — correct atomic extract path, SHA256 verification, partial-cascade arming |
| `34089b2` | ~2 min saved on cold starts | PARTIAL | MEDIUM — H6 + pre-warm are tightly coupled; the cited stall path is for workers loading `coderankembed-int8`, not for `LateOn-Code` (commit message conflates) |

**The BF16 1.6× magnitude contradiction is the single most important unresolved number.** Codex should decide which is authoritative and update the other.

**`gencodesearchnet` language coverage gap**: the benchmark covers **go, java, javascript, php, python, ruby** — no Rust, C, C++, Swift. Sweet-search is JS+Rust and serves code-search on arbitrary languages. A proper "no MRR regression" claim needs at least one Rust-heavy benchmark run. None exists in `eval/corpus/`.

### Current hot-path attribution (estimated, M3 Max 128 GB / ~16 K chunks)

| Phase | Est % wall | Confidence |
|---|---:|---|
| Parallel: vector embed (NomicBERT candle BF16) | ~28% | HIGH |
| Parallel: late interaction (ModernBERT candle BF16 OR CoreML cascade) | ~22% | MEDIUM |
| HCGS summary regen (parallel) | ~8% | LOW |
| HNSW build + checkpoint | ~8% | MEDIUM |
| **LI staged save + segment writes** | **~10%** | MEDIUM-HIGH — bigger than expected, serial I/O at tail |
| Binary HNSW + Int8 + Float store (serial) | ~8% | MEDIUM |
| Sparse gram | ~3% | LOW |
| Pre-warm + native model load + CoreML compile | ~3% | MEDIUM |
| Vocab warmup (post-phase serial) | ~5% | LOW-MEDIUM |
| Tokenization + chunking | ~4% | MEDIUM |

**Biggest opportunity**: the LI segment save phase runs serial after Metal is idle.

### Missed optimizations (concrete, with expected gain)

1. Parallelize segment write loop via `Promise.all` at `late-interaction-index.js:1543-1558` — **-500 ms to -1 s**.
2. Parallelize artifact-builder writes (HNSW + int8 sidecar + float store) at `artifact-builder.js:649-655` — **-1 to -2 s**.
3. Switch `.slice()` to `.subarray()` in `native-inference.js:248-249, 341` — **-200 to -500 ms**.
4. Pre-warm CPU encoder before hybrid cursor enters loop — **-3 to -5 s on first hybrid run only**.
5. Move `liIndex.add` into a per-segment queue worker so finalize overlaps with next encode — **-300 to -800 ms**.
6. Overlap `_flushSegment` with subsequent encodes via promise queue — **-300 to -500 ms**.
7. Run `runFullWarmup` in parallel with artifact build — **-2 to -5 s**.
8. Add 2 more CoreML cascade variants in the empty `(32, 200-400)` gap — **-1 to -3 min on full index** (depends on dispatch stats).
9. Investigate the SwiGLU fc11+fc12 fusion revert — **-1 to -3 min** if it was a parity-threshold artifact.
10. Fix `LI_DTYPE_BYTES` constant so cache-cap math reflects BF16 — correctness, not perf.
11. Add runtime hybrid guard (see §4.7) — prevents catastrophic regressions.

Total realistic perf gain from items 1, 2, 3, 5, 6, 7: **~3-6 s**, cumulative ~0.2-0.4% on a 28 min target but cumulative ~5% if everything lands. Items 8 and 9 are the bigger levers if confirmed.

---

## 7. Observability gaps — still open after the fix-pack

The prior review flagged 7 gaps. The fix-pack addressed **zero** (it was scoped to correctness, DDD, and one perf win). The Queen specialist identified **3 new gaps** the fix-pack introduced:

| # | Gap | Status |
|---|---|---|
| 1 | HCGS regen silent failure → dim log, pipeline continues | STILL OPEN |
| 2 | Quantized artifact silent failure → yellow log, falls back to float HNSW | STILL OPEN |
| 3 | Vocab warmup dim log only | STILL OPEN |
| 4 | LI profiling opt-in only (`SWEET_SEARCH_LI_PROFILE=1`) | STILL OPEN |
| 5 | Sparse gram single log line, no throughput | STILL OPEN |
| 6 | HNSW checkpoint `dim`-level logging | STILL OPEN |
| 7 | Atomic swap retry success not logged | STILL OPEN |
| **NEW 1** | H6 SHA256 cache hit/miss not logged | OPEN |
| **NEW 2** | Cascade `partial-embed-only` / `partial-li-only` not rendered in `init.js:271-285` | OPEN |
| **NEW 3** | LI self-heal migration uses `console.warn`, bypasses `log()` / `--quiet` | OPEN |

**Recommendation**: `printSummaryPhase` at `indexer-phases.js:640-706` emits a quiet-mode JSON with `{success, filesProcessed, entities, relationships, chunks, embeddings, durationSeconds, mode}`. Extend it to include per-phase status: `{hcgs: {status, generated, error}, quantizedArtifacts: {status, binaryHnswVectors, int8Count, fallback}, lateInteraction: {status, selfHealed, added, removed}, cascade: {status, dispatched, fellThrough}}`.

---

## 8. INIT_STRATEGY.md compliance

| Invariant | Status | Evidence |
|---|---|---|
| All hardware-gated fetches gated | PASS | `coreml-cascade.js::fetchCoremlCascade:533-543` checks `detectHardwareCapability` first |
| Atomic writes on tarballs | PASS | `extractVariantTarball:417-462` stages via `${target}.staging-${pid}-${ts}` + `renameSync` |
| Resumable downloads | PASS | `model-fetcher.js:236-251` honors `Range` header on `.tmp` file |
| SHA256 on every downloaded artifact | PASS (with caveat) | `fetchModelFile` streams hash post-download at line 294; H6 cache memoizes prior positive results only — **but trust model weaker than claimed** (§4.3) |
| No env-var bypass of SHA256 | PASS | only `SWEET_SEARCH_COREML_CASCADE=0` disables the whole cascade, never skips verification |
| Cache root override honored | PASS | `MODEL_DELIVERY_CONFIG.modelCacheRoot` + `getCoremlCascadeRoot` |
| Uninstall cleans the cascade | PASS | `scripts/uninstall.js:128-143` calls `getCoremlCascadeRoot()` + `rmSync` recursive |
| Cascade never blocks init | PASS | every error path returns a status and logs; `try/catch` wraps the fetch call |
| Single source of truth `coreml-cascade.json` for shapes | **FAIL — silent gap** | Rust hardcodes prefixes (§4.2); INIT_STRATEGY.md claim is half-false |
| `coreml-cascade.json` schema validation | **FAIL — silent gap** | `getCascadeSpec()` does `JSON.parse(raw)` with no schema check |

**Two of eight Phase 8 contracts are honored by convention, not by code.**

---

## 9. DDD compliance

`scripts/check-boundaries.js` exit code 0, all hard direction rules clean. `grep -rn "from '../indexing" core/embedding/` returns zero hits (static AND dynamic). **H1 is genuinely fixed.**

| Check | Status |
|---|---|
| Hard direction rules | CLEAN |
| `indexing → ranking` exception cap | AT CEILING (6/6, zero headroom) |
| Internal barrel bypass warnings | 44 (unchanged) |
| External barrel enforcement (Section 4) | **SILENTLY DEAD** (§4.5) — 39 hidden bypasses |
| Cyclic dependencies | NONE — confirmed via targeted grep |

**File-size breach update** (CLAUDE.md: <500 lines). 7 → **9 breaches** (2 new, 4 prior grew further):

| File | Prior | Current | Δ | ×500 |
|---|---:|---:|---:|---|
| `core/ranking/late-interaction-index.js` | 2162 | **2311** | **+149** | 4.6× |
| `core/indexing/artifact-builder.js` | 1059 | **1054** | -5 | 2.1× |
| `core/indexing/indexer-ann.js` | 903 | **951** | **+48** | 1.9× |
| `core/embedding/embedding-local-model.js` | 819 | 845 | +26 | 1.7× |
| `core/ranking/late-interaction-model.js` | 812 | 812 | 0 | 1.6× |
| `core/indexing/indexer-pool.js` | 696 | **746** | **+50** | 1.5× |
| `core/indexing/indexer-phases.js` | 627 | **706** | **+79** | 1.4× |
| `core/infrastructure/coreml-cascade.js` | — | **645** | **NEW** | **1.3× NEW** |
| `core/graph/summary-manager.js` | <500 | **542** | **NEW** | **1.1× NEW** |
| `core/indexing/ast-chunker.js` | 709 | 709 | 0 | 1.4× |
| `core/indexing/indexer-build.js` | 597 | 597 | 0 | 1.2× |
| `core/indexing/indexer-utils.js` | 536 | 536 | 0 | 1.1× |

**9 files over 500 LOC.** The fix-pack grew 4 prior breaches and landed 2 new ones. `late-interaction-index.js` at **2311 LOC** (4.6× the target) is the single largest in-scope file.

**Three duplicate hybrid dispatchers (M4) still unresolved**:
- `indexer-ann.js:670-861` (192 LOC) — LI hybrid with front/back cursor
- `embedding-local-model.js:723-797` (75 LOC) — embedding hybrid, same algorithm
- `indexer-pool.js:559-705` (147 LOC) — LI worker pool, mirrors EmbeddingPool 399-557 (159 LOC)

Combined ROI if extracted: ~250 LOC saved out of ~535 (47% reduction).

**24 indexing env vars** (same count, different mix). `docs/ENVIRONMENT.md` does not exist. Only **1 of 24** is in `--help`. The prior L7 finding is worse: +6 net new env vars added by the fix-pack, zero documented.

**Dead code still present in `artifact-builder.js`** (~250 LOC): `buildHnswIndex` (281-371), `saveArtifacts` (528-536), `updateArtifacts` (700-779). **C2 was fixed inside dead code at line 757** (now correctly calls `buildAndSaveFloatStoreFromDb`) but none of these functions have any in-core callers. Delete them — drops `artifact-builder.js` from 1054 to ~800.

---

## 10. Test coverage of new code

| New / modified module | Test file | Tests | Adequate? |
|---|---|---:|---|
| `coreml-cascade.js` (645 LOC new) | `tests/infrastructure/coreml-cascade.test.js` | 25 | GOOD |
| `hardware-capability.js` (169 LOC new) | `tests/infrastructure/hardware-capability.test.js` | 24 | GOOD |
| `model-fetcher.js` H6 verification cache (~80 new LOC) | `tests/infrastructure/model-fetcher.test.js` | 11 (older) | **GAP — zero tests for new code** |
| LI staged-save (C1 fix) | `tests/indexing/li-staged-save.test.js` + `tests/indexing/late-interaction-segment-isolation.test.js` | 4 + 1 | PARTIAL — tests the class but NOT `atomicSwapLateInteractionIndex` |
| Summary disk backup (H2, 146 new LOC) | `tests/graph/backup-restore.test.js` | 16 (cleanup hook added) | **GAP — orphan-recovery branch not tested** |
| H1 embedding-pool slot lifecycle | — | **0** | **GAP — untested** |
| `planAllocation` Apple-Silicon tier path | `tests/indexing/indexer-resource-plan.test.js` | 2 | **GAP — runs with `tier: 0` (RAM fallback only), no GPU-tier coverage** |

**Top priority test adds** (Codex should gate the next tag on these):

1. Monkey-patch `atomicSwapDatabase` to throw between segment-rename and stub-rename; assert full restoration (catches N1).
2. `updateArtifacts()` new-items path (catches any latent C2 regression if dead code is kept).
3. `initEmbeddingPool` concurrent-call idempotency (catches N2).
4. H2 partial-restore scenario: live DB has K<original summaries, orphan has K+20 (catches N5).
5. H6 verification-cache tests: `recordVerified → isVerified` round-trip, sidecar invalidation on rename, cross-worker disk-sidecar hit.
6. `planAllocation` Apple-Silicon tier path for M1 base, M2 Pro, M3 Max, M4 Ultra.
7. `fileFromId` regex fallback on malformed IDs.
8. CoreML cascade JS↔Rust filename parity (§4.2).
9. The C1 self-heal on the actual broken-state fixture, not a synthetic one.

---

## 11. Risk pareto (top 10, ranked by likelihood × impact)

| # | Risk | Phase | Introducer | Fail mode on user | One-line fix |
|---|---|---|---|---|---|
| 1 | `atomicSwapLateInteractionIndex` rollback broken (N1) | Phase 4b | `34089b2` | Silent data inconsistency on Windows/SMB/OOM during LI promote | Swap stub first, or fix the rollback predicate |
| 2 | `coreml-cascade.json` schema drift with Rust parser | Phase 8 init | `cf04213`, `504ad66` | Silent cascade disarm, loses 18% perf, no error | Add 5-line parity test |
| 3 | HCGS silent failure degrades retrieval | Phase 4c | pre-existing | User reindexes, HCGS errors dim, search quality drops, no JSON signal | Surface `hcgs.status` in quiet JSON |
| 4 | Quantized artifact silent failure → float-only retrieval | Phase 6 | pre-existing (C2 fixed, pattern unchanged) | MRR drops ~5pp, user sees no alarm | Surface `quantizedArtifacts.status` in quiet JSON |
| 5 | H6 sidecar forgery (local same-user attack) | model-fetcher | H6 (`34089b2`) | Adversarial embeddings load with no re-verify | Rust-side SHA256 re-check; HMAC sidecar |
| 6 | `projectRoot` not threaded to LI build | Phase 4b | `3fa180c` | Embed and LI disagree about skip list when `cwd ≠ PROJECT_ROOT` | Add `projectRoot: PROJECT_ROOT` at `indexer-phases.js:473` |
| 7 | `check-boundaries.js` Section 4 silently dead | CI | pre-existing | 39 hidden bypasses, CI blind to regressions | Fix shell escape |
| 8 | H2 JSON dump hits V8 string limit at scale | Phase 3 | H2 (`34089b2`) | 200K-symbol corpora: `JSON.stringify(payload)` OOMs | Stream the JSON |
| 9 | Hybrid dispatcher has no runtime guard | Phase 4b | `059fffb` | User sets `LI_HYBRID=1` alone, silently underperforms or hangs | One conditional + log |
| 10 | Decompression bomb in `extractVariantTarball` | init | `cf04213` | Disk-fill DoS on CI runners | Use `tar` npm with `maxBytes` |

---

## 12. Ship / hold decision

**SHIP as a patch release**, with a clearly-scoped follow-up list.

**Why ship**:
- Two P0 data-integrity bugs (C1, C2) are functionally fixed
- H1 DDD violation is properly resolved (`check-boundaries.js` clean)
- H2 in-memory backup destruction risk is closed for the happy path
- H6 SHA256 stall is closed with a meaningful production win
- MRR regression test (`gencodesearchnet 0.9793 → 0.9793` byte-identical) shows zero quality regression on the Python subset
- `37/37` critical-path tests and `1655/1655` cross-domain tests pass
- Fix-pack adds 191 lines of regression test for C1
- Deferred items are honestly documented in the commit message

**P0 follow-ups (within 30 days)**:
1. Fix N1 rollback in `atomicSwapLateInteractionIndex` + add a test that simulates partial-swap failure.
2. Schema validation + JS↔Rust parity test for `coreml-cascade.json` (§4.2).
3. Fix H6 sidecar trust topology — pick at least one of: Rust-side re-verify, HMAC sidecar, or `(dev, inode)` in the cache key (§4.3).

**P1 follow-ups (within 60 days)**:
4. `projectRoot` threading at `indexer-phases.js:473` (§4.8) — one-line fix.
5. Fix `check-boundaries.js` Section 4 shell escape (§4.5).
6. Stream the H2 summary backup to avoid V8 string limit (§4.10).
7. Add runtime guard to hybrid dispatcher (§4.7).
8. Fix `LI_DTYPE_BYTES` constant mismatch (§4.6).
9. Tarball decompression-bomb mitigation (§4.4).
10. Move the HF cascade repo from `mrsladoje/` personal account to a project-owned org with signing (supply chain).

**P2 / tech debt**:
11. Surface HCGS / quantized-artifact / cascade states in quiet-mode summary JSON (§7).
12. Delete dead code in `artifact-builder.js` (~250 LOC).
13. Extract shared `bidirectionalCursor({batches, runFront, runBack})` from the 3 duplicate hybrid dispatchers (M4).
14. Extract `WorkerPoolBase` from `EmbeddingPool` + `LateInteractionPool`.
15. Decompose `coreml-cascade.js` (645) into state-inspection + fetcher halves.
16. Decompose `summary-manager.js` (542) into store + disk-backup + restore.
17. Strip the C1 self-heal migration once all dev boxes are healed (or capture the broken state as a fixture).
18. Move 26 `tests/diagnose-*.js` files (2,210 LOC) to `scripts/diagnostics/` or delete stale ones.
19. Consolidate 24 indexing env vars into `core/indexing/env-vars.js` + `docs/ENVIRONMENT.md` + `--help`.
20. Add a symmetric slot pattern in `core/ranking/late-interaction-model.js` to mirror H1's fix; drops `indexing → ranking` cap from 6 to 4.

---

## 13. Benchmarks Codex should run before tagging

The fix-pack's only published validation is `gencodesearchnet` MRR@10 (Python subset, 500q) byte-identical at 0.9793 and full-index wall-clock 29m03s on M3 Max — **two numbers from one machine**. Request these additional runs:

1. **Full `gencodesearchnet` 6000q, 6 languages**, not just Python 500. The "84.06%" headline figure in `docs/PAPER_RANKING.md` is from the 6000q run; re-run and verify ±0.5pp on the post-fix-pack index. **This is the only number that proves the fix-pack didn't regress system-level MRR.**
2. **Rust-heavy corpus MRR**. `gencodesearchnet` has zero Rust/C/C++/Swift. Build a 200-chunk benchmark from `crates/sweet-search-native/` and run F32 vs BF16 MRR to close the `1366903` language-coverage gap.
3. **CoreML cascade dispatch coverage**: `SWEET_SEARCH_COREML_STATS=1 node scripts/benchmark-full-index.js`. Capture the variant-level dispatch report. The 18% claim is meaningful only if `dispatched / (dispatched + fell_through) > 0.9` on both embed and LI.
4. **BF16 wall-clock magnitude**: `SWEET_SEARCH_NATIVE_DTYPE=f32` baseline vs default. Resolve the 1.6× vs 1.32× contradiction. Same session, same binary, same corpus.
5. **CPU-only path on Linux x64**: run `scripts/benchmark-full-index.js --profile=full` on a Linux runner to confirm H6 is a no-op (not a regression) when there's no Metal contention.
6. **Fresh `sweet-search init` happy path**: in a clean OS image, `npm install && npx sweet-search init --profile full` and time end-to-end. The fix-pack's only validation was the self-heal, not the first-time cascade download.
7. **Init with simulated mid-download failure**: `SWEET_SEARCH_CHAOS_DROP=0.3 npx sweet-search init`. Assert init completes, cascade report is `partial`, never blocks.
8. **Second-rebuild after self-heal**: pre-seed broken state, run `--full`, then run `--full` again; diff `.sweet-search/` between runs to confirm the migration leaves no residual state.
9. **Worker-pool contention**: spawn 8 parallel `node` processes calling `fetchModel('coderankembed-int8')` with `cpulimit` backgrounding. Assert <5 s completion per process. The H6 "1090ms (previously ~2 min)" claim doesn't specify the worker count.
10. **Binary HNSW + Int8 sidecar load-after-build smoke test**: after `--full`, run `node -e "import('./core/vector-store/binary-hnsw-index.js').then(m => new m.BinaryHNSWIndex({indexPath: '.sweet-search/codebase-binary-hnsw.idx'}).load())"` — asserts the artifact chain actually loads.
11. **Cascade hit rate on small-batch-long-seq calls**: walk `pick()` at `coreml_embedding.rs:235-248` by hand for `(batch=1, seq=2000)`, `(batch=2, seq=1500)`, `(batch=4, seq=900)` and cross-check against a real dispatch report.
12. **The SwiGLU fusion revert**: `git show c397dc4 277f83f` and check for a linked issue or test failure log. If absent, check out `c397dc4`, run parity + MRR. The 8% may be recoverable.

---

## 14. Cross-axis scorecard

| Axis | Grade | Rationale |
|---|---|---|
| **Correctness** | **B−** | Was C+. 9/11 prior items cleanly fixed; N1 rollback breaks the new helper; C1 self-heal is elegant but over-engineered; C2 lives in dead code. Would rise to B+/A− with N1 fixed + new-helper test coverage. |
| **Performance** | **B** | Real wins (CoreML cascade, Float32Array napi, BF16, L2-aware cap) but every headline is a single M3 Max run. 1.6× BF16 vs 1.32× in-tree contradiction; `LI_DTYPE_BYTES` wrong; hybrid dispatcher no runtime guard; `.slice()` vs `.subarray()`; no cross-platform validation. |
| **Security** | **C+** | Happy path is correct (SHA256 pinning, TLS, atomic extract, bsdtar defaults, SQL prepared statements). One CRITICAL (H6 sidecar forgery) + one HIGH (tarball bomb) + one HIGH supply-chain (personal HF repo, no signing). Would rise to B+ with §12 P0+P1 done. |
| **DDD** | **B+** | H1 genuinely fixed, L1/L2/L3 clean, M3 Section 2 fixed. But Section 4 of the boundary checker is silently dead; the fix-pack added new bypasses to CI-invisible files; `indexing → ranking` cap at ceiling with zero headroom; M4 unresolved; slot pattern has no type contract. Path to A: §12 P0 + P1 items 4-5 + documented slot typedef. |
| **Complexity** | **C+** | File-size breaches grew 7 → 9, two new breaches (`summary-manager.js` 542, `coreml-cascade.js` 645), 4 prior breaches grew. 3 hybrid dispatchers still unresolved. Dead code in `artifact-builder.js` still present. 24 env vars, zero docs. BUT: conscientious commenting, 49 new tests, honest deferral language. Expected B+ if §12 P2 items 12, 15-16, 18-19 execute. |
| **Docs** | **B** | `DDD_ARCHITECTURE.md` and `INIT_STRATEGY.md` mostly current. Missing: slot-pattern documentation, cascade JSON cross-language parity story. `docs/reviews/` directory layout drifts. `PAPER_RANKING.md` is high-quality but its existence without explicit request violates CLAUDE.md. |

**Composite**: **B+** for the fix-pack as a piece of work, **C+** for the indexing pipeline as a system shipped on this commit.

---

## 15. Critical paths Codex should manually re-check

Beyond what the swarm found:

1. **Read the C1 fix side-by-side**: `core/indexing/indexer-phases.js:74-120` + `core/ranking/late-interaction-index.js:1690-1795`. Verify the rollback window comment in `atomicSwapLateInteractionIndex:81-86` matches actual behavior. Verify the self-heal is idempotent under partial states (the test only covers one shape).
2. **Read `coreml-cascade.json` and `embedding_model.rs:140` side-by-side**. Decide whether the literal hardcoding is acceptable until a parity test exists.
3. **Read `model-fetcher.js::isVerified` (lines 100-127) and the comment block at 45-56**. Decide whether the memoization-vs-trust-anchor distinction is acceptable, or whether defense-in-depth belongs at the Rust loader.
4. **Walk the LI `save()` path once more**: the staging-aware stub-basename ternary is duplicated at lines 1511-1513 and 1595-1597 of `late-interaction-index.js`. Extract a helper or accept the duplication but document the invariant "save() handles `_finalIndexPath=undefined` gracefully".
5. **Verify `diagnose-metal-seqlen.js` is correct**: the `1366903` commit message mentions "a missing `await` on `embedBatch()` calls" was fixed in the same commit. Every optimization decision made on that benchmark before the fix used buggy data. How long was the buggy benchmark in use? The commit doesn't say.
6. **Read the `277f83f` revert commit body** in full. It names the end-to-end wall-clock the microbench missed. That failure mode could hit any future microbench-driven optimization in `tests/diagnose-*.js`. Consider adding a CI rule: `perf(` commits must include a `scripts/benchmark-full-index.js` result in the commit body.

---

## 16. Pointers to specialist reports

All seven reports are in `docs/reviews/INDEXING_OPT_2026-04-15/`:

- **correctness.md** (2609 words) — N1-N8 new defects, prior-fix verdicts, B− grade
- **performance.md** (~5800 words) — claim-verification table, hot-path attribution, 12-item optimization list
- **security.md** (~3700 words) — threat model, C1 CRITICAL, 2 HIGH, 2 MEDIUM, 4 LOW, C+ grade
- **integration.md** (~4800 words) — M3-NEW-1 through M3-NEW-6, boundary checker output, B+ grade
- **complexity.md** (~3054 words) — file-size table, 5 cognitive hotspots, 12 refactor seams, C+ grade
- **devils_advocate.md** (~2600 words) — over-engineering report, claims trust audit, SwiGLU revert analysis, 6 user journeys, file:line index at the end
- **queen_synthesis.md** (~5029 words) — system-level health, INIT_STRATEGY compliance table, cross-lane findings, risk pareto, 7 benchmarks

The seven reviewers converged independently on the top findings: **N1, cascade schema drift, H6 sidecar trust, BF16 magnitude contradiction, and the duplicate-dispatcher debt** were flagged by 3+ specialists each. That level of cross-validation is the strongest signal in this report; Codex should weight those findings heavily.

---

**End of synthesis.** Every claim above cites `file:line` or a benchmark file. Unverified claims are explicitly marked. The fix-pack is shippable; the specialist reports describe what "ship it with P0 follow-ups" means concretely.
