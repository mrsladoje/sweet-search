# Sweet Search — Full-Index Performance Review

**Reviewer**: qe-performance-reviewer (parallel swarm)
**Date**: 2026-04-14
**Scope**: Full cold-start indexing for 16,347 docs on M3 Max 128 GB. Baseline 34 min (candle+Metal), ~28 min with CoreML cascade.

---

## 1. Hot-path wall-time ranking (16K-doc full index)

Derived from the `Promise.all` structure at `indexer-phases.js:428-434`, LI batching math, and model FLOP counts.

| Rank | Phase | Est. share | Evidence |
|------|-------|------------|----------|
| 1 | Late-interaction encoding | ~55-70% | `indexer-ann.js:614-620`; `cacheBoundLongSeqBatch=1` on M3 Max; LateOn-Code is 149M params. Comment at `indexer-phases.js:313-322` confirms "LI is the dominant cost" |
| 2 | Vector embedding | ~15-25% | CodeRankEmbed 512 tok/chunk, hidden=768 but seq=512 (1/16th activation vs LI). Runs in parallel with LI via `Promise.all` at `indexer-phases.js:428` |
| 3 | HCGS summary regen | ~5-15% | Remote HTTP to Cerebras/Haiku (`indexer-phases.js:230-246`). Network-bound, parallel |
| 4 | HNSW build | ~3-7% | 16K vectors × M=16; usearch O(N·log(N)·M). Sequential after vectors (`indexer-phases.js:454-465`) |
| 5 | Code graph extraction | ~2-5% | Tree-sitter WASM at `ast-chunker.js:84-106`, `GRAPH_BATCH_SIZE=100` flushes |
| 6 | Sparse-gram artifact | ~1-3% | Native Rust at `indexer-sparse-gram.js:82-87` |
| 7 | Binary HNSW + Int8 | ~2-4% | `artifact-builder.js`; only runs on full rebuild or ≥10 file changes |
| 8 | Vocab warmup (Phase 7) | ~1-2% | `index-codebase-v21.js:418-425`, `runFullWarmup({top:1000})`. Unverified cost — see §8 |

**Top-3 optimization opportunities**:
1. LI attention budget at B=1 may be over-conservative — see §2 and §10.1
2. Parallel embed + LI on unified memory contention — §3
3. LI GPU encoder starved when embed is also on GPU — §6

---

## 2. `planAllocation()` correctness

### 2a. Apple Silicon tier → LI batch mapping (`indexer-pool.js:144-149`)

```
base  → batch=8,  budget= 8*2048
pro   → batch=16, budget=16*2048
max   → batch=32, budget=32*2048
ultra → batch=64, budget=64*2048
```

Batch ≈ GPU cores / 2 (comment `indexer-pool.js:140-143`). Defensible as a ceiling.

**Caveat (unverified)**: this baseline is the upper bound for short chunks; `buildLateInteractionBatches` at `indexer-ann.js:126-200` reduces it via attention budget. On M3 Max with L2=16 MB and F32 weights, the attention budget collapses the long-seq tail to **B=1** (see 2c). So the tier mapping is only active on the short-chunk end of the distribution.

### 2b. Upper cap at 4× baseline (`indexer-pool.js:298-301`)

`lateInteractionBatchSizeUpperCap = min(128, baseline × 4)` — on M3 Max: `min(128, 128) = 128`.

**Defensible.** Short code chunks (100-300 tokens) let the packer grow up to 128 items. The packing logic at `indexer-ann.js:183-194` correctly checks both token budget (linear) and attention budget (quadratic) before growing.

### 2c. `computeWeightsAwareBatchCap()` — does B=1@seq=2048 hold on M3 Max?

```
perLayerWeightBytes = 12 × d² × bytesPerWeight = 12 × 768² × 4 ≈ 27 MB
usable = max(0, 16 MB − 27 MB) × 1.0 = 0
→ B = max(1, floor(0 / perItemBytes)) = 1
```

**Math confirms.**

