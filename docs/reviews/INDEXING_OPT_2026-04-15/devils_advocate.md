# Devil's Advocate Review — Indexing Optimization Series

**Date**: 2026-04-15
**Reviewer role**: Contrarian meta-reviewer (6th voice)
**Scope**: Commits `34089b2` (fix-pack), `cf04213`, `4fd9c9a`, `1366903`, `b8816c1`, `7aa15e8`, `ad09ab7`, `059fffb`, `277f83f`
**Companion reviews**: `performance.md`, `security.md` (already in this directory); correctness, integration/DDD, complexity (in flight)

I read the same files. I took the opposite side. Numbers are not the story.

---

## 1. The fix-pack critique — over-engineering report

The fix-pack (`34089b2`) is **2,969 insertions to fix 11 findings** — averaging 270 LOC per fix. Several fixes do more than the bug warranted. Going fix-by-fix.

### C1 — LI staged-save aliasing — **good fix, suspicious self-heal**

The aliasing bug itself was three lines: `_segmentDir` was being derived from `indexPath + '.segments'`, and `indexPath` got the `.tmp` suffix during staging. The simplest correct fix would be:

1. Rename the segments directory alongside the stub in `atomicSwapDatabase`.
2. Done.

What was actually shipped (`core/ranking/late-interaction-index.js:387-399`, `:1505-1518`, `:1700-1797` and `core/indexing/indexer-phases.js:55-120`):

- New helper `atomicSwapLateInteractionIndex` (33 LOC) — fine, this is the simple-fix above
- `resetForSave({stagingSegmentDir, finalIndexPath})` — fine, two new options
- `_finalIndexPath` instance field → action-at-a-distance shadow state read 100+ lines away in `save()`
- **A self-heal migration path** for "pre-fix broken state" — **96 LOC** (`late-interaction-index.js:1705-1797`)

The self-heal does this: on `load()`, if the stub's `segmentDir` is absolute AND ends in `.tmp.segments` AND lives in the same directory as `canonicalSegDir`, **rename the directory in place and atomically rewrite the stub**. There are TWO different self-heal branches (lines 1738 and 1769), differing in whether the orphaned `.tmp.segments` is referenced by the stub or sitting unreferenced.

This is **defensive theater** for a population of one machine. The reviewer's own dev box (the `.sweet-search/codebase-late-interaction.db` file checked in by the previous review) is the only known instance of the broken state. The HF-distributed cascade does not produce it. New users running `sweet-search init` after this commit cannot produce it. Once the original reviewer's machine is healed (which it is, per current on-disk state — the stub is now `{"version":"3.0","format":"segmented","segmentDir":"codebase-late-interaction.db.segments"}`), the self-heal **is dead code that runs once on every load forever**.

The dev box was already known to be broken. A one-time `rm -rf .sweet-search/codebase-late-interaction.db.tmp.segments && rm .sweet-search/codebase-late-interaction.db && sweet-search index --full` would have produced the same end state with zero new code. Shipping a 96-LOC self-heal as production code makes the next reviewer think the broken state is something users hit.

The crash-safety justification at `indexer-phases.js:81-86` is also weak: it claims that if the segments rename succeeds but the stub rename fails, "load will see a missing segments dir and self-heal via the .tmp.segments migration path". But after the segments rename succeeds, there is no `.tmp.segments` directory — it has been renamed to canonical. The first self-heal branch only fires when the **stub's stored basename** ends in `.tmp.segments` AND the directory still exists at that path. Neither is true after a partial swap. The "narrow window" claim is real (two filesystem renames) but the supposed self-heal does not cover this window. The actual crash recovery is "user re-runs `sweet-search index --full` and it rebuilds from a fresh state".

**Verdict**: 33 LOC fix wearing 96 LOC of dead-code armor. Strip the self-heal. Replace with a one-line warn-and-bail when the stub format is unrecognized.

### C2 — `buildAndSaveFloatStore` undefined — **legitimate one-line fix, OK**

`artifact-builder.js:765`. Replaced an undefined symbol call with the correct `buildAndSaveFloatStoreFromDb(db, ...)` and added a `try/finally` to close the DB. Proportional. Nothing to attack.

### H1 — DDD violation — **fix that worsens type safety**

The pre-fix code was a dynamic import inside `embedding-local-model.js::initEmbeddingPool` of `'../indexing/indexer-pool.js'`. One line. Bad direction (embedding → indexing), but the import was guarded and the round-trip existed only because `initEmbeddingPool` lived on the wrong side of the dependency boundary.

The fix moves construction into `indexer-pool.js`, then introduces a **duck-typed slot** in `embedding-local-model.js` (`setEmbeddingPool`/`getEmbeddingPool`/`clearEmbeddingPool`) — `core/embedding/embedding-local-model.js:367-376`. The slot has no type contract. When a future caller passes an object that doesn't satisfy `embed(texts, options) => Promise<Float32Array[]>`, the failure surfaces as `TypeError: undefined is not a function` deep inside `embedBatchesWithPool`, with no stack trace pointing back to the slot installation site.

Pre-fix: import error if the wiring breaks (loud, fail-fast).
Post-fix: runtime TypeError if the wiring breaks (silent until a real query hits the path).

