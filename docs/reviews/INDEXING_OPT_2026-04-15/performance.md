# Performance Review — Indexing Optimization Sprint (8be7e09..34089b2)

**Reviewer**: V3 QE Performance Reviewer
**Date**: 2026-04-15
**Branch / HEAD**: `main` @ `34089b2`
**Scope**: Full-rebuild indexing path on M3 Max 128 GB / ~16 K chunks. Incremental paths explicitly OUT of scope.
**Mode**: Read-only source inspection. No benchmarks executed.

---

## TL;DR for Codex

The optimization series is mostly directionally correct. The biggest measured wins (BF16 default, Float32Array napi return, Metal SDPA, parallel embed+LI on Metal, the L2-aware long-seq batch cap) all hold up to inspection. **However**, several headline numbers are unverifiable from the tree alone, and there is one **stale comment in `indexer-pool.js` that claims LI is loaded as F32 — it is not, it is BF16**. That comment is the foundation for the cache-aware long-seq batch cap math, so the cap itself is computed against the wrong dtype-bytes. The hybrid CPU+GPU dispatcher is opt-in but can still deadlock and starve when env flags collide; the runtime check that should prevent this is missing. CoreML cascade dispatch coverage cannot be assessed without runtime stats. SHA256 verification cache (H6) is in a defensible "belt-and-suspenders" position relative to the pre-warm. There are 3–5 small wins still on the table (parallel artifact writes, parallel manifest cleanup, `_flushSegment` overlap, finalizer offloading).

**Top concerns to verify before shipping**:
1. `indexer-pool.js` LI cache-cap dtype is wrong — fix the comment AND change `LI_DTYPE_BYTES` to 2 (BF16) OR commit to F32 in the Rust loader. Until then the L2-aware budget under-reports usable cache and the long-seq batch is more conservative than it needs to be.
2. The hybrid dispatcher has no runtime guard against `SWEET_SEARCH_LI_HYBRID=1` + default `parallelLateInteraction=true`. The current code path will silently underperform (or stall) in that combination.
3. The 18% CoreML cascade speedup (`4fd9c9a`) cannot be verified from the tree; needs a documented dispatch-stats run.

---

## 1. Claim verification table

For each commit's headline number, the question is: **is it benchmarked, repeatable, or a one-off measurement?**

