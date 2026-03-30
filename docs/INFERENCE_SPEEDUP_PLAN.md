# Inference Speedup Plan

**Date:** 2026-03-30
**Status:** Proposed
**Scope:** Maximize local embedding inference throughput during indexing across all supported platforms (macOS Apple Silicon, Linux x86, WSL). This plan is complementary to `PARALLEL_SESSIONS_BUG_PLAN.md` which covers search-serving thread safety.

---

## Problem Statement

Sweet Search indexes codebases by embedding every code chunk through a local ONNX model (CodeRankEmbed INT8, 132MB). Single-query latency is acceptable (~15ms), but indexing large codebases (10K-100K+ files) compounds this into minutes of wall-clock time because:

1. **Single session, serialized inference.** One ONNX session uses ~7 intraOp threads on an M3 Max (12 P-cores + 4 E-cores). Most CPU cores sit idle between batches.
2. **Suboptimal warmup.** The model warms up with `max_length=64`, but indexing uses `max_length=512`. First real batch triggers ORT re-optimization and cache misses.
3. **No periodic keep-alive.** Long idle gaps between interactive sessions let CPU caches go cold.
4. **Graph optimization may not be materializing.** The `optimizedModelFilePath` fallback chain in `onnx-session-utils.js` may silently skip graph caching.

### Current Architecture (Indexing Path)

```
chunks[] → callLocalModelBucketed() → callLocalModel() → session.run() → embeddings[]
                                        ↑ single session, ~7 threads
```

### Target Architecture

```
chunks[] → IndexerPool.embed() → distribute across N workers
                                    ├─ Worker 1: session.run() (T threads)
                                    ├─ Worker 2: session.run() (T threads)
                                    └─ Worker N: session.run() (T threads)
                                  ← gather embeddings in original order
```

---

## Design Principles

1. **Adaptive, not fixed.** Session count and thread budget auto-detect from hardware.
2. **Indexing-only.** The search-serving path stays single-session + mutex (per PARALLEL_SESSIONS_BUG_PLAN.md).
3. **Cross-platform.** Must work on macOS ARM64, Linux x86_64, and WSL2 with identical semantics.
4. **Measure everything.** Every phase has an A/B benchmark gate before merging.
5. **No model changes.** CodeRankEmbed INT8 stays. Model-level optimizations (INT4, backbone swap) are future work.
6. **Profile before optimizing.** Each phase begins with profiling to confirm the assumed bottleneck. Don't fix what isn't broken.

---

## Benchmark Protocol

All phases use the same benchmark methodology for A/B comparison.

### Corpus

Use the sweet-search codebase itself as the benchmark corpus (deterministic, version-controlled).

```bash
# Baseline measurement (run 3 times, take median)
SWEET_SEARCH_BENCH_CORPUS=. sweet-search index --benchmark --sqlite-fast --concurrency=12
```

### Metrics (captured per run)

| Metric | How |
|--------|-----|
| **Total wall-clock time** | `Date.now()` around full index pipeline |
| **Embeddings/second** | `totalChunks / wallClockSeconds` |
| **P50/P95/P99 batch latency** | Per-batch `session.run()` timing |
| **Peak RSS** | `process.memoryUsage().rss` high-water mark |
| **CPU utilization** | `os.loadavg()[0]` sampled every 500ms |
| **First-batch latency** | Time from first `session.run()` call to return (warmup quality) |

### A/B Protocol

1. Checkout `main` → run benchmark 3 times → record median for all metrics.
2. Checkout feature branch → run benchmark 3 times → record median.
3. **Pass criteria:** Embeddings/second improves by ≥10%. Peak RSS does not increase by >2x. No correctness regressions (embedding cosine similarity vs baseline ≥ 0.999).
4. Record results in a `benchmarks/` JSON file for historical tracking.

```bash
# Quick A/B script
git stash && sweet-search index --benchmark > /tmp/baseline.json
git stash pop && sweet-search index --benchmark > /tmp/candidate.json
node scripts/compare-benchmarks.js /tmp/baseline.json /tmp/candidate.json
```

---