The DDD compliance gain is real (boundary checker drops to 0 violations). The maintenance cost is a slot whose contract is documented in a comment (`embedding-local-model.js:359-362`) and not enforced anywhere.

A typed port interface (`interface EmbeddingPoolPort { embed(...): Promise<Float32Array[]> }`) would have been the right answer. The pragmatic answer is the slot. Live with the trade-off but don't pretend it's strictly better.

### H2 — Summary backup — **the JSON dump that may bite at scale**

`summary-manager.js:35-321`. The fix is correct: persist the in-memory backup to `{dbPath}.summaries.bak.json` before destructive phases. Crash recovery is correctly gated on "live DB is empty or missing".

But: the backup uses a **single `JSON.stringify(payload)` call** at `summary-manager.js:79`, with `summary_embedding` blobs base64-encoded. For the current 16K-symbol corpus this produces ~30-40 MB strings — fine. For a larger codebase (200K+ symbols, which sweet-search advertises support for) this approaches V8's ~512 MB string limit. The same file's late-interaction-index.js is **already known to stream documents** to avoid this exact limit (see comment at `late-interaction-index.js:1456-1457`: "Streams documents one-by-one to avoid V8's ~512MB string length limit"). **The fix-pack reintroduces the exact pattern its sibling file works around.**

Inconsistent. Stream the JSON or use a binary sidecar. Don't ship a fix that has a known scale ceiling against a product that bills itself for large codebases.

### H6 — SHA256 verification cache — **redundant with the pre-warm**

The fix adds a two-layer cache: in-process Map + disk sidecar `{filePath}.verified.json`. The fix-pack also kept the **pre-existing pre-warm** at `indexer-phases.js:448-462` that calls `getNativeEmbeddingModel()` and `getNativeLiModel()` before the parallel pipeline starts.

The commit message says: "Native model load now 1090ms (previously ~2 min under worker pool contention)." But the **native model load happens on the main thread**, not in worker_threads (see `native-inference.js:260-293::getNativeLiModel`). The "worker pool contention" pathology is for the **ORT CPU embedding workers** that load `coderankembed-int8` (`indexer-worker.js:33`), not LateOn-Code. The 1090ms measurement is the native main-thread fetch — already covered by the pre-warm at idle.

Cross-checking which layer carries which case:

| Failure mode | Pre-warm covers? | In-proc cache covers? | Disk sidecar covers? |
|---|---|---|---|
| Main-thread native fetch under load | yes | redundant | redundant |
| Cross-process re-run (back-to-back `sweet-search index`) | no | no | yes |
| Worker_thread fetching `coderankembed-int8` (separate V8 isolate) | no | no | yes |

The **in-process Map cache is dead code** for the cited measurement. The disk sidecar is the load-bearing piece, and only for two narrow cases neither of which the commit message describes.

The commit message also conflates "596 MB LateOn-Code file" with the worker pool contention story — but the workers don't fetch LateOn-Code at all. The native LI model loads from `getNativeLiModel()` which is called once on the main thread. The 600 MB worker-fight pathology was about `coderankembed-int8` (~250 MB ONNX). The numbers do not line up with the explanation.

**Action**: keep the disk sidecar (genuinely useful). Drop the in-process Map (dead code given the pre-warm). Rewrite the commit message so the next reader knows what the cache actually catches.

### L8 — Windows-path id split — **regex falls back silently**

`indexer-ann.js:611-617`. The fix replaces `id.split(':')[0]` with regex `/:\d+-\d+:\d+$/`. Correct for the Windows drive-letter case. **But**: when the regex doesn't match (the ID isn't formatted as `${file}:${lineStart}-${lineEnd}:${chunkIndex}`), `fileFromId` returns `id` itself. The caller then checks `filesToRemove.includes(docFile)` — which can never match a chunk ID against a file path. **The chunk is silently retained.** This isn't a regression (the pre-fix `split(':')[0]` had the same silent-failure shape on a malformed ID), but the fix advertises Windows-safe id parsing without addressing the silent-failure case the new regex creates.

Zero tests for `fileFromId`. The L8 fix has no test coverage in the regression suite at `tests/indexing/li-staged-save.test.js`. Since L8's relevant code path (`filesToRemove.length > 0`) is the **incremental** branch (out of scope per the task), I'll defer further analysis — but flag that the "Windows safe" claim is only half-true.

### M3 — boundary checker dynamic-import counting — **actually two fixes**

The original gap was: `check-boundaries.js` only counted static `from '...'` imports, missing 4 dynamic `import('...')` sites. The fix updated the script AND **raised the cap from 2 to 6** in `DDD_ARCHITECTURE.md`.

The cap raise is a tell. Pre-fix: "2 declared exceptions". Post-fix: "6 sites discovered". The hidden coupling was 3× larger than the matrix claimed. **The fix counts the violation; it does not reduce it.** M4 (unify the three duplicate hybrid dispatchers) would have eliminated 3 of the 6 sites — and M4 was deferred. The fix-pack chose to legalize the existing coupling rather than reduce it. That's a defensible choice but should be named.

### Summary of fix-pack overhead