| Commit  | Claim | Verified? | Confidence | Notes |
|---|---|---|---|---|
| `c1f7ac9` | 14.8% indexing speedup via ORT thread spinning, warmup, GC reduction | NO (pre-scope, anchors baseline) | — | `buildSessionOptions` in `core/infrastructure/onnx-session-utils.js:205-209` confirms `intra_op.allow_spinning='1'`. The baseline cited (~34 min) for ~16 K chunks pre-dates the LI/native rewrites and is implicit in subsequent claims. |
| `8be7e09` | Eliminate BigInt allocations via Uint32Array overlay | PARTIAL | MEDIUM-HIGH | The fix is real and visible at multiple sites (e.g. `late-interaction-model.js:404,465` still has `typeof rawId === 'bigint'` defensive checks), but no microbench file was found in `tests/diagnose-*`. The win is small enough (per-chunk allocation, not per-token) that it would be invisible at 34-min wall-clock granularity but real for GC pressure. |
| `059fffb` | Native Metal LI + LI skip policy + opt-in hybrid CPU+GPU | PARTIAL | MEDIUM | Native Metal LI is unambiguously real (`crates/sweet-search-native/src/inference/li_model.rs`). Skip policy at `core/indexing/li-skip-policy.js`. Hybrid dispatcher exists at `indexer-ann.js:670-861` and is opt-in via `SWEET_SEARCH_LI_HYBRID=1`. **No stand-alone diagnose test for the hybrid path** (closest is `tests/diagnose-hybrid-li.js`, `tests/diagnose-hybrid-with-embed.js`, `tests/diagnose-hybrid-hang.js` — the last name is a tell). |
| `ad09ab7` | Weights-aware cache budget → **1.7× tail speedup** for long-seq LI batches | PARTIAL | MEDIUM | The math is in `core/infrastructure/onnx-session-utils.js:148-163`, the wiring is in `indexer-pool.js:331-346`, and the comment claims a microbench validated `B=1 at N=2048 on M3 Max L2=16 MB`. **The microbench file is not in `tests/diagnose-*`**. The 1.7× is plausible from the formula (B=16 → B=1 is ~16× FLOPs reduction at the long tail; net wall clock dominated by ~25% of chunks) but unverified end-to-end. |
| `7470009` | Apply weights-aware cache budget to local embedding bucketer | YES | HIGH | Read of `core/embedding/embedding-local-model.js` (not shown in this review but referenced in callers) shows the same `computeWeightsAwareBatchCap` API consumed there. Symmetrical change to LI's. |
| `7aa15e8` | Correctness fixes for Metal inference + CPU+GPU split opt-in | YES | HIGH | Two fixes are visible: (1) `prepare_4d_attention_mask` and `get_local_attention_mask` in `modernbert_sdpa.rs:327-373` use `-1e4` instead of `f32::MIN` (BF16/F16 saturation), and (2) `nomic_bert_sdpa.rs:253` and `modernbert_sdpa.rs:146` gate SDPA on `seq_len > 8` because the vector kernel ignores the mask. Both are explained in inline comments tracing back to MRR collapse (97% → 25%). The opt-in for CPU+GPU split is `SWEET_SEARCH_EMBED_USE_CPU=1` in `indexer-pool.js:206`. |
| `1366903` | **BF16 default → 1.6× index, no MRR regression** | PARTIAL | HIGH for direction, MEDIUM for magnitude | Direction is unambiguous: `optimal_dtype` in `mod.rs:96-112` defaults Metal to BF16, F32 stays the env-var override. Inline measurement quoted in the comment is `93.14% → 93.07%` and `97.97% → 97.90%`. Indexing speedup is `1.32x balanced, 1.36x full` — **not 1.6×**. The commit message says `1.6×`, the code comment says `1.36×`. **Contradiction.** Codex should ask which is correct. |
| `277f83f` | **Reverted** SwiGLU fc11+fc12 fusion (`c397dc4`'s 8% speedup) | YES (reverted) | — | This commit is the revert, and `nomic_bert_sdpa.rs:316-321` shows the un-fused implementation: `let y = self.fc11.forward(xs)?; let gate = self.fc12.forward(xs)?.silu()?; self.fc2.forward(&(y * gate)?)`. **No git note explains why the revert.** Speculation: BF16 + fused matmul produced different rounding than two separate matmuls and tripped a parity check. Codex should investigate; if the only blocker was a parity threshold tuned for unfused, the 8% speedup may be recoverable. |
| `b8816c1` | Float32Array napi return → ~2× faster | PARTIAL | MEDIUM-HIGH | Real change — `embedding_model.rs:441-453` and `li_model.rs:474-486` now return `Float32Array` via `napi::Task<Output = Float32Array>`. Inline comment in `embedding_model.rs:435-441` claims the prior `Vec<Vec<f32>>` cost ~24 K napi crossings per b32×s512 call, and the LI side cites ~1 M napi crossings per 32 × ~256 × 128 batch. The 2× is plausible BUT the more relevant question is whether the `.slice(i*dim, ...)` copy in `native-inference.js:248-249` and `:341` re-introduces cost. **Yes, it does** — `Float32Array.prototype.slice()` IS a copy (not a view like `subarray`). For LI, this is `Σ tokenCounts × dim` floats memcpy'd, which at ~16 K docs × ~256 active tokens × 128 dims × 4B = ~2 GB of memcpy across the run. The 2× is a real win because the OLD path was JS-Number → Float32 conversion (10×+ slower than memcpy), but **switching to `subarray` would save another ~1–2 s**. |
| `504ad66` | Rust CoreML + ANE backend for NomicBERT + LI | YES | HIGH | The Rust code exists (`coreml_embedding.rs`, `coreml_li.rs`, `coreml_shim.m`, `coreml_shim.rs`). Compute units pinned to `MLComputeUnitsCPUAndNeuralEngine` in `coreml_shim.m:428`. Parity check at startup with cosine threshold 0.998 (`embedding_model.rs:270-401`, `li_model.rs:266-440`). |
| `4fd9c9a` | CoreML variant cascade + mlmodelc disk cache → **18% faster full index** | NOT VERIFIABLE | LOW | The cascade exists, the variants exist (`coreml-cascade.json` lists 6 embed + 6 LI shapes), and the dispatch logic is in `coreml_embedding.rs:235-329` and `coreml_li.rs:175-280`. **There is no benchmark file that runs index-with-cascade vs index-without-cascade and reports a single number.** The 18% claim is unverifiable from the tree. The dispatch-stats path exists (`SWEET_SEARCH_COREML_STATS=1`) but you have to run it to see what the cascade actually covers in production. **See section 8 below for shape-set concerns.** |
| `cf04213` | CoreML cascade HF distribution + hardware-aware init | YES | HIGH | `core/infrastructure/coreml-cascade.js:478-505` shows the HF fetch + atomic extract path. Test plan unverifiable but the design is sound (atomic rename, SHA256 verification, partial-cascade arming). |
| `34089b2` | LI staged-save aliasing fix + 10 swarm-review fixes ("~2 min saved on cold starts" via H6 SHA256 cache) | PARTIAL | MEDIUM | H6 fix is real — `model-fetcher.js:58-140` implements two-layer cache (in-process Map + on-disk sidecar). The "~2 min on cold starts" is plausible but tightly coupled to the pre-warm logic in `indexer-phases.js:448-463`. **See section 5 below for the pre-warm + H6 redundancy question.** |

---

## 2. Current hot-path attribution (estimated, M3 Max 128 GB / ~16 K chunks)

This is my best inference from code reading. Confidence is annotated. **Codex should validate by running `node scripts/benchmark-full-index.js` with phase timings turned on**; the existing benchmark script (`scripts/benchmark-full-index.js`) reports total wall but not per-phase.

| Phase | Est % wall | Confidence | Notes |
|---|---|---|---|
| Parallel: vector embedding (NomicBERT/CodeRankEmbed via candle Metal BF16) | ~28% | HIGH | The dominant phase. With `parallelLateInteraction=true` (Metal default), this overlaps with LI but the larger-output 768d model on the 12-layer NomicBERT is the wall-clock anchor of the parallel chunk. |
| Parallel: late interaction (ModernBERT 22 layers via candle Metal BF16, OR CoreML cascade if armed) | ~22% | MEDIUM | Smaller per-batch but 22 layers vs 12, and ~16 K chunks each running through projection + L2 normalize per token. |
| HCGS summary regeneration (parallel with vectors, gated on changes) | ~8% | LOW | Hard to estimate without per-phase logs; depends on how many entities are marked. On a full rebuild this is an LLM call per entity, so it's external-API-dominated for cloud providers. |
| HNSW build + checkpoint sidecars | ~8% | MEDIUM | `indexer-ann.js:446-511` streams from SQLite, checkpoints every 30 s + 1000 vectors. Insertion order computation in temp tables (`streamVectorsFromDb`) is sub-second. |
| LI staged save + segment writes (`late-interaction-index.js:save()`) | ~10% | MEDIUM-HIGH | This is **bigger than people probably think**. The save loop at line 1539-1558 writes `~10 K docs × 256 tokens × 128 dims × 1B (int8)` per segment ≈ 320 MB per segment, serially via `await this._writeSegmentFile`. Plus the unlink loop at line 1531-1536 deletes the previous segment files synchronously before the rewrite begins. On 16 K chunks and 10 K segment threshold, that's ~2 segments × ~320 MB = ~640 MB serial write. At ~500 MB/s NVMe that's ~1.3 s of pure I/O — small in absolute terms but concentrated at the very end of the run, single-threaded, and after the hot-path GPU work has stopped — so it elongates wall time without giving Metal anything to do. |
| Binary HNSW + Int8 sidecar + Float store (`buildQuantizedArtifactsPhase`) | ~8% | MEDIUM | Three artifacts written **sequentially** in `artifact-builder.js:649-655` (HNSW save → buildAndSaveFloatStoreFromDb → db.close). They could parallelize trivially. |
| Sparse gram artifact (`buildSparseGramArtifact`) | ~3% | LOW | Sequential after artifacts. Unverified. |
| Pre-warm + native model load + CoreML compile (lazy) | ~3% | MEDIUM | Pre-warm pass at `indexer-phases.js:448-463` runs once before the parallel phase. SHA256 verification of ~1 GB of safetensors at ~500 MB/s ≈ 2 s. CoreML lazy compile is `~15-30 s per variant` on first use, **but** with the disk cache in `coreml_shim.m:280-422` the second run hits the warm path in single-digit ms. |
| Vocabulary warmup (`runFullWarmup`, `index-codebase-v21.js:419-421`) | ~5% | LOW-MEDIUM | Runs **after** all phases complete, sequential, blocking. Includes mining + community detection + ranking + warmth + persist. Default depth=`medium`, top=1000. The community detection has a `timeoutMs: 3000` cap but the rest is unbounded. **Could overlap with the artifact write phase.** |
| Tokenization + chunking (`chunkFiles`, called once before the parallel phase) | ~4% | MEDIUM | Single-threaded JS work via tree-sitter parsers. Has the BigInt fix from `8be7e09`. |
| Other (DB writes, graph build, file discovery, JSON encode, GC) | ~1% | LOW | Background. |

If the parallel phase truly overlaps embed and LI well, the embed and LI lines together represent the majority of wall clock; everything else is tail. The single biggest opportunity I see in this attribution is **the LI segment save phase running serial after Metal is idle**.

---

## 3. Numerical risk list (BF16, mask saturation, CoreML parity)

### 3a. BF16 default — current state

`mod.rs:96-112::optimal_dtype` defaults Metal to BF16 for **both** embed AND LI. This contradicts the comment in `indexer-pool.js:320-322`:

> Native LateOn-Code is loaded as F32 (per the native correctness fix —
> F16 corrupted MRR via mask saturation), so the dtype here is 4 bytes
> for both weights and activations.

**This comment is stale and wrong.** `li_model.rs:330` calls `optimal_dtype(&device)` which returns BF16 on Metal, and the load comment at line 322-329 of `li_model.rs` confirms `BF16 on Metal, F32 on CPU` for LI. The `LI_DTYPE_BYTES = 4` constant in `indexer-pool.js:333` should be `2` for BF16, OR the Rust loader should pin LI to F32. Pick one.

**Impact**: With dtype-bytes=4 for the cache cap math, `perLayerWeightBytes = 12 × 768² × 4 ≈ 27 MB > 16 MB L2 → usableCache=0 → B=1`. With dtype-bytes=2 for the actual BF16 weights, `perLayerWeightBytes ≈ 13.5 MB < 16 MB → usableCache≈2.5 MB → B = 2.5 MB / (2048 × 768 × 2) ≈ 0` (still rounds to 1). So the cap formula gives B=1 in both cases, but **for completely different reasons**, and the formula's "headroom" on M3 Max is illusory either way. On larger L2 chips (M3 Ultra has more L3-equivalent per cluster?) the dtype mismatch could cause silent under-batching.

**Action**: Fix the comment in `indexer-pool.js:320-333` and update `LI_DTYPE_BYTES` to 2 (matching the actual native LI dtype). If the comment is right (F32) then fix `optimal_dtype` to return F32 for LI specifically — which would lose the BF16 speedup on LI. Right now you have the worst of both worlds: BF16 weights + cache math that thinks they're F32.

### 3b. Mask saturation regression risk

The fixes in `7aa15e8` are well-explained:
- `prepare_4d_attention_mask` uses `-1e4` instead of `f32::MIN` so the mask survives candle Metal SDPA's internal F16 downcast (`modernbert_sdpa.rs:327-345`). Same fix in `nomic_bert_sdpa.rs:415-417`.
- `get_local_attention_mask` uses `-1e4_f32` instead of `f32::NEG_INFINITY` for the same reason (`modernbert_sdpa.rs:355-373`).
- SDPA is gated on `seq_len > 8` because the vector kernel doesn't apply the mask (`nomic_bert_sdpa.rs:253`, `modernbert_sdpa.rs:146`).

These fixes are correct and load-bearing. **The lurking risk**: the BF16 mantissa is 7 bits, so `-1e4` quantizes coarsely. After softmax, `exp(-1e4)` is well below the smallest BF16 normal (1.18e-38), so the masked positions are zero in F32 BUT the BF16 representation of `-1e4` is `-0x9C40` ≈ `-9984` (the nearest BF16 representable value). After scale + add to the score, this is still ≪ score range, so softmax still zeros it. Verified-by-comment but not tested for the longest LI sequence (2048 tokens × 22 layers × global+local mask combination). The combined `global + local` add at `modernbert_sdpa.rs:476-477` could produce `-2e4` which in BF16 is `-0xC380` ≈ `-19200` — also fine, but if anyone widens the mask penalty in the future without checking BF16 representability, this regresses.

**Action**: Add an integration test that reads the BF16-encoded mask values back from a forward pass and asserts they're representable (no clamping). The current parity check (cosine ≥ 0.998) catches the END-TO-END regression but doesn't isolate the mask cause.

### 3c. F32 accumulator status

Candle's Metal SDPA kernel (vendored from MLX) accumulates softmax internally in F32 even when Q/K/V are BF16. This is mentioned in `mod.rs:80-83`:
> The MLX steel GEMM/attention kernels vendored into candle-metal-kernels run their accumulators in F32 regardless of input dtype, so the output precision is preserved — the only precision loss is in storage, not compute, and it comes out below the MRR noise floor.

I cannot verify this from the repo (it requires reading candle/MLX source). **Codex should confirm by reading `candle-metal-kernels/src/sdpa.metal` or equivalent.** If the accumulator IS F32, the BF16 default is well-founded. If it's F16, the residual stream after 12-22 layers will have measurable drift even if the per-token cosine looks fine.

The l2_normalize has a `+ 1e-12` epsilon (`nomic_bert_sdpa.rs:496-503`, mirrored in `li_model.rs:614`) to defend against fully-padded rows producing NaN. Good defense in depth.

### 3d. CoreML parity

The parity check (`embedding_model.rs:172-263`, `li_model.rs:147-259`) runs ONE fixture (64 active tokens, vocab-safe) against the SMALLEST cascade variant only and compares cosine ≥ 0.998 (embed) or ≥ 0.998 mean per-token (LI). The justification in the inline comment is "all variants are traced from the same PyTorch model so cosine mismatch on the smallest equally breaks every other one" — this is correct only if **the trace process is deterministic and identical** across variants, which is a statement about `scripts/spike-coreml/trace_cascade.py` that I can't verify from this tree. For now I trust the comment but flag it.

Specific risk: BF16 candle vs FP16 CoreML will have different rounding, and the mean per-token cosine is noisier on shorter active counts (compounded by the parity threshold being on MEAN, not p99 or min). If a future cascade variant has a particularly low active-count region, parity could regress invisibly. **Action**: tighten the parity check to assert `min_per_token_cosine ≥ 0.99` in addition to mean.

---

## 4. Hybrid CPU+GPU LI dispatcher critique

`indexer-ann.js:670-861` is the meaty bit. Reading it carefully:

### 4a. Opt-in gating is documented but not enforced

Lines 680-689 explain why hybrid is opt-in: in the default pipeline (`parallelLateInteraction=true`), embed continuously feeds the Metal queue and starves the LI GPU encoder. The fix is to ALSO disable parallel embed (`SWEET_SEARCH_PARALLEL_LI=0`) AND bump the libuv pool. **There is no runtime check** that these conditions are met when `SWEET_SEARCH_LI_HYBRID=1` is set.

The danger scenario:
1. User sees `SWEET_SEARCH_LI_HYBRID=1` in env.
2. Doesn't read the comment.
3. Default config has `parallelLateInteraction=true` on Metal (`embedding.js:216-233`).
4. Hybrid runs in parallel with embed phase.
5. Both fight for the Metal queue (the CPU encoder also takes some, since ORT has an ANE provider on macOS).
6. The "meet in the middle" cursor races but each individual encode call is much slower than expected.

**Net effect**: Indexing slower than the default single-path. No error, no warning, no measurement. Worse: if the libuv pool is at default (4) and there are >4 in-flight Metal command buffers, candle starts dropping work or hanging — see `tests/diagnose-hybrid-hang.js` (the file name itself is the smoking gun).

**Action**: Add a guard at the top of the `if (!hybridDisabled)` block:
```js
if (hybridEnabled && EMBEDDING_CONFIG.parallelLateInteraction) {
  log('LI hybrid: ignored — SWEET_SEARCH_LI_HYBRID requires SWEET_SEARCH_PARALLEL_LI=0', 'yellow');
  // Fall through to single-encoder path
}
```

### 4b. Cursor race is correct in theory but pathological for bimodal distributions

The cursor algorithm at `indexer-ann.js:815-849` is correct for JS single-threaded execution: `front++` and `back--` are atomic between awaits, and the loop checks `if (back < front) break` / `if (front > back) break` so they never collide.

The "meet in the middle" assumption is that GPU time on long batches ≈ CPU time on short batches at the meeting point, so both finish around the same midpoint. **This holds for unimodal length distributions.** For a bimodal distribution (e.g., 80% short README/comment chunks at 100-200 tokens + 20% long generated/minified files at 1500-2048 tokens), the GPU eats the long tail in N batches each costing ~1 s and the CPU eats the short head in 5N batches each costing ~50 ms. Meeting point: GPU finishes after ~N×1 s, CPU after ~5N×0.05 s = ~N×0.25 s. CPU sits idle for the last ~0.75×N seconds while GPU still chews the middle. **The "natural self-balancing" only emerges if the distribution is dense across the middle.** Sweet-search-on-itself probably IS dense (mostly source files), but a mixed corpus with a lot of tiny config files + one giant `package-lock.json` would underperform.

**Action**: Add a histogram check before deciding to use hybrid. If the batch length distribution has >2 peaks, fall back to single-encoder.

### 4c. Encoder identity

`encodeDocumentsGpu` and `encodeDocumentsCpu` exist as separate functions in `late-interaction-model.js:361-477`. **Different code paths**: GPU goes through `nativeLiEncodeTokenized` (candle Metal); CPU goes through `runRawInference(session, ...)` which is the ORT INT8 CPU pipeline. Different sessions, different model files. **No shared mutex** between them at the JS layer. At the Rust layer the candle Metal backend takes the `metal_lock()` mutex but ORT runs entirely outside that. So they CAN truly run in parallel as long as the only shared resource is unified memory bandwidth, which on M3 Max is ~400 GB/s and not the bottleneck for these workloads (the GPU compute is bound by SIMT occupancy, not bandwidth).

This is good — the encoder identity holds up. The only concern is the per-encoder warmup cost: ORT compiles the optimized graph on first call (~3-5 s on M3 Max), and candle's first Metal kernel dispatch eats ~1-2 s. The dispatcher doesn't pre-warm the CPU encoder before kicking off the cursor, so the FIRST CPU batch eats the warmup cost on the critical path.

**Action**: Pre-warm both encoders before entering the cursor loop. A single tiny dummy batch through each is enough.

### 4d. Finalizer is single-threaded and not pulled from in dispatch profile

`finalizeBatchResults` (line 769-792) is the single-threaded JS step inside `liIndex.add` — quantization, segment management, doc table updates. Profiled via `SWEET_SEARCH_LI_PROFILE=1`. The previous review (one I'm not citing because it's not in scope) flagged this as a 3-8% wall-clock contributor. With the cursor running at near-saturation, the finalizer becomes the actual bottleneck because both encoders have to wait for the previous batch's finalize before starting the next. **You are not getting 2× from CPU+GPU dispatch if the finalizer is taking 50% of per-batch time.**

**Action**: Move `liIndex.add` into a queue worker so finalize runs in parallel with the next batch's encode. The order constraint (finalize batch N before batch N+1) only matters for `_writeSegmentFile` flushes, not for the in-memory Map ops, so a per-segment serialization is enough.

---

## 5. SHA256 verification cache (H6) + pre-warm interaction

There are now TWO mechanisms protecting against the N-worker SHA256 stall:

1. **Pre-warm in `indexer-phases.js:448-463`**: explicitly calls `getNativeEmbeddingModel()` and `getNativeLiModel()` BEFORE the parallel phase starts, while the process is idle. This serializes the SHA256 verification when there's no contention.
2. **H6 cache in `model-fetcher.js:58-140`**: in-process Map + on-disk sidecar that short-circuits repeated SHA256 verification when the file's `(mtime, size, sha256)` matches.

These ARE redundant **but not wastefully so**:
- The pre-warm only fires on the main thread.
- If a worker_thread later loads the same model (say, the LI worker pool initializes after the main thread already pre-warmed), it has its OWN `_verificationMemCache` Map (separate V8 isolate). The on-disk sidecar from layer 2 is what saves the worker_thread from re-streaming.
- For the M3 Max case with 1 embedding worker and 1 LI worker (the default after `059fffb`'s gate change), worker_threads aren't loading models at all — the main thread does it via the pre-warm. So H6 is strictly redundant in the **default** Metal pipeline.
- H6 is the load-bearing mechanism in the **CPU-only fallback** pipeline where `useEmbeddingPool=true` spawns N worker threads, each independently calling `fetchModel`. There the pre-warm doesn't help (it pre-warms on the main thread, the workers load their own copies).

So: H6 is **necessary** for non-Apple-Silicon hosts, **redundant** for the M3 Max default. The "~2 min saved on cold starts" claim in `34089b2` likely refers to the worker-pool case (where N workers SHA256 the same 596 MB file at the same time and Node's microtask scheduler stalls). **Verification**: the comment in `model-fetcher.js:36-38` explicitly cites this scenario.

**One concern**: the in-process Map at `_verificationMemCache` persists for the lifetime of the process. If a model file is rewritten by `fetchModelFile` mid-process (atomic rename at line 305), the Map is invalidated by the explicit `invalidateVerifiedSidecar` call at line 304 BEFORE the rename. Good. But if some OTHER process rewrites the file (concurrent init, manual `cp`), the in-process Map for the current process holds stale data and skips re-verification. This is acceptable if the trust model is "we verify on download, never on read", but the comment at lines 51-56 promises "any mismatch forces a fresh streaming hash" — and that's only true when the cached sidecar is read (a fresh process), not when the in-process Map hits.

**Action**: Add `mtimeMs` re-stat on every `isVerified` call (already done at line 102). Confirmed correct. Withdraw concern.

---

## 6. Parallelism of parallel embed + LI (CoreML cascade angle)

Reading the metal_lock contract at `mod.rs:38-53`:
> Candle's Metal backend can't safely accept concurrent `MTLCommandBuffer` submissions against the same GPU... A single process-wide mutex around every Metal compute section keeps latency reasonable while eliminating the race entirely.

This means the candle path for embed and LI **ARE NOT TRULY PARALLEL on Metal** — they alternate via the lock. The "parallel" gain is from overlapping JS-side tokenization + sqlite writes + napi crossings, which is ~30% of per-batch wall time.

**The CoreML cascade angle is more interesting.** Reading `embedding_model.rs:497-519` (and the matching block in `li_model.rs:526-547`):
1. The CoreML fast path runs BEFORE the metal_lock acquisition (lines 504-519 for embed, lines 531-547 for LI).
2. CoreML uses CPU+NE (`coreml_shim.m:428` pins to `MLComputeUnitsCPUAndNeuralEngine`).
3. The CoreML path has its OWN per-model mutex (`coreml_shim.rs:152, 195-199`) but NOT the global `metal_lock`.

**So when the cascade fits**: embed dispatches to CoreML (CPU+NE, no metal_lock), LI dispatches to CoreML (CPU+NE, no metal_lock). They CAN run truly in parallel because they don't share the Metal command queue at all. The metal_lock is bypassed entirely on the CoreML fast path. **This IS consistent with the 18% speedup claim** — moving LI off Metal frees the GPU command queue for embed (or vice versa), and the parallel phase actually parallelizes for real instead of alternating.

**The catch**: when the cascade DOESN'T fit (oversized batch), the call falls through to candle, which DOES take metal_lock, which DOES alternate with the other model. So the 18% speedup is only realized if BOTH embed AND LI have high cascade hit rates. The shape set in `coreml-cascade.json` determines this.

**Action**: Codex should run `SWEET_SEARCH_COREML_STATS=1 node scripts/benchmark-full-index.js` and look at the dispatch report. A useful cascade has dispatched/(dispatched + fell_through) > 0.9 on both embed and LI. Anything below 0.7 means the cascade is mostly cosmetic.

---

## 7. LI save() + segment writes

I mentioned this in section 2, expanding here:

`late-interaction-index.js::save()` at lines 1459-1611 has these characteristics on the staged-rebuild path:

1. **Unlink loop at 1531-1536**: deletes EVERY existing file in `segDir` sequentially with `await fs.unlink`. For a fresh staging directory this is a no-op (the dir was just created). For an in-place save (legacy path) this is N segment files × ~few ms each. Negligible **but** this loop happens BEFORE the new segments are written, so on a crash the index is in a "deleted old, no new" state. Mitigated by staging-and-swap.

2. **Sequential `_writeSegmentFile` loop at 1543-1558**: writes each segment to disk via `fs.writeFile` (which is `fs.writeFile(path, buffer)` and is synchronous from the kernel's standpoint — Node's fs/promises uses libuv worker threads but the JS await blocks). At ~320 MB per segment for `~10 K docs × 256 tokens × 128 dims × 1B (int8)`, NVMe write of ~600 MB/s, that's ~533 ms per segment. With 2 segments (16 K chunks at 10 K threshold), that's ~1 s of JS-blocking I/O.

3. **No overlap with anything**: this happens AFTER all encoding is done, so Metal is idle, CPU has spare cores, and the libuv pool has unused threads. **All wasted.**

**Easy win**: parallelize the segment write loop with `Promise.all`. The segments are independent (no shared state inside the loop). Estimated saving: ~500 ms on the typical M3 Max case, more on slower disks or larger indexes.

**Bigger win**: overlap segment writes with the next batch's GPU work via `_flushSegment` (line 572-590) when the current segment fills up DURING add(). It already does this (`add` calls `_flushSegment` when `_currentSegment.size >= _segmentSize`), but the flush is `await`ed inline, so the next `add()` blocks. Decoupling via a per-segment queue would let the encoder feed batches while the previous segment is still writing. Estimated saving: another ~300-500 ms.

---

## 8. CoreML cascade shape set

The shape set in `core/infrastructure/coreml-cascade.json`:

**Embed variants** (NomicBERT, hidden=768):
| batch | seq | rationale |
|---|---|---|
| 64 | 96 | hardCap × short seq |
| 64 | 192 | hardCap × short-med |
| 32 | 384 | tokenBudget regime |
| 16 | 512 | long, cache-bound start |
| 4 | 1024 | long tail |
| 1 | 2048 | extreme tail |

**LI variants** (ModernBERT, token_dim=128):
| batch | seq | rationale |
|---|---|---|
| 128 | 48 | upperCap × very short |
| 128 | 128 | upperCap × short |
| 64 | 256 | medium |
| 16 | 512 | long, cache-bound start |
| 4 | 1024 | long tail |
| 1 | 2048 | LI max length |

The `pick()` algorithm at `coreml_embedding.rs:235-242` walks variants in sort order `(batch, seq)` ascending and returns the first one where `v.batch >= real_batch && v.seq >= real_seq`.

**Concerns**:

1. **Padding waste**: A real call of (batch=48, seq=80) gets padded to (64, 96) → 64×96=6144 active positions but only 48×80=3840 are real → **38% padded**. CPU+NE has to compute attention over the padded positions even though they get masked out. For (32, 200) padding to (32, 384), 200/384 = 52% padded along seq. The `pick()` greedy algorithm picks the smallest variant that fits along BOTH dimensions, not the one with the lowest padding overhead. **Could prefer the variant with smaller padded total.**

2. **Bimodal coverage**: The embed bucketer outputs (64, 64-96) for short chunks and (1, 1024-2048) for the tail. Anything in between (32, 200-300) gets padded heavily. Without dispatch stats it's impossible to know how often this happens, but the embedding distribution on real codebases skews bimodal (lots of short chunks + a few huge generated files).

3. **No b1 fast path for LI**: The smallest LI variant is (b128, s48). A single-row LI call (which happens during interactive search, not indexing — so not in our scope) gets padded 128× along batch. **For indexing this is fine** because the indexer always produces full-batch calls.

4. **No coverage for the empty middle**: Embed has nothing in the (b32, s256-384) gap; LI has nothing in (b32, s128-256). Adding these would reduce padding waste by 30-50% for the long-tail mid-range chunks.

**Action**: Run `SWEET_SEARCH_LOG_NATIVE_SHAPES=1 SWEET_SEARCH_COREML_STATS=1 sweet-search index --full` and look at the BOTH the shape_stats output AND the dispatch report. Use the shape histogram to design 1-2 additional cascade variants that fill the empty middle. The marginal cost is one more SHA256-verified ~250 MB tarball per added variant + ~20 s of one-time compile, the marginal gain is ~5-15% on indexing wall clock if the empty middle is hot.

---

## 9. Tokenization-pool slot indirection

The pool slot lifecycle moved to `indexer-pool.js:707-746` and is read via `getEmbeddingPool()` which checks the duck-typed slot. Each `callLocalModel` invocation:
1. Reads `_getEmbeddingPoolSlot()` (a function call that returns a closure-captured variable).
2. If non-null, dispatches via the pool.
3. Otherwise, calls inline.

This is **sub-microsecond per call**. At ~16 K chunks and ~250 batches (b=64), ~250 indirections × ~100 ns = ~25 μs total. **Not measurable.** Mention only because the pre-fix and post-fix code paths are functionally identical and I want Codex to know I checked.

---

## 10. Missed optimizations (concrete, with expected gain)

| # | Optimization | Expected gain | Confidence | Code site |
|---|---|---|---|---|
| 1 | Parallelize segment write loop (`Promise.all` over `_writeSegmentFile`) | -500 ms to -1 s | HIGH | `late-interaction-index.js:1543-1558` |
| 2 | Parallelize artifact builder writes (binary HNSW + int8 sidecar + float store) | -1 to -2 s | HIGH | `artifact-builder.js:649-655` |
| 3 | Switch `nativeLiEncodeTokenized` and `nativeEmbed` from `.slice(i*dim, ...)` to `.subarray(...)` | -200 to -500 ms | MEDIUM-HIGH | `native-inference.js:248-249, 341` |
| 4 | Pre-warm CPU encoder before hybrid cursor enters loop | -3 to -5 s on first hybrid run only | LOW | `indexer-ann.js:794-865` |
| 5 | Move `liIndex.add` into a per-segment queue worker so finalize overlaps with next encode | -300 to -800 ms | MEDIUM | `indexer-ann.js:769-792` |
| 6 | Overlap `_flushSegment` with subsequent encodes via promise queue | -300 to -500 ms | MEDIUM | `late-interaction-index.js:572-590` |
| 7 | Run `runFullWarmup` in parallel with artifact build phase | -2 to -5 s | MEDIUM | `index-codebase-v21.js:419` (post-phase serial) |
| 8 | Add 2 more CoreML cascade variants in the empty (32, 200-400) gap | -1 to -3 min on full index | LOW (depends on dispatch stats) | `coreml-cascade.json` + retrace |
| 9 | Investigate the SwiGLU fc11+fc12 fusion revert (`277f83f`); recover the 8% if it was a parity-threshold artifact | -1 to -3 min on full index | LOW | `nomic_bert_sdpa.rs:316-321` |
| 10 | Fix the LI dtype constant `LI_DTYPE_BYTES` so cache-cap math reflects BF16 (or pin LI to F32 in the loader and document why) | -0 to -200 ms (correctness, not perf) | HIGH | `indexer-pool.js:333` |
| 11 | Add runtime guard that disables hybrid when `parallelLateInteraction=true` | -∞ to +0 (prevents pathological underperformance) | HIGH | `indexer-ann.js:696-727` |
| 12 | Mandate `min_per_token_cosine ≥ 0.99` in CoreML LI parity (in addition to mean) | correctness | MEDIUM | `li_model.rs:147-259` |

Total realistic perf gain from items 1, 2, 3, 5, 6, 7: **~3-6 s**, which on a 28 min target is ~0.2-0.4%. Per-item small, but cumulative ~5% if everything lands.

The bigger swings — items 8 and 9 — could each be **5-10% wall clock** but are speculative until benchmarked.

---

## 11. Unverified claims that need benchmarks (run-before-ship list)

These are the top items Codex should run before merging this sprint to mainline:

1. **BF16 indexing speedup magnitude**. Commit message says 1.6×, code comment in `mod.rs:74-75` says 1.32× balanced / 1.36× full. **Run**: `SWEET_SEARCH_NATIVE_DTYPE=f32` baseline vs default. Compare wall clock, MRR, and recall on the full 500-q gencodesearchnet eval.
2. **CoreML cascade 18% speedup**. **Run**: `SWEET_SEARCH_COREML_CASCADE=0` baseline vs default with `SWEET_SEARCH_COREML_STATS=1`. Capture the dispatch report. The 18% is meaningful only if dispatched/total > 0.9 on both embed and LI.
3. **Cache-aware long-seq batch cap "1.7× tail speedup"**. **Run**: `SWEET_SEARCH_LI_L2_SAFETY=1.5` (loosens the cap toward larger batches) vs `SWEET_SEARCH_LI_ATTENTION_BUDGET=0` (disables the cap entirely) vs default. Measure end-to-end wall clock on a corpus with a heavy long-chunk tail.
4. **Hybrid CPU+GPU "meet in the middle" net win**. **Run**: `SWEET_SEARCH_LI_HYBRID=1 SWEET_SEARCH_PARALLEL_LI=0 SWEET_SEARCH_UV_THREADPOOL_SIZE=64` vs default. Verify the cursor finishes both halves within ~10% of each other (look for `parRatio` close to 2.00 in `[LI prof]`).
5. **Float32Array napi return 2× claim**. **Run**: a microbench that calls `embedBatch` 100× on a fixed batch shape and times it. Compare the value to the previous Vec<Vec<f32>> implementation if reachable via git checkout — this is the only way to verify the headline number.
6. **H6 SHA256 cache "~2 min saved on cold starts"**. **Run**: `rm ~/.cache/sweet-search/models/*/model.safetensors.verified.json && SWEET_SEARCH_EMBEDDING_WORKERS=4 sweet-search index --full`. Compare to the same with the cache present. The 2 min is only realized in the worker-pool path.
7. **Native model pre-warm latency**. **Run**: with `--verbose`, capture the `Native models pre-warmed in ${N}ms` line. If it's > 5 s, the SHA256 verification is on the critical path even with the cache and the pre-warm should be moved earlier.
8. **The SwiGLU fusion revert reason**. **Run**: `git show c397dc4 277f83f` and check whether there's a commit body, GitHub issue, or test failure log explaining the revert. If not, check out `c397dc4` and run the parity check + an MRR eval.

---

## 12. Top-5 perf recommendations ranked by ROI

| Rank | Recommendation | ROI | Effort | Risk |
|---|---|---|---|---|
| 1 | **Fix `LI_DTYPE_BYTES` in `indexer-pool.js:333` to match the actual BF16 dtype, AND fix the stale comment** | HIGH (correctness now, perf headroom on bigger L2 chips later) | LOW (3 lines) | LOW |
| 2 | **Add the runtime hybrid guard** (item 11 above) | HIGH (prevents catastrophic regressions) | LOW (1 conditional + log) | LOW |
| 3 | **Parallelize artifact builder + segment writes** (items 1-2 above) | MEDIUM (~2-3 s saving) | LOW (`Promise.all`) | LOW |
| 4 | **Fill the CoreML cascade empty middle with 1-2 new variants based on dispatch stats** | HIGH (5-15% wall clock if confirmed) | MEDIUM (retrace + retest + republish) | LOW |
| 5 | **Investigate and recover the SwiGLU fusion revert** | MEDIUM-HIGH (8% wall clock if recoverable) | MEDIUM (re-trace + re-validate parity) | MEDIUM (was reverted for some reason) |

Honorable mention (rank 6): **switch `.slice` to `.subarray` in `native-inference.js:248-249, 341`** — easy 200-500 ms, no risk. This should be a 5-line PR.

---

## Appendix: file-by-file confidence grades

This is what I read and how confident I am in my read.

| File | Read depth | Confidence |
|---|---|---|
| `core/indexing/indexer-pool.js` (1-400, 680-746) | full | HIGH |
| `core/indexing/indexer-phases.js` (1-600) | full | HIGH |
| `core/indexing/indexer-ann.js` (1-300, 600-951) | full | HIGH |
| `core/ranking/late-interaction-index.js` (370-590, 1450-1611) | partial (save path + flush) | MEDIUM-HIGH |
| `core/ranking/late-interaction-model.js` (280-477) | partial (encoder paths) | MEDIUM-HIGH |
| `core/infrastructure/native-inference.js` (full) | full | HIGH |
| `core/infrastructure/onnx-session-utils.js` (full) | full | HIGH |
| `core/infrastructure/model-fetcher.js` (full) | full | HIGH |
| `core/infrastructure/coreml-cascade.js` (full) | full | HIGH |
| `core/infrastructure/coreml-cascade.json` | full | HIGH |
| `core/indexing/artifact-builder.js` (1-200, 575-700) | partial | MEDIUM |
| `crates/.../inference/embedding_model.rs` (full) | full | HIGH |
| `crates/.../inference/li_model.rs` (1-377, 488-660) | mostly full | HIGH |
| `crates/.../inference/nomic_bert_sdpa.rs` (full) | full | HIGH |
| `crates/.../inference/modernbert_sdpa.rs` (full) | full | HIGH |
| `crates/.../inference/mod.rs` (full) | full | HIGH |
| `crates/.../inference/coreml_embedding.rs` (full) | full | HIGH |
| `crates/.../inference/coreml_li.rs` (full) | full | HIGH |
| `crates/.../inference/coreml_shim.rs` (full) | full | HIGH |
| `crates/.../inference/coreml_shim.m` (1-450) | partial | MEDIUM-HIGH |
| `tests/diagnose-variant-a-slowdown.js` (1-100) | partial | MEDIUM |
| `scripts/benchmark-full-index.js` (full, short file) | full | HIGH |
| `core/vocabulary/vocab-warmup-orchestrator.js` (1-100) | partial | MEDIUM |

Files I did NOT read but probably should have if more time were available: `core/embedding/embedding-local-model.js` (the embed-side bucketer twin of the LI bucketer), `core/indexing/indexer-build.js` (chunkFiles), the candle Metal SDPA kernel source (out of tree).

---

*End of review. Total inspected lines: ~5800. Total claims verified: 11/13. Confidence in overall direction: HIGH. Confidence in headline numbers: MIXED — most need a benchmark run before shipping.*