**Unverified assumption**: the formula treats "one whole layer of weights" as resident. In practice, candle + Metal can stream weights layer-by-layer — the *resident* working set is usually one weight block (QKV ~2.25 MB or FFN ~9.4 MB) plus activations. If the real resident set is QKV (2.25 MB), usable ≈ 13.75 MB → **B=2** becomes safe.

**B=1 is defensible but may be leaving 1× on the table** for the long-seq tail. The microbench comment at `indexer-pool.js:316-317` ("B=1 strictly fastest, B=16 was 2.13× slower") backs the decision empirically. **Not a bug**, but worth retesting with `SWEET_SEARCH_LI_L2_SAFETY=1.5`.

### 2d. `embeddingWorkers = 1` default (`indexer-pool.js:177-205`)

Comment cites "2×8 = 37% efficiency vs 1×8 = 80%" — L2 contention. Still valid. The exception at `:196-202` bumps to 2 workers when `SWEET_SEARCH_EMBED_USE_CPU=1` AND LI is on Metal AND `computeCores >= 12`. **Logic is sound** — the "main thread only dispatches Metal commands" premise is correct (see `native-inference.js:244`).

### 2e. Config-knob overlap/contradictions

- `SWEET_SEARCH_LI_ATTENTION_BUDGET` is read in TWO places (`indexer-pool.js:339` and `indexer-ann.js:157`). The env var wins over the options value. Order at `indexer-ann.js:162-170`. **Not a bug**, but easy to lose your way. Clarifying comment needed.
- `SWEET_SEARCH_LI_USE_CPU` vs `SWEET_SEARCH_LI_HYBRID` interaction at `indexer-ann.js:648-653` is correct.
- The 6-flag boolean at `indexer-phases.js:316-321` (`useEmbeddingPool` computation) is hard to audit — truth table comment would prevent regressions.

---

## 3. Parallelism audit — Metal LI + Metal embedding on unified memory

`indexer-phases.js:418-434` launches three coroutines with `Promise.all`:
1. HCGS (HTTP to Cerebras) — network-bound, fine.
2. Vector embedding — native Metal by default.
3. LI — native Metal by default.

**HCGS + native Metal**: no conflict. Clean win.

**Native Metal embed + native Metal LI**: contended. The comment at `indexer-ann.js:632-641` is explicit:

> "the embedding phase's continuous Metal command stream effectively starves the LI GPU encoder"

Confirmed:
- `native-inference.js:244` (`model.embedBatch`) and `:325` (`model.encodeBatch`) both enter the napi addon via candle. Candle maintains a single Metal device/queue per process.
- Metal's `MTLCommandQueue` is FIFO: two Node async tasks submitting to the same device serialize at the queue.

**Verdict**: the current parallel `Promise.all` on native paths is effectively ~partially serialized. The wall-clock gain comes from hiding embed tokenization/Node-side work behind LI compute, not from actual GPU parallelism.

**Bigger concern**: on **unified memory** (M3 Max shared CPU+GPU DRAM), even parallel CPU+GPU contends on DRAM bandwidth.

**Unverified but suggested**: the 34 → 28 min CoreML cascade win implies CoreML dispatches are *not* sharing the same queue (they use ANE). The real wall-time gap between "parallel models" and "sequential models" on pure Metal is probably <10%; the CoreML cascade gain comes from ANE being a separate compute unit.

---

## 4. SQLite write throughput

Current pragmas (`indexer-utils.js:37-46`):
```
journal_mode = WAL
synchronous = NORMAL
wal_autocheckpoint = 4000        -- pages (~16 MB at 4KB page)
mmap_size = 1 GB
cache_size = -64000              -- 64 MB
journal_size_limit = 64 MB
```

### 4a. wal_autocheckpoint=4000