| Fix | Bug LOC | Fix LOC | Ratio | Verdict |
|---|---:|---:|---:|---|
| C1 | ~3 | 195 (`indexer-ann.js`) + 134 (`indexer-phases.js`) + 100 (`late-interaction-index.js`) | ~140× | Over-engineered (self-heal is dead code) |
| C2 | 1 | ~5 | 5× | Proportional |
| H1 | 1 | ~50 | 50× | DDD-correct, type-unsafe |
| H2 | n/a (new behavior) | 200 | n/a | Has a scale ceiling |
| H6 | n/a (new behavior) | 147 | n/a | Two layers, one redundant |
| M3 | 5 (script) | 20 (script + docs) | 4× | Counts the violation, doesn't reduce it |

---

## 2. Performance claims — trust audit

I read every commit message. I matched the numbers against the source.

### `1366903` — BF16 default — "1.6× sweet-search index"

The commit cites two numbers: a measured `gencodesearchnet 500q` MRR (no regression: 93.07% F32 vs 93.07% BF16; 97.97% vs 97.90% with LI) and a wall-clock measurement of `892s/885s on 1057 files, 16171 chunks`. The "1.6×" is then computed by comparing 892s against a "~24-26 min F32 projection" from "previous session notes". **There is no recorded F32 wall-clock for sweet-search-private from the same session, same binary.**

The replicated `gencodesearchnet` numbers show 1.20× (full profile) and 1.32× (balanced). The "1.6×" requires a 30-50% speedup gap over the validated benchmark — i.e., something specific about sweet-search's workload (more long-seq tail batches, more LI work, etc.) or a stale F32 baseline that ran on a different binary state. Neither is documented.

**The "1.6×" headline is unverified**. The validated number is "1.20-1.32× on `gencodesearchnet`".

The MRR-no-regression claim has a more serious blind spot. `gencodesearchnet` covers six languages: **go, java, javascript, php, python, ruby**. **No Rust. No C. No C++. No Swift.** Sweet-search is written in JavaScript+Rust and a major chunk of its differentiator is search quality on its own corpus. BF16 numerical sensitivity bugs do not show up uniformly across languages. A proper "no MRR regression" claim needs at least one Rust-heavy benchmark. None exists in `eval/corpus/`.

### `b8816c1` — Float32Array napi return — "~2× faster"

The commit shows a clean A/B benchmark: `Embedding b32×s512 1974 → 996 ms (1.98×)`, `LI b32×s2048 26289 → 12157 ms (2.16×)`. **This one is honest** — clean process, NEWER run first to equalize cache/thermal, baseline measured. The claim is also internally consistent (collapses 7.6M napi crossings to 1).

Bonus catch: the commit also mentions `nomic_bert_sdpa::l2_normalize` adding `epsilon-before-sqrt` to prevent 0/0 NaN on fully-padded batch rows. **The pre-fix path was silently writing NaN into HNSW vectors for partial last batches.** This is not flagged in any prior performance bullet. It means HNSW recall on the last-batch chunks of every prior native-Metal indexing run was degraded by NaN poisoning. No quantification of how many vectors were affected.

### `ad09ab7` — Cache-aware long-seq batch — "1.7× tail speedup"

The commit cites "613 ms (B=1) to 1306 ms (B=16, 2.13× slower than best)". Then says "1.7× tail speedup". 2.13× and 1.7× are not the same number. Walking the math: if the previous default put tail batches at B=16 (1306ms), and the new default puts them at B=1 (613ms), the speedup is 1306/613 = **2.13×**, not 1.7×. The "1.7×" likely averages across the tail-distribution rather than the worst case. That's defensible — but the commit doesn't show the distribution. It just asserts "1.7× tail speedup" with the 2.13× microbench number alongside.

The actual end-to-end win is unspecified. No before/after wall-clock for full indexing with this fix alone.

### `4fd9c9a` — CoreML cascade — "18% faster"

Two measured numbers: `34.0 min` candle baseline (from "project memory"), `27.9 min` cascade cold compile, `~24.5 min` warm cache "extrapolated". The cold-compile delta is the verifiable one; the warm-cache "~24.5 min" is "extrapolated" — and the docs/INIT_STRATEGY.md headline is "**~18%**" which is the cold-compile number, not the extrapolated warm-cache one. Honest.

But: **dispatch counter coverage is not reported in the commit**. The cascade ships with `AtomicU64` dispatch counters per variant + a fallthrough counter, gated behind `SWEET_SEARCH_COREML_STATS=1` (`coreml_embedding.rs:140-198`). The 18% claim is end-to-end. **What fraction of LI batches actually hit a cascade variant vs falling through to candle?** The commit doesn't say. If coverage is 50%, the 18% gain might be 9% on workloads with more long-seq tail or unusual batch shapes (where `pick()` returns None and the call falls through).

A second concern in the dispatch logic: `pick()` finds the **first** variant where `v.batch >= batch_size && v.seq >= seq_len` after sort by `(batch, seq)` ascending. For a call with `(batch=2, seq=2000)`, the variant list `(1, 2048), (4, 1024), (16, 512), (32, 384), (64, 96), (64, 192)` walks: (1, 2048) batch too small, (4, 1024) seq too small, (16, 512) seq too small, (32, 384) seq too small, (64, 96) seq too small, (64, 192) seq too small. **No fit, fallthrough.** But intuitively a `(1, 2048)` variant could handle this if the caller broke the batch into two (1, 2000) calls. The cascade has no such logic. Dispatch coverage on small-batch-long-seq calls is whatever the bucketer produces — not measured.