## Phase 1: Warmup Fixes (Quick Win)

**Effort:** Small (1-2 files, ~30 lines)
**Est. impact:** 10-30% reduction in first-batch latency, 5-10% steady-state improvement
**Files:** `core/embedding-local-model.js`, `core/session-warmup.js`

### Problem

The embedding model warms up with a single text `["warmup"]` at `max_length=64` (`embedding-local-model.js:368`). This doesn't warm:
- ORT's kernel selection for 512-token sequences
- CPU instruction/data caches for full-size tensor operations
- Memory allocation pools for real batch sizes

### Changes

#### 1a. Realistic warmup input

Replace the single-token warmup with a batch at realistic dimensions:

```js
// In getLocalPipeline(), after model load:
const WARMUP_BATCH_SIZE = 8;
const warmupTexts = Array.from({ length: WARMUP_BATCH_SIZE },
  () => 'x '.repeat(Math.floor(INDEXING_MAX_LENGTH * 0.8 / 2))
);

// Pass 1: JIT compile + kernel selection
await localPipeline(warmupTexts, { pooling: 'mean', normalize: true, truncation: true, max_length: INDEXING_MAX_LENGTH });
// Pass 2: Stabilize CPU caches and branch predictors
await localPipeline(warmupTexts, { pooling: 'mean', normalize: true, truncation: true, max_length: INDEXING_MAX_LENGTH });
```

#### 1b. CoreML shape warmup (Apple Silicon only)

CoreML compiles a separate program per input shape. Warmup at each expected batch size:

```js
if (backend === 'coreml') {
  for (const bs of [1, 8, 16, 32]) {
    const texts = Array.from({ length: bs }, () => 'warmup '.repeat(50));
    await localPipeline(texts, { pooling: 'mean', normalize: true, truncation: true, max_length: INDEXING_MAX_LENGTH });
  }
}
```

#### 1c. Fix interOpNumThreads

Current: `interOpNumThreads: 2` in both `buildLocalSessionOptions()` and `buildSessionOptions()`. For BERT-family sequential encoders, inter-op parallelism adds synchronization overhead without meaningful benefit — layers execute sequentially (output of layer N feeds into layer N+1). Per ORT threading docs, sequential models should use `interOpNumThreads: 1`.

```js
// In buildLocalSessionOptions() and buildSessionOptions():
interOpNumThreads: 1,  // was 2 — BERT layers are sequential, inter-op adds overhead
```

Source: ORT docs (onnxruntime.ai/docs/performance/tune-performance/threading.html).

#### 1d. Periodic keep-alive (optional, for warm server — validate first)

In `session-warmup.js`, optionally add a background timer that fires a lightweight inference every 30 seconds. **Note:** Perplexity research suggests CPU cache eviction may be overstated on consumer hardware with stable background activity. Implement behind an env flag and A/B test before enabling by default.

```js
let keepAliveInterval = null;

export function startModelKeepAlive(pipeline, intervalMs = 30_000) {
  if (keepAliveInterval) return;
  if (process.env.SWEET_SEARCH_MODEL_KEEPALIVE === '0') return;
  keepAliveInterval = setInterval(async () => {
    try {
      await pipeline(['keepalive'], { pooling: 'mean', normalize: true, max_length: 32 });
    } catch { /* swallow — best-effort */ }
  }, intervalMs);
  keepAliveInterval.unref(); // Don't prevent process exit
}
```

#### 1e. CoreML provider tuning (Apple Silicon only)

Current CoreML config only sets NeuralNetwork vs MLProgram flags. Add explicit compute unit and static shape hints:

```js
// In coreml-provider.js getCoreMLExecutionProviders():
{
  name: 'CoreMLExecutionProvider',
  MLComputeUnits: 'CPUAndNeuralEngine',  // Explicitly route to ANE where possible
  ModelFormat: 'MLProgram',               // Newer format, better ANE support (requires macOS 12.3+)
  RequireStaticInputShapes: '1',          // Enable static shape optimizations for bucketed batches
}
```

Source: ORT CoreML EP docs (onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html). Static shapes allow CoreML to skip dynamic dispatch and pre-compile specialized kernels.