SQLite default is 1000 pages (~4 MB). Current 4000 = ~16 MB, 4× default. [sqlite.org/wal.html](https://sqlite.org/wal.html). **Reasonable bulk-load value.** Higher (10K+) has diminishing returns for this workload.

### 4b. journal_size_limit=64 MB

WAL cap. WAL gets truncated at each checkpoint (~16 MB), so 64 MB is 4× the checkpoint interval. Won't thrash.

### 4c. `--sqlite-fast`

`journal_mode=MEMORY`, `synchronous=OFF`, `cache_size=-64MB`. [sqlite.org forum](https://sqlite.org/forum/info/f832398c19d30a4a): known bulk-load pattern. **Correct for benchmarking; expect <5% gain vs WAL** because SQLite phase is <10% of wall time.

### 4d. Batch sizes

Vectors: `BATCH_INSERT_SIZE=2000` rows × ~5 KB = 10 MB/batch. Reasonable.
Graph: `GRAPH_BATCH_SIZE=100` files. Defensible — graph is <5% wall time.

**Verdict**: pragmas and batch sizes are fine. No SQLite-side changes will materially move the 34-min number.

---

## 5. HNSW checkpoint/resume overhead (`indexer-ann.js:447-468`)

Checkpoint trigger: `elapsed >= 30s AND vectorsSinceCheckpoint >= 1000`.

Per checkpoint: ~33 ms (save + 3× fsync). Over a 30-60s HNSW phase, 1-2 checkpoints total → **~66 ms**. Negligible.

**1000-vector minimum gate**: prevents over-saving when slow storage extends the 30s window. Appropriate.

---

## 6. Hybrid CPU+GPU LI dispatch (`indexer-ann.js:622-679, 748-801`)

The smart bidirectional cursor at `indexer-ann.js:767-801` runs GPU from back, CPU from front. Logic is correct.

**Why opt-in?** Comment at `indexer-ann.js:632-641`:
1. Parallel embed + LI share the Metal queue → embed starves LI GPU
2. Need `SWEET_SEARCH_PARALLEL_LI=0`
3. Need `SWEET_SEARCH_UV_THREADPOOL_SIZE=64`
4. Best on non-unified memory

**Can we enable by default under `SWEET_SEARCH_EMBED_USE_CPU=1`?**

**No, not safely**: under that flag, you'd have:
- 2 embed workers × 5 threads = 10 threads
- + 1 LI CPU session × 7 threads = 17 total
- Shared L2 → exact "multiple ORT sessions fight for cache" pathology the code already solved by `embeddingWorkers=1`.

**Safer minimum change**: keep opt-in; document in the comment that the condition is "hardware with dedicated GPU memory OR at least 16 P-cores of L2 slack".

---

## 7. Native model pre-warm (`indexer-phases.js:372-389`)

- `getNativeEmbeddingModel` → `await fetchModel('coderankembed-fp32')` — this IS the SHA256 verification pass.
- `getNativeLiModel` → same pattern.

**Verdict**: pre-warm hits the right code path. Non-hybrid default benefits (native LI is used via `encodeDocuments` at `late-interaction-model.js:350-352`). Correctly skips native embed when `SWEET_SEARCH_EMBED_USE_CPU=1`.

**Related finding from correctness reviewer**: the 2-min stall the pre-warm was designed to fix comes from per-worker SHA256 verification. Each embedding worker independently re-hashes the same 596 MB safetensors — the verification passes are serialized under load. Consider a "verified once per process" cache.

---

## 8. Vocabulary warmup phase (`index-codebase-v21.js:418-425`)

`await runFullWarmup({ depth: 'medium', top: 1000 })`.

**Unverified**. Based on naming, reads like real retrieval calls. If it's ~50-200ms × 1000 queries, that's 50-200 seconds (2-5% of 34 min). If it's just loading vocab files, it's sub-second. **Flag for investigation** — read `core/vocabulary/vocab-warmer.js::runFullWarmup` as follow-up.

---

## 9. SOTA comparisons (2025-2026)

### 9a. ColBERT indexing pipelines

**PLAID** ([arxiv.org/abs/2205.09707](https://arxiv.org/abs/2205.09707)): SEARCH optimization (centroid pruning), NOT an indexing speedup. Not directly applicable.

**ColBERTv2 residual encoding** ([aclanthology.org/2025.coling-industry.30.pdf](https://aclanthology.org/2025.coling-industry.30.pdf)): centroid + 2-bit residuals. Would compress served LI index ~4× further but would NOT speed up indexing.

**Mixedbread maxsim-cpu**: SEARCH optimization, not INDEX BUILD. Not applicable.

**Batch packing**: Sweet Search's dual-cap (token budget linear, attention quadratic) at `indexer-ann.js:179-200` is consistent with SOTA — length bucketing is the standard fix.

**Verdict**: no actionable SOTA technique missing from the indexer side.

### 9b. usearch HNSW build

[apache/lucene#15504](https://github.com/apache/lucene/issues/15504): Lucene's "reusing graphs during merge" is segment-merge optimization, not checkpoint/resume. Different problem.

**Verdict**: Sweet Search's checkpoint-every-30s sequential-order-only scheme is consistent with SOTA.

### 9c. SQLite bulk insert 2025-2026

Pragmas match [sqlite.org/wal.html](https://sqlite.org/wal.html), [shivekkhurana.com/blog/sqlite-in-production/](https://shivekkhurana.com/blog/sqlite-in-production/). Nothing missing.

---

## 10. Top 5 concrete performance improvements

### 10.1. Investigate LI L2 cache safety factor on M3 Max
- **Location**: `onnx-session-utils.js:148-163`, `indexer-pool.js:326-329`
- **Fix**: benchmark B=2 at seq=2048 vs B=1 on candle Metal. If real resident working set is QKV-only, B=2 is feasible.
- **Impact**: **unverified**. Potentially 2-5% wall time. Low cost to test.

### 10.2. Default `SWEET_SEARCH_LI_PROFILE=1` gated by `--verbose`
- **Location**: `indexer-ann.js:705-720`
- **Fix**: auto-enable LI profiling in `--verbose` mode for always-on observability.
- **Impact**: zero wall time directly; unblocks 5-15% future gains.

### 10.3. Audit `finalizeBatchResults` single-threaded JS cost
- **Location**: `indexer-ann.js:721-744`
- **Fix**: measure `finalizeMs` / `encodeMs` ratio. If `parRatio < 1.5` on hybrid or `finalizeMs > encodeMs × 0.3` on single-encoder, the finalizer is blocking next batch dispatch.
- **Impact**: **unverified**. Potentially 3-8% wall time. Free to measure.

### 10.4. Clarify `SWEET_SEARCH_LI_ATTENTION_BUDGET` override precedence
- **Location**: `indexer-ann.js:157-170`
- **Fix**: read in one place; add comment.
- **Impact**: zero wall time. Maintenance.

### 10.5. Measure and optionally background Phase 7 vocab warmup
- **Location**: `index-codebase-v21.js:418-425`
- **Fix**: instrument duration. If > 5%, move to fire-and-forget background task.
- **Impact**: **unverified**. Plausibly 2-5%.

---

## Unverified claims flagged for future benchmark validation

1. "B=1 strictly fastest vs B=16 (2.13× slower)" — `indexer-pool.js:316-317`. Microbench not located in-tree.
2. "2×8 = 37% efficiency vs 1×8 = 80%" — legacy, still valid on M3+ but not re-verified.
3. Parallel Metal LI + Metal embed wall-time win — Metal queue is shared.
4. `runFullWarmup` cost (Phase 7) — file not read.
5. CoreML cascade 18% speedup mechanism — hypothesis (ANE is separate) not verified.

## Sources
- https://sqlite.org/wal.html
- https://sqlite.org/pragma.html
- https://shivekkhurana.com/blog/sqlite-in-production/
- https://sqlite.org/forum/info/f832398c19d30a4a
- https://arxiv.org/abs/2205.09707
- https://aclanthology.org/2025.coling-industry.30.pdf
- https://www.mixedbread.com/blog/multimodal-late-interaction-billion-scale
- https://github.com/apache/lucene/issues/15504