### `277f83f` — the SwiGLU revert — see Section 3

---

## 3. The revert saga — what `277f83f` reveals

`c397dc4` claimed "8% faster" on a `tests/diagnose-metal-seqlen.js` microbench at six production-like shapes. Two commits later, `277f83f` reverted with a sober post-mortem: "892.5s baseline → 910.8s with fusion (a 2% regression instead of the claimed 8% speedup)".

Three signals from the revert message worth dwelling on:

1. **The microbench was wrong about production shapes.** The bucketer produces mixed shapes per call (batch/seq varies). The microbench tested fixed `32×512`. The fusion's gain on the long-seq tail was eaten by `.contiguous()` memcpys at the shorter shapes. **This is exactly the failure mode every microbench-driven optimization is supposed to avoid**, and the original commit did not run an end-to-end sweet-search index before claiming 8%.

2. **Correctness was never in doubt.** Per-token cosine vs ORT FP32 was bit-identical. So the revert is a pure performance rollback — no quality risk. Good. But: the optimization was shipped on **microbench evidence alone**, with no end-to-end validation.

3. **The revert pattern reveals a missing CI gate.** A "8% faster" commit should **not be mergeable** without an end-to-end wall-clock measurement on the production workload. If `sweet-search-private` is the canonical workload, then `node scripts/benchmark-full-index.js` should be required for performance commits. None of the commits in this series reference such a gate.

The lesson the revert teaches: **microbench wins do not transfer**. Yet `b8816c1` ("Float32Array napi return ~2× faster") is also a microbench-only result (`AB bench at indexer-realistic shapes`). It happens to be honest because the napi crossing count change is plumbing, not arithmetic — but the same pattern that produced the SwiGLU regression could produce a less-obvious napi-related one in the future. There's no policy fix proposed.

The other piece of context: the SwiGLU commit was **8 commits before the fix-pack**. The reviewer's branch was actively churning when the LI staged-save bug was being hidden by the BF16 work and the cascade work. **The C1 bug was on disk for at least 6 commits before being noticed.** The dev box's `.tmp.segments` aliasing was sitting in production long enough to be the first thing the swarm review found.

---

## 4. Production user journeys that break

Six users walk into a `sweet-search init`. Five of them have problems no one tested for.

### Journey 1 — M1 Mac user — **silent fallback only**

`hardware-capability.js` gates the cascade at M3+. M1 user runs `sweet-search init`. Cascade fetch is skipped, candle Metal path is used. Fine — except the `init` log mentions "CoreML cascade: not eligible (M1)" and the user doesn't know what they're missing. **No documented expected wall-clock on M1.** The 18% number in `INIT_STRATEGY.md` is M3+ only. M1 users have no baseline to compare against.

### Journey 2 — M1 Mac user with `SWEET_SEARCH_COREML_CASCADE=1` set — **no actual override**

Per `INIT_STRATEGY.md:239`, only `SWEET_SEARCH_COREML_CASCADE=0` exists as a force-disable. There is no `=1` force-enable. If an M1 user sets `=1` thinking it will turn the cascade on, **nothing happens** — the hardware gate runs first. Gracefully ignored, no error message. Cargo cult misconfiguration.

### Journey 3 — M3 Max user with 16 GB RAM — **planAllocation conflict**

The cache-aware budget formula at `indexer-pool.js` derives LI batch sizing from `(LLC, hiddenDim, dtype)`. The `planAllocation` heuristic **also** scales LI batch sizes from `gpuTier` (Apple Silicon GPU tier). On a hypothetical M3 Max with only 16 GB RAM, `gpuTier=3` (high) but `totalMemGB=16` (constrained). What wins?

I traced `core/indexing/indexer-pool.js:planLateInteractionFromGpuTier` and the cache-aware path. They run at different points: GPU tier sets the **upper cap**, cache-aware computes the **per-batch budget**. They do not conflict in theory — but I see no explicit test for `gpuTier=3, totalMemGB=16`. The configuration is legal hardware (M3 Max base SKU). The behavior under that configuration is untested. Worth a one-liner in `indexer-resource-plan.test.js`.

### Journey 4 — Intel Mac user — **fallback path, no native addon**

Native Metal is M-series only. Intel users fall through to the ORT CPU path. **Did the ORT CPU path get exercised after the native correctness fixes (`7aa15e8`)?** The `gencodesearchnet` benchmarks all run on M3 Max. Intel Mac users are running on a code path that hasn't been benchmarked for at least 2 weeks. Likely fine — the ORT path is the older, more battle-tested path — but unverified.

### Journey 5 — NFS / SMB / network filesystem — **fsync ordering unknown**

The atomic stub-rename + segments-rename in `atomicSwapLateInteractionIndex` (`indexer-phases.js:87-120`) assumes POSIX rename atomicity. **No fsync calls anywhere in the LI save path** (verified via grep — the only fsync calls in `late-interaction-index.js` are zero). On NFS or SMB:

- POSIX `rename()` may not be atomic on NFS clients.
- `fs.rename` returning success does not mean the bytes are durable.
- A power loss between the segments rename and the stub rename leaves a torn state with no fsync barrier.

The self-heal assumes "you can `rename()` a directory atomically". On NFS this is not always true. Sweet-search probably doesn't claim NFS support, but the code's "narrow window" crash-safety claim should be qualified.

### Journey 6 — User with pre-fix broken state — **the self-heal IS tested but only synthetically**

`tests/indexing/li-staged-save.test.js:144-190` tests the self-heal by **manually constructing the broken state**: it runs a normal save, then `fs.rename`s the segments dir to `.tmp.segments`, then `fs.writeFile`s a stub with the absolute path. This is a **synthesis** of the broken state, not the actual broken state.

The actual broken state on disk has lived through many indexing operations and may have additional artifacts (orphaned `.bak` files, partial segment writes, etc.) that the synthetic test doesn't reproduce. **The fix-pack's commit message says "Self-heal verified against actual on-disk broken state" — that verification is not in the repo.** It happened on the dev box once, was not captured as a fixture, and cannot be rerun.

A fixture-based test that includes a tarball of the actual broken state (anonymized) would have higher confidence than the synthetic one.

---

## 5. Hidden patterns the other reviewers will miss

### 5.1 — JSON-as-cross-language-contract

`core/infrastructure/coreml-cascade.json` claims to be the "single source of truth" for variant filenames (`coreml-cascade.json:2,8,9`). The Rust addon parses filenames with **hardcoded prefixes** `"nomic_bert_b"` and `"li_modernbert_b"` (`embedding_model.rs:140`, `li_model.rs:127`). **The Rust side does not consume `filePattern`** — it has its own regex that happens to match the convention.

Schema drift risk: anyone editing `coreml-cascade.json` to rename a model (say, switching from `nomic_bert` to `nomic-bert-v2` to bump versions) would break the Rust filename parser silently. The cascade dir would scan, find no matching files, and fall back to candle — losing the 18% gain with no error message at the cascade level (just `[NativeEmbedding] CoreML cascade dir ... contained no nomic_bert_b{B}_s{S}_fp16.mlpackage files — falling back to candle` per `embedding_model.rs:114-119`).

**No schema validator at compile time. No integration test that the JSON's `filePattern` actually matches what Rust parses.** A 5-line test that asserts `filePattern` resolves to the regex Rust uses would catch this.

### 5.2 — diagnose-* test sprawl (26 scripts, 0 in CI)

```
tests/diagnose-batch-padding.js          tests/diagnose-li-metal-vs-cpu.js
tests/diagnose-cpu-embed-throughput.js   tests/diagnose-li-solo.js
tests/diagnose-cpu-utilization.js        tests/diagnose-metal-f32-vs-fp32onnx.js
tests/diagnose-exact-prefix.js           tests/diagnose-metal-raw.js
tests/diagnose-fp32-gold.js              tests/diagnose-metal-seqlen.js
tests/diagnose-fp32-vs-int8.js           tests/diagnose-metal-shape.js
tests/diagnose-hybrid-hang.js            tests/diagnose-native-pooling-bug.js
tests/diagnose-hybrid-li.js              tests/diagnose-native-vs-ort-cosine.js
tests/diagnose-hybrid-with-embed.js      tests/diagnose-nativeEmbed-trace.js
tests/diagnose-index-vs-live.js          tests/diagnose-ort-mean-vs-cls.js
tests/diagnose-batch-padding.js          tests/diagnose-ort-output-shape.js
tests/diagnose-shared-tokens.js          tests/diagnose-raw-hidden.js
tests/diagnose-tokenizer-parity.js       tests/diagnose-variant-a-slowdown.js
tests/diagnose-wrappers-direct.js
```

26 files. `vitest.config.js:11` includes only `tests/**/*.test.js`. **None of the diagnose scripts run in CI.** They are committed debug artifacts. The most recent (`8ec87c6 chore(tests): add diagnose-variant-a-slowdown.js`) admits they are not maintained tests via the `chore` prefix.

The commit message for `1366903` (BF16 default) cites: "diagnose-metal-seqlen.js: add missing `await` on embedBatch() calls. The script was measuring Promise-creation latency (~1ms) instead of actual inference time, which masked the real baseline throughput and led to contaminated F16/BF16 comparisons until it was fixed." **A diagnose script with a missing `await` was driving optimization decisions for an unknown duration.** The fix happened in the same commit as the BF16 default change. How long was the original buggy benchmark in use? Untracked.

The diagnose scripts should either move to `scripts/diagnostics/` (clearly out of CI) or be deleted. Mixing them with real tests pollutes `tests/` and tempts future readers to trust them.

### 5.3 — comments-as-documentation (top fragility)

Three comment blocks I'd put in the "future-misleads-reader" hall of fame:

1. **`indexer-phases.js:437-447`** — the pre-warm comment talks about "the 596 MB LateOn-Code file" and "ORT CPU embed running concurrently". But the pre-warm is on the **native** code path, and the contention story is for `indexer-worker.js` workers loading `coderankembed-int8`, not the native LI fetch. The comment was correct for an ORT-era version of the file and was not updated when the native path landed. A future reader debugging worker contention will look here, not find the actual issue.