### A/B Gate

| Metric | Baseline | Target |
|--------|----------|--------|
| First-batch latency | Measured | ≥50% reduction |
| Steady-state emb/s | Measured | ≥5% improvement |
| Peak RSS | Measured | <10% increase |

---

## Phase 2: Verify Optimized Graph Caching

**Effort:** Small (investigation + 1-2 files, ~20 lines)
**Est. impact:** 10-15% cold-start improvement if currently broken
**Files:** `core/onnx-session-utils.js`, `core/embedding-local-model.js`

### Problem

`buildLocalSessionOptions()` sets `optimizedModelFilePath`, but the HuggingFace transformers.js pipeline may not forward this option to ORT. The multi-candidate fallback at `loadModelWithSessionOptions()` tries `session_options`, then `sessionOptions`, then bare options — if the first two fail, the optimized graph path is silently dropped.

### Changes

#### 2a. Diagnostic logging

Add a startup check that verifies the optimized graph was written after first load:

```js
// After first warmup inference:
const optPath = getOptimizedModelPath(quantLabel);
if (existsSync(optPath)) {
  const stat = statSync(optPath);
  console.log(`[L3b] Optimized graph cached: ${optPath} (${(stat.size / 1e6).toFixed(1)}MB)`);
} else {
  console.warn(`[L3b] WARNING: Optimized graph NOT materialized. Session options may not be forwarded to ORT.`);
  console.warn(`[L3b] Attempted path: ${optPath}`);
  console.warn(`[L3b] Session key used: ${localPipeline.__sweetSessionKey}`);
}
```

#### 2b. Manual ORT session creation (fallback)

If the HF pipeline can't forward session options, bypass it for session creation and create the ORT session directly, then wrap it:

```js
import * as ort from 'onnxruntime-node';

// Direct ORT session with guaranteed options
const session = await ort.InferenceSession.create(modelPath, {
  graphOptimizationLevel: 'all',
  optimizedModelFilePath: optPath,
  intraOpNumThreads: bestIntraOpThreads(),
  interOpNumThreads: 1,
  executionMode: 'sequential',
  enableCpuMemArena: true,
  enableMemPattern: true,
});
```

### A/B Gate

| Metric | Baseline | Target |
|--------|----------|--------|
| Cold-start time (first `index` run) | Measured | ≥10% faster (second+ runs) |
| Optimized graph file exists after run | Check | Must be true |

---

## Phase 3: Adaptive Worker Thread Pool for Indexing

**Effort:** Medium-Large (new file + integration, ~200-300 lines)
**Est. impact:** 2-3x indexing throughput
**Files:** New `core/indexer-pool.js`, modified `core/embedding-local-model.js`, `core/config.js`

### Architecture

```
                    Main Thread
                   ┌──────────┐
                   │ IndexerPool │
  chunks[] ──────→ │ .embed()    │ ──────→ embeddings[]
                   │            │
                   └─────┬──┬──┘
                    ┌────┘  └────┐
               ┌────┴────┐ ┌────┴────┐
               │ Worker 1 │ │ Worker N │    (N = adaptive)
               │ ORT Sess │ │ ORT Sess │
               │ T threads│ │ T threads│
               └──────────┘ └──────────┘
```

### Adaptive Session Count

```js
export function detectIndexerPoolSize(overrides = {}) {
  const logicalCores = overrides.cpuCount ?? os.cpus().length;
  const physicalCores = Math.max(1, Math.ceil(logicalCores / 2));
  const totalMemBytes = overrides.totalMemBytes ?? os.totalmem();
  const modelSizeBytes = 140_000_000; // ~132MB INT8 model + overhead

  // RAM gate: need at least modelSize * sessions + 1GB headroom
  const maxByRam = Math.floor((totalMemBytes - 1_000_000_000) / modelSizeBytes);

  // CPU gate: each session needs ≥2 threads to be useful, and we want
  // at least 1 core free for the main thread + I/O
  const maxByCpu = Math.max(1, Math.floor((physicalCores - 1) / 3));

  const sessions = Math.max(1, Math.min(3, maxByCpu, maxByRam));
  const threadsPerSession = Math.max(2, Math.floor((physicalCores - 1) / sessions));

  return { sessions, threadsPerSession };
}
```

**Expected results by platform:**

| Platform | Logical Cores | Physical | RAM | Sessions | Threads/Session |
|----------|--------------|----------|-----|----------|-----------------|
| M3 Max 128GB | 16 | ~12 | 128GB | 3 | 3 |
| M2 Pro 16GB | 12 | ~8 | 16GB | 2 | 3 |
| M1 Air 8GB | 8 | ~4 | 8GB | 1 | 3 |
| Intel i7 16GB | 16 | 8 | 16GB | 2 | 3 |
| 4-core WSL 8GB | 4 | 2 | 8GB | 1 | 2 |

### Worker Implementation (`core/indexer-worker.js`)

Each worker thread:
1. Loads the ONNX model independently (separate `InferenceSession`)
2. Receives batches via `MessagePort` (text arrays + batch IDs)
3. Tokenizes locally (Rust native tokenizer)
4. Runs `session.run()` with its own thread budget
5. Returns Float32Array embeddings via structured clone (zero-copy transfer)

```js
// Sketch — core/indexer-worker.js
import { parentPort, workerData } from 'worker_threads';
import * as ort from 'onnxruntime-node';

const { modelPath, sessionOptions } = workerData;
const session = await ort.InferenceSession.create(modelPath, sessionOptions);

// Warmup with realistic input (Phase 1 warmup applied per-worker)
await warmupSession(session, sessionOptions);

parentPort.on('message', async ({ batchId, texts, maxLength }) => {
  const embeddings = await runInference(session, texts, maxLength);
  parentPort.postMessage({ batchId, embeddings }, [embeddings.buffer]);
});
```

### Integration with Existing Code

The indexer pool is opt-in for the indexing path. The search-serving path continues using the existing singleton session + mutex.

```js
// In the indexer (wherever callLocalModelBucketed is called during indexing):
import { IndexerPool } from './indexer-pool.js';

const pool = new IndexerPool(); // Auto-detects session count
await pool.init();              // Loads models in parallel across workers

// Replace callLocalModelBucketed with:
const embeddings = await pool.embedBatched(allChunks, { maxLength: INDEXING_MAX_LENGTH });

await pool.shutdown();          // Clean teardown
```

### Optimization: Prepacked Weight Sharing (if N > 1)