2. **`coreml-cascade.json:2`** — "SINGLE SOURCE OF TRUTH ... Consumed by ... the Rust filename parser". The Rust filename parser does not consume this file. The parser uses hardcoded prefixes. The comment is documentation-of-intent, not documentation-of-reality.

3. **`late-interaction-index.js:1505-1518`** — "Stub stores segmentDir as a basename resolved relative to the stub's dirname on load. When staging, record the basename derived from `_finalIndexPath`...". The comment correctly describes the logic. But `_finalIndexPath` is set 100+ lines away in `resetForSave` and is `undefined` on first-ever save. The fallback (`path.basename(segDir)`) covers this case. A future reader who refactors `resetForSave` to make `_finalIndexPath` always-set would not realize the fallback path exists. The implicit invariant "save() handles _finalIndexPath=undefined gracefully" is not asserted anywhere.

### 5.4 — single-source-of-truth claim audit

`bde9b26` claims `li-skip-policy.js` is now the single source of truth for skip logic. **It is.** I grepped for `isExcluded`, `shouldSkip`, `skipFile`, `filterFiles` across `core/`. The only file-level skip logic is `li-skip-policy.js::isExcludedByConfig` which reads `loadProjectConfig(projectRoot).exclude`, AND `indexer-utils.js::discoverFiles` (`indexer-utils.js:495`) which reads the same `projectConfig.exclude` field. Both paths terminate at the same source.

This claim holds. Credit where due.

### 5.5 — `_internals.resetCache` and the projectRoot cache

`li-skip-policy.js:44-63` caches the resolved exclude list keyed by `projectRoot` string. The `_internals.resetCache()` is exposed for tests. **In a long-running server process where the projectRoot changes** (rare but possible — think a single sweet-search daemon serving multiple workspaces), the cache **never invalidates**. New project roots get new cache entries (`Map` grows unbounded), and stale project roots' caches stay forever. Memory leak, slow but real.

Realistic? Sweet-search isn't currently a daemon. But the upcoming agentic-mode work could turn it into one. Worth noting before that lands.

### 5.6 — "never throws / never blocks init" test coverage

`model-fetcher.js`, `coreml-cascade.js::fetchCoremlCascade`, and `init.js` paths claim to "never throw / never block init / fail gracefully". I searched for tests that simulate **actual failures**: network drop mid-download, disk full, partial tarball write. **None exist.** The failure-mode test for `coreml-cascade.test.js` covers malformed fixtures and synthetic empty/partial cache states (`tests/infrastructure/coreml-cascade.test.js`), not real I/O failures injected mid-stream.

The "never throws" claim is a code-reading promise, not a test-verified one. A network-drop test (using `nock` or similar) for `fetchCoremlCascade` would close the gap.

### 5.7 — The fix-pack file-size growth

The "Honest Assessment" in `DDD_ARCHITECTURE.md:323-349` admits the fix-pack added file-size breaches. Concretely:

- `late-interaction-index.js` 2186 → **2311 lines** (+125)
- `indexer-ann.js` 903 → **951 lines** (+48)
- `indexer-pool.js` 696 → **746 lines** (+50)
- `indexer-phases.js` 627 → **706 lines** (+79)
- `summary-manager.js` was below 500 → **542 lines** (NEW breach)

**5 files grew. 1 was previously compliant and is now non-compliant.** The H5 (file-size decompositions) finding from the original review was deferred. The fix-pack made the deferred finding worse. The `Decompositions deferred per the review punchlist` line in the commit message is honest about this. But it also means the next review (which is happening right now) is reviewing a codebase that grew ~~organically~~ tactically over 24 hours and is further from the 500-line target than it was the day before.

---

## 6. Docs drift — claimed state vs actual state

### `docs/INIT_STRATEGY.md` Phase 8

Claims:
- **"~18% faster full indexing on an M3 Max"** — verifiable, matches commit `4fd9c9a`
- **"Single source of truth for the shape set: `core/infrastructure/coreml-cascade.json`. Both the JS cascade module and `scripts/spike-coreml/trace_cascade.py` read this file so the shapes traced during a local build always match the shapes the Rust filename parser ... looks for on disk."** — **half false**. The Rust filename parser does NOT read the JSON. It has its own hardcoded prefixes. The shapes happen to match because the convention is followed manually, not because the Rust side resolves the JSON.

Fix: rephrase to "JS and Python read this file. The Rust filename parser uses hardcoded prefixes that follow the same convention; keeping them in sync is a manual contract enforced by code review."

### `docs/DDD_ARCHITECTURE.md` Honest Assessment

Honest about file size breaches. **Not honest about the ddd-violation count math**:

> "M3 ... Raised max to 6 and documented all sites in DDD_ARCHITECTURE.md."

The reframe: "we found 6 sites where the matrix said max 2; we raised the cap to 6". The Honest Assessment should also note: "the fix counts the violation; it does not reduce it. M4 (unify duplicate dispatchers) is the structural fix and is deferred." Without that note, a reader sees "0 violations, 0 warnings change" and concludes the DDD posture improved. It did not — the quantification of an existing problem improved.