ORT supports sharing pre-packed weights across sessions via `CreateSessionWithPrepackedWeightsContainer()` (GitHub issue #15301). This avoids duplicating the weight packing/optimization step for each worker session:

- **First session:** Loads model, packs weights, creates prepacked container (~500-1000ms)
- **Subsequent sessions:** Reuse prepacked container (~50-100ms each, 10x faster init)

This requires custom napi-rs bindings to expose the C++ `AddInitializer()` and `CreateSessionWithPrepackedWeightsContainer()` APIs, which standard `onnxruntime-node` doesn't expose. Worth implementing if Phase 3 A/B shows session init time is a bottleneck. Otherwise, skip — the workers are long-lived and init cost is amortized.

### Important: Search path unchanged

```
Search query → getLocalPipeline() → single session → withOnnxMutex() → result
              (unchanged — per PARALLEL_SESSIONS_BUG_PLAN.md)

Indexing     → IndexerPool → N worker sessions → parallel inference → embeddings
              (new — this plan)
```

### A/B Gate

| Metric | Baseline (1 session) | Target (N sessions) |
|--------|---------------------|---------------------|
| Embeddings/second | Measured | ≥2x improvement |
| Total index wall-clock | Measured | ≥50% reduction |
| Peak RSS | Measured | <2x increase (N × 132MB is expected) |
| CPU utilization (loadavg) | Measured | ≥80% of physical cores |
| Embedding correctness | Baseline | Cosine sim ≥ 0.999 vs single-session |

---

## Phase 3b: Input Tensor Buffer Pooling

**Effort:** Small (1 file, ~40 lines)
**Est. impact:** 5-15% throughput improvement (reduces GC pressure)
**Files:** `core/embedding-local-model.js` or `core/indexer-worker.js`

### Problem

Each batch inference allocates new typed arrays for input_ids, attention_mask, and token_type_ids, then allocates a new Float32Array for output pooling. In Node.js, this creates GC pressure during sustained indexing. The principle of IO Binding (pre-allocating buffers on the target device) applies here — not for device transfer, but for allocation elimination.

### Changes

Pre-allocate a pool of reusable typed arrays sized to the maximum expected batch:

```js
// Buffer pool for inference I/O
const MAX_BATCH = 64;
const MAX_SEQ = 512;
const HIDDEN_DIM = 768;

const inputPool = {
  inputIds: new BigInt64Array(MAX_BATCH * MAX_SEQ),
  attentionMask: new BigInt64Array(MAX_BATCH * MAX_SEQ),
  tokenTypeIds: new BigInt64Array(MAX_BATCH * MAX_SEQ),
};
const outputPool = new Float32Array(MAX_BATCH * HIDDEN_DIM);

// Use subarray views instead of allocating new arrays per batch
function getInputBuffers(batchSize, seqLen) {
  const len = batchSize * seqLen;
  return {
    inputIds: inputPool.inputIds.subarray(0, len),
    attentionMask: inputPool.attentionMask.subarray(0, len),
    tokenTypeIds: inputPool.tokenTypeIds.subarray(0, len),
  };
}
```

This eliminates per-batch allocation and reduces GC pauses during sustained indexing.

### A/B Gate

| Metric | Phase 3 baseline | Target |
|--------|-----------------|--------|
| Embeddings/second | Measured | ≥5% improvement |
| GC pause frequency (--trace-gc) | Measured | ≥30% reduction |
| Peak RSS | Measured | ≤ baseline (should decrease slightly) |

---

## Phase 4: Optimized Batching Strategy

**Effort:** Small-Medium (1-2 files, ~50 lines)
**Est. impact:** 10-20% improvement on top of Phase 3
**Files:** `core/embedding-local-model.js`, `core/indexer-pool.js`

### Problem

Current bucketing (`callLocalModelBucketed`) uses a token budget of 16,384 with hard caps of 64-128 items. This was tuned for single-session inference. With multiple workers, the batching strategy should be re-tuned:

1. **Smaller, more uniform batches** distribute better across workers.
2. **Pre-sorted length bucketing** reduces padding waste within each worker.
3. **Memory guard at 85% RSS** is overly conservative on high-memory machines.

### Changes

#### 4a. Length-aware work distribution

Sort all chunks by estimated token length, then stripe across workers round-robin. This ensures each worker gets a mix of short and long texts, balancing load:

```js
// In IndexerPool.embedBatched():
const sorted = chunks.map((text, i) => ({ text, i, est: estimateTokens(text) }))
  .sort((a, b) => a.est - b.est);

// Stripe into N worker queues
const queues = Array.from({ length: this.workerCount }, () => []);
for (let i = 0; i < sorted.length; i++) {
  queues[i % this.workerCount].push(sorted[i]);
}
```

#### 4b. Per-worker micro-batching

Each worker further batches its queue into micro-batches using the existing token-budget algorithm, but with smaller budgets (since each worker has fewer threads):

```js
const MICRO_BATCH_TOKEN_BUDGET = 8192; // Half of current, per worker
const MICRO_BATCH_HARD_CAP = 64;
```

#### 4c. Remove RSS memory guard on high-memory machines

The 512MB / 85% high-water mark at `embedding-local-model.js:498-499` is unnecessary on machines with 16GB+ RAM. The indexer pool should only apply this guard on low-memory systems:

```js
const memCapBytes = os.totalmem() >= 14_000_000_000
  ? Infinity  // No RSS guard on 16GB+ machines
  : 512 * 1024 * 1024;
```

### A/B Gate

| Metric | Phase 3 baseline | Target |
|--------|-----------------|--------|
| Embeddings/second | Measured | ≥10% improvement |
| Padding waste (tokens padded / tokens used) | Measured | ≥20% reduction |
| Worker load imbalance (max/min batch time) | Measured | <1.5x ratio |

---

## Phase 5: Olive Model Optimization

**Effort:** Medium (build pipeline, 1-2 config files)
**Est. impact:** 10-20% throughput improvement from graph-level optimizations
**Dependencies:** Python environment with `olive-ai` package

### Problem

`graphOptimizationLevel: 'all'` applies ORT's built-in optimizations, but Microsoft's Olive pipeline does more aggressive model-specific transforms:
- Cross-layer operator fusion (e.g., fused multi-head attention)
- Constant folding and dead-code elimination
- INT8 QDQ node optimization (removing redundant quantize/dequantize pairs)
- Platform-specific kernel selection (ARM NEON vs x86 AVX2/AVX-512)

### Changes

#### 5a. Create Olive optimization config

```yaml
# scripts/olive-config.yaml
input_model:
  type: OnnxModel
  model_path: models/CodeRankEmbed-onnx-int8/model.onnx

systems:
  local:
    type: LocalSystem
    accelerators:
      - device: cpu

passes:
  optimize:
    type: OrtTransformersOptimization
    model_type: bert
    num_heads: 12
    hidden_size: 768
    optimization_options:
      enable_gelu_approximation: true
      enable_layer_norm_fusion: true
      enable_attention_fusion: true
      enable_skip_layer_norm_fusion: true
      enable_embed_layer_norm_fusion: true

  # ARM-specific: quantize attention scores to INT8
  dynamic_quantization:
    type: OnnxDynamicQuantization
    per_channel: true
    reduce_range: false

engine:
  evaluator:
    metric: latency
  host: local
  target: local
```

#### 5b. Run Olive and ship optimized model

```bash
python -m olive run --config scripts/olive-config.yaml --output models/optimized/
```

Ship the Olive-optimized model as an alternative alongside the current INT8 model. The session loader picks the optimized version if available.

### A/B Gate

| Metric | Pre-Olive | Target |
|--------|----------|--------|
| Embeddings/second | Measured | ≥10% improvement |
| Model file size | ~132MB | Similar or smaller |
| Embedding correctness | Baseline | Cosine sim ≥ 0.9999 vs un-optimized |

---

## Phase 6: INT4 Quantization

**Effort:** Medium (quantization pipeline + validation)
**Est. impact:** 30-50% throughput improvement over INT8
**Risk:** Potential quality degradation — requires careful validation

### Problem

INT8 dynamic quantization (current) reduces model size 4x from FP32 but still leaves headroom. INT4 weight-only quantization can halve the model size again (~66MB) and reduce memory bandwidth pressure, which is the primary bottleneck on CPU.

### Evidence

- Microsoft (2301.12017): INT4 gives 1.7-2.3x latency speedup over INT8 on CPU for BERT-class models with <1% accuracy loss.
- Arm Inc. (2501.00032): Optimized INT4 kernels on ARM achieve 3-3.2x speedup over llama.cpp baselines.

### Risk: MatMulNBits Performance Regression

ORT GitHub issue #23004 reports that `MatMulNBits` with INT4/UINT4 on CPU can be **10x slower than expected** in some configurations. This appears to be a specific hardware-operator combination issue. GPTQ calibration with code data is essential, and **empirical benchmarking on actual target hardware (M3 Max, Intel) is mandatory before committing to INT4.** Do not ship INT4 based on paper benchmarks alone.

Additionally, Vespa.ai research (2024) shows INT8 achieves 94-98% quality retention on embedding tasks, while INT4 exhibits more dramatic accuracy drops depending on calibration quality. For code embeddings specifically, less published research exists — our own benchmark must be the gate.

### Changes

#### 6a. Quantize model to INT4

Use ONNX Runtime's quantization tools with RTN (Round-to-Nearest) as baseline and GPTQ with calibration data as the quality option:

```python
from onnxruntime.quantization import quantize_dynamic, QuantType

# RTN INT4 (fast, no calibration data needed)
quantize_dynamic(
    "models/CodeRankEmbed-onnx/model.onnx",
    "models/CodeRankEmbed-onnx-int4/model.onnx",
    weight_type=QuantType.QInt4,
    per_channel=True,
)
```

#### 6b. Calibration-based INT4 (GPTQ)

Use a representative code corpus (the sweet-search codebase itself) as calibration data:

```python
from optimum.onnxruntime import ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig

qconfig = AutoQuantizationConfig.avx512_vnni(
    is_static=True,
    per_channel=True,
    bits=4,
    calibration_dataset="sweet-search-code-corpus",
)
quantizer = ORTQuantizer.from_pretrained("models/CodeRankEmbed-onnx")
quantizer.quantize(save_dir="models/CodeRankEmbed-onnx-int4-gptq", quantization_config=qconfig)
```

#### 6c. Quality validation

Run the full sweet-search benchmark suite against the INT4 model:

```bash
# Generate embeddings with both models and compare
sweet-search index --model=int8 --benchmark > /tmp/int8.json
sweet-search index --model=int4 --benchmark > /tmp/int4.json
node scripts/compare-embedding-quality.js /tmp/int8.json /tmp/int4.json
```

**Quality gates:**
- Recall@20 on LI benchmark: ≤1% regression
- Pairwise cosine similarity vs INT8: ≥0.995
- NDCG@10 on code search eval set: ≤2% regression

### A/B Gate

| Metric | INT8 baseline | Target (INT4) |
|--------|--------------|---------------|
| Embeddings/second | Measured | ≥30% improvement |
| Model size | ~132MB | ~66MB |
| Peak RSS per session | Measured | ≥30% reduction |
| Recall@20 | Baseline | ≤1% regression |
| NDCG@10 | Baseline | ≤2% regression |

---

## Phase 7: KALE Asymmetric Query Encoder (Future)

**Effort:** Large (model training/distillation)
**Est. impact:** 3-4.5x faster query-time inference
**Dependencies:** Training infrastructure, evaluation corpus

### Concept

The KALE approach (2304.01016) trains a smaller query encoder (1-2 transformer layers) that produces embeddings aligned with the full document encoder's space via KL divergence. This gives:

- **Indexing:** Full encoder (unchanged) — quality preserved
- **Query time:** Tiny encoder (1-2 layers) — 3-4.5x faster

This is particularly valuable for interactive search where every millisecond of query latency matters, while indexing throughput is handled by Phase 3's worker pool.

### A/B Gate

| Metric | Full query encoder | Target (KALE 2-layer) |
|--------|-------------------|----------------------|
| Query latency (p50) | Measured | ≥2.5x faster |
| Recall@20 | Baseline | ≤1% regression |
| NDCG@10 | Baseline | ≤2% regression |

---

## Implementation Order

| Phase | Effort | Est. Impact | Dependencies | Priority |
|-------|--------|-------------|--------------|----------|
| **1: Warmup + session config fixes** | Small | 10-30% first-batch, 5-10% steady | None | **Do first** |
| **2: Graph cache verification** | Small | 10-15% cold start | None | **Do first** (parallel with 1) |
| **3: Worker thread pool** | Medium-Large | 2-3x indexing throughput | Phase 1 (warmup per worker) | **Core work** |
| **3b: Buffer pooling** | Small | 5-15% | Phase 3 | After Phase 3 |
| **4: Batching optimization** | Small-Medium | 10-20% on top of Phase 3 | Phase 3 | After Phase 3 |
| **5: Olive optimization** | Medium | 10-20% | Python tooling | Independent |
| **6: INT4 quantization** | Medium | 30-50% (risky) | Quality validation + MatMulNBits testing | After Phase 3, benchmark-gated |
| **7: KALE asymmetric encoder** | Large | 3-4.5x query speedup | Training infra | Future |

Phases 1 and 2 can be done in parallel. Phase 3 is the core deliverable. Phase 3b is a quick follow-up. Phases 4-6 are independent optimizations that stack on top. Phase 7 is a future project.

---

## Cumulative Speedup Estimates

Assuming multiplicative gains (each optimization reduces the remaining time):

| After Phase | Estimated Cumulative Speedup | Confidence |
|-------------|------------------------------|------------|
| 1 + 2 | 1.2-1.4x | High |
| + 3 | 2.5-3.5x | High |
| + 3b | 2.7-3.8x | High |
| + 4 | 3.0-4.2x | Medium |
| + 5 | 3.2-4.8x | Medium |
| + 6 | 4.0-6.5x | Low (MatMulNBits risk + quality gate) |
| + 7 | Query: 10-15x, Index: same as above | Low (requires training) |

---

## What This Plan Does NOT Cover

- **Model backbone swap** (ModernBERT, NeoBERT) — deferred, current models are local SOTA for code search
- **MLX backend for Apple Silicon** — deferred, CoreML EP provides most Apple-specific wins already
- **LookupFFN** — research-stage, not production-ready (check back 2027)
- **Rust end-to-end inference binary** — v2 optimization, after Node.js pipeline is fully tuned. Candle (HF Rust ML) benchmarks show ~10-30% over ORT via JS, not enough to justify the rewrite yet.
- **Search-serving concurrency** — covered by `PARALLEL_SESSIONS_BUG_PLAN.md`
- **Flash Attention on CPU** — Not applicable. Flash Attention optimizes GPU memory access patterns; CPU unified memory hierarchy doesn't have the same bottleneck. Attention is also only ~30% of BERT compute; FFN layers dominate.
- **Apple Silicon AMX instructions** — Undocumented by Apple, risky to depend on across macOS updates. CoreML EP may use them implicitly via Accelerate framework.
- **Thread affinity / core pinning** — Potentially 5-10% improvement but platform-specific and fragile. Worth revisiting if profiling shows thread migration is a measurable bottleneck.

---

## Research References

### Academic Papers

| Paper | ID | Key Finding |
|-------|-----|-------------|
| ModernBERT (Answer.AI/LightOn) | 2412.13663 | 2.65x faster long-context, unpadding, Flash Attention, code-trained |
| NeoBERT (Mila) | 2502.19587 | 46.7% faster than ModernBERT at 4K tokens, MTEB SOTA |
| Fast DistilBERT (Intel) | 2211.07715 | 4.1x over ORT via fused INT8 sparse GEMM kernels |
| LookupFFN (NVIDIA/UW) | 2403.07221 | 2.51x CPU speedup replacing FFN with memory lookups |
| KALE Asymmetric Retrieval | 2304.01016 | 3-4.5x faster query QPS with 1-2 layer query encoder |
| ARM Kernel Optimization (Arm Inc.) | 2501.00032 | 3-3.2x prompt speedup with interleaved INT4 on ARM |
| WindVE CPU-NPU Collab (Huawei) | 2504.14941 | 22%+ concurrency via CPU overflow handling |
| INT4 Quantization (Microsoft) | 2301.12017 | 1.7-2.3x latency speedup over INT8 on CPU |
| Apple Silicon Profiling | 2508.08531 | Quantization perspectives for M-series inference |

### ORT Documentation & Industry Sources

| Source | Key Finding |
|--------|-------------|
| ORT Threading Guide | `interOpNumThreads: 1` for sequential BERT models; inter-op adds sync overhead |
| ORT CoreML EP Docs | `RequireStaticInputShapes`, `MLComputeUnits`, `ModelFormat` options for ANE routing |
| ORT Memory Docs | Shared arena allocator and prepacked weight containers reduce multi-session overhead |
| ORT GitHub #15301 | `CreateSessionWithPrepackedWeightsContainer` enables 10x faster secondary session init |
| ORT GitHub #23004 | INT4 `MatMulNBits` can be 10x slower than expected in some CPU configurations |
| Vespa.ai (2024) | INT8 retains 94-98% embedding quality; INT4 drops more for uncalibrated models |
| ORT vs OpenVINO (ML6 blog) | "Equally good for different sequence lengths and batch-sizes" on Intel CPU |
| Perplexity Deep Research (2026-03-30) | Flash Attention not applicable to CPU; Candle ~10-30% over ORT-via-JS; AMX undocumented |