### `docs/reviews/INDEXING_REVIEW_2026-04-14.md` punch-list completeness

The fix-pack commit message claims "fixes 11 of 12" findings. Actually:
- C1, C2, H1, H2, H6, M2, M3, M5, L1, L2/L3, L4, L8 — these are the 11 it claims.
- **H3** (incremental vector unstaged) — deferred (out of scope per task instructions, fair).
- **H4** (cleanup leaks tmp segments) — fixed alongside C1 (the cleanup helper now removes the staged segments dir, `indexer-phases.js:60-66`). **The commit message does not mention H4 in the fix list**, but it is in fact fixed. Inverse drift: shipping more than claimed.
- **H5** (file-size decompositions) — deferred (acknowledged).
- **M4, M6, M7** — deferred (acknowledged).
- **L5, L6, L7, L9** — not mentioned at all.

So the count is technically: 11 explicitly claimed + 1 silently shipped (H4) = 12 fixes. But L5 (dead code in `artifact-builder.js`), L6 (flag/env drift), L7 (24 env vars undocumented), L9 (silent error catch in `enrichChunksFromGraph`) are unaddressed and unmentioned in the deferred list. The "Deferred to follow-up refactors" section in the commit message is incomplete.

---

## 7. Recommendations for Codex (manual re-check list)

Concrete things the automated swarm reviews will not catch. In priority order.

1. **Re-run the BF16 wall-clock measurement on a Rust-heavy corpus.** `gencodesearchnet` is JS+Python+Java+PHP+Ruby+Go. Sweet-search itself is JS+Rust. Build a Rust-only mini-corpus (e.g., the `crates/sweet-search-native/` directory split into 200 chunks) and run F32 vs BF16 MRR on it. If MRR holds, the 1366903 claim is solid. If it dips, the BF16 default needs reconsideration for Rust-heavy users.

2. **Read the Rust filename parser side-by-side with `coreml-cascade.json`.** Verify by hand that any future schema change to `filePattern` would force a Rust code change. Add a `tests/infrastructure/coreml-cascade-rust-parity.test.js` that generates a fake cascade dir matching the JSON `filePattern` and asserts the Rust addon loads it (or skip if no addon).

3. **Run `node scripts/benchmark-full-index.js` with the cascade enabled and `SWEET_SEARCH_COREML_STATS=1`.** Read the dispatch report. Calculate the cascade hit rate. If <50%, the 18% claim needs to be qualified.

4. **Try the self-heal on the actual broken state from a snapshot.** The reviewer's dev box originally had it; the fix already healed it. Pull the broken state from git history (commit `34089b2~1` had the affected `.sweet-search/` artifacts not in repo; reproduce by checking out `34089b2~1`, running `sweet-search index --full`, observing the broken stub, then checking out `34089b2` and verifying the self-heal). This validates the "verified against actual on-disk state" claim from the commit message.

5. **Side-by-side diff `late-interaction-index.js::save/load` from before and after.** The pre-fix and post-fix versions of the segmented save path are the most behaviorally complex code in the fix-pack. Read them in two terminals. Look for cases where the staging and non-staging paths diverge in unexpected ways. In particular, the `_loadedExisting` early-return path at `:1469` interacts with `_finalIndexPath` in non-obvious ways.

6. **Ask: what would this code look like if the author had started over?** A clean-slate redesign would put the LI segments directory **inside** a single rebuildable parent (e.g., `live.db.dir/{stub.json, segments/}`), making the entire atomic swap a single directory rename. The current design accumulated complexity because the original architecture (separate stub file + adjacent segments directory) wasn't amenable to atomic swap. The fix-pack adds 270 LOC to make the existing layout work; a 50-LOC layout change would have made the whole problem disappear. Worth raising for the next major refactor.

7. **Audit the `summary-manager.js` JSON dump scaling ceiling.** Run `sweet-search index --full` on a 100K+ symbol corpus (e.g., a vendored copy of `node_modules/typescript`). Watch peak RSS during `backupSummaries` → `writeDiskBackup`. If `JSON.stringify(payload)` peaks above 200 MB, switch to streaming.

8. **Verify the CoreML cascade dispatch coverage on `(small batch, long seq)` shapes.** Specifically `(batch=1, seq=2000)`, `(batch=2, seq=1500)`, `(batch=4, seq=900)`. Walk `pick()` by hand. Compare against the actual bucket distribution from `eval/li-batch-microbench.js` output.

9. **The `tests/diagnose-*.js` cleanup.** Move them to `scripts/diagnostics/`, or delete the ones that are clearly stale (the FP32-vs-INT8 ones are from the ORT era). At minimum, add a comment header to each one stating "DEBUG SCRIPT — NOT IN CI". Several were used to drive perf decisions (per the BF16 commit message); their reliability must be either tested or labeled.

---

## 8. Verdict

**Would I ship this fix-pack as-is?** 

**Yes, but with the self-heal removed.**

The fix-pack lands two genuine defect fixes (C1, C2) that the review found on disk. It improves the DDD posture (H1) at the cost of introducing a duck-typed slot (acceptable trade-off, properly named in this report). It addresses real crash-recovery gaps (H2, H6) with mostly-correct code that has scale ceilings to address later. It tidies a half-dozen low-priority items (M2, M3, M5, L1, L2/L3, L4, L8) without making any of them worse.

The headline complaint is the **C1 self-heal**: 96 lines of dead code defending against a population of one (already healed) machine, with two test cases that synthesize the broken state rather than verifying the actual one. Strip it. The simple atomic swap is the fix.

The secondary complaint is the **H6 commit message** conflating two verification paths and crediting the in-process Map cache for a benefit the pre-warm already provides. The disk sidecar is genuinely useful for cross-process re-runs. The commit message should explain that, not the worker-pool story.

The performance series outside the fix-pack has a more subtle issue: **microbench-driven optimization without end-to-end gates**. The SwiGLU revert is the canonical example, but `b8816c1` and `ad09ab7` are also microbench-only and got merged because they happened to be honest. The next time a microbench-honest commit ships a regression that doesn't show up until full-index, it will be wearing the same uniform as the SwiGLU commit, and the same review process will not catch it. The fix is not in the code — it's in CI: require `node scripts/benchmark-full-index.js` for any commit whose subject contains `perf(`.

The BF16 + cascade headline numbers (1.6× and 18%) **stand**, but the 1.6× is sourced from "previous session notes" rather than a same-session A/B, and the 18% is end-to-end without dispatch coverage data. Both can be made trustworthy with one additional measurement each. Until then, treat them as claims, not facts.

The biggest hidden risk is the **JSON-as-cross-language-contract** in `coreml-cascade.json`. A schema drift between JS, Python, and Rust would silently disable the cascade and lose the 18%. Five lines of validation test would close it.

**Bottom line**: the fix-pack is mostly right, the perf series is mostly right, the documentation is mostly right. The 30% that isn't right is in the gaps the other reviewers won't look in: defensive theater, dead-code redundancy, microbench bias, language-coverage blind spots, and cross-language schema drift. Codex should focus the second-pass review on those gaps. The first-pass swarm has the rest.

---

## File:line evidence index (for quick re-checking)

- C1 self-heal dead code: `core/ranking/late-interaction-index.js:1700-1797`
- `_finalIndexPath` shadow state: `core/ranking/late-interaction-index.js:396, :1511, :1595`
- Atomic swap helper: `core/indexing/indexer-phases.js:87-120`
- C1 regression tests (synthetic, not fixture-based): `tests/indexing/li-staged-save.test.js:144-190`
- H1 duck-typed slot: `core/embedding/embedding-local-model.js:367-376`
- H2 single-string JSON dump (scale ceiling): `core/graph/summary-manager.js:79`
- H2 base64 blob serialization: `core/graph/summary-manager.js:50-65`
- H6 in-process Map cache (redundant with pre-warm): `core/infrastructure/model-fetcher.js:55-118`
- H6 disk sidecar (load-bearing piece): `core/infrastructure/model-fetcher.js:60-86`
- Pre-warm covering main-thread native fetch: `core/indexing/indexer-phases.js:437-463`
- Worker fetching `coderankembed-int8` (the actual stall site): `core/indexing/indexer-worker.js:33`
- L8 silent failure on malformed id: `core/indexing/indexer-ann.js:611-617`
- M3 cap raise from 2 to 6 (legalizes existing coupling): `docs/DDD_ARCHITECTURE.md` ranking exception section
- BF16 1.6× claim source: `git show 1366903`
- gencodesearchnet language coverage gap: `eval/corpus/gencodesearchnet/` (go, java, javascript, php, python, ruby — no rust/c/cpp/swift)
- Rust filename parser hardcoded prefixes: `crates/sweet-search-native/src/inference/embedding_model.rs:140`, `crates/sweet-search-native/src/inference/li_model.rs:127`
- CoreML cascade JSON "single source of truth" claim: `core/infrastructure/coreml-cascade.json:2`
- diagnose-* scripts not in CI: `vitest.config.js:11` (include pattern excludes them)
- diagnose-metal-seqlen.js missing await fix: `git show 1366903` (mentions the fix in the BF16 commit)
- File-size growth from fix-pack: `docs/DDD_ARCHITECTURE.md:340-349`
- Live LI stub (post-fix, healed): `.sweet-search/codebase-late-interaction.db`
- LI segments size on this dev box (2 segments, 190MB, not the "16 × 2.6GB" task scenario): `.sweet-search/codebase-late-interaction.db.segments/`
- `_internals.resetCache` and projectRoot cache (potential daemon leak): `core/indexing/li-skip-policy.js:44-63`
- LI save path with no fsync: `core/ranking/late-interaction-index.js:1459-1685` (grep for `fsync` returns nothing in this file)
- Dispatch counter facility (gated, not reported by default): `crates/sweet-search-native/src/inference/coreml_embedding.rs:140-198`, `crates/sweet-search-native/src/inference/embedding_model.rs:54-69`
- Cascade `pick()` algorithm: `crates/sweet-search-native/src/inference/coreml_embedding.rs:235-248`
- BF16 commit's gencodesearchnet 500q corpus: `eval/corpus/gencodesearchnet/{go,java,javascript,php,python,ruby}` (six dirs total)
