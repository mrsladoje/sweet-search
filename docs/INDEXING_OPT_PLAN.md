# Indexing Optimization Plan

## Context

The INDEXER_FIX_PLAN (commits bea6772..fedd109) addressed **orchestration-level** bottlenecks:
single-pass indexing, merkle guards, profile system, ColBERT toggles. These eliminated
redundant cold starts and unnecessary work, but **never touched embedding throughput**.

The core bottleneck remains: `callLocalModel()` in `core/embedding-service.js:722-730`
embeds documents **one at a time** in a sequential loop. With CodeRankEmbed (137M params,
768d, 8192 token context) on CPU, each forward pass takes ~400ms. For 4500 docs that's
~30 minutes.

The Claude web chat estimated "10-20 seconds for 10k chunks" assuming proper batching,
sequence truncation, and ONNX optimizations. None of those were implemented.

This plan covers **all identified optimizations** for both the local model (CodeRankEmbed)
and remote providers (Voyage Code 3, Mistral, Jina). It incorporates findings from
ChatGPT and Claude external reviews (2026-02-16).

---

## Current State Audit

### What works
- Model quantization: `quantized: true` on ONNX model load (INT8 weights)
- Voyage: HTTP/2 via undici, connection pooling, circuit breaker, rate limiting
- Voyage: Matryoshka dimensions configured (`[1024, 512, 256]`)
- Indexer: text truncation to 1500 chars per chunk (line 764 of index-codebase-v21.js)
- LRU cache, vocabulary cache, semantic cache, query deduplication
- SQLite: prepared statements + `db.transaction()` wrapping all inserts
- SQLite: `synchronous = NORMAL` for normal mode, fast-build mode with `synchronous = OFF`
- SQLite: `journal_mode = DELETE` (WAL disabled for WSL/Windows compat)

### What's broken or missing

| Issue | File:Line | Impact |
|-------|-----------|--------|
| Local model: no batching (sequential loop) | embedding-service.js:722-730 | **30min for 4500 docs instead of 2-5min** |
| Local model: no length-sorted bucketing | embedding-service.js:722 | Padding waste in mixed-length batches |
| Local model: no `maxLength` / sequence truncation | embedding-service.js:725 | Quadratic attention cost on long inputs |
| Local model: no ONNX session options | embedding-service.js:713 | Missing thread parallelism, graph opts, mem arena |
| Local model: no offline ONNX graph optimization | - | Re-optimizes graph on every cold start |
| Local model: `Array.from(output.data)` per doc | embedding-service.js:726 | Wasteful memory allocation + GC pressure |
| Voyage: `output_dimension` not used during indexing | embedding-service.js:583 | Embedding full 1024d, truncating client-side |
| Voyage: sequential batch loop in `generateEmbeddings` | embedding-service.js:856 | No concurrent batch requests |
| Voyage: no request/response compression | embedding-service.js:572 | Uncompressed JSON payloads over wire |
| All providers: no pre-tokenization caching | - | Re-tokenizes on retries/re-runs |
| All providers: fixed batch size ignores token budget | config.js:210 | Short docs under-batch, long docs over-batch |
| **ColBERT: line embeddings multiply the bottleneck 16x** | index-codebase-v21.js:1167 | **Up to 72k embeddings through same slow path** |

---

## Optimization Tiers

### Tier 0: Pre-Processing (Free, do before everything else)

#### O1. Offline ONNX Transformer Graph Optimization

**Problem**: ONNX Runtime applies graph optimizations (attention fusion, LayerNorm fusion,
GELU fusion, embed layer normalization fusion) at load time on every cold start. This adds
startup latency and the runtime optimizer may miss some optimizations that the offline tool
catches.

**Fix**: Run the ONNX Runtime transformer optimizer once on the CodeRankEmbed model file,
then ship/cache the optimized version:

```bash
# One-time preprocessing step
python -m onnxruntime.transformers.optimizer \
  --input model_quantized.onnx \
  --output model_optimized.onnx \
  --model_type bert \
  --num_heads 12 \
  --hidden_size 768 \
  --opt_level 99
```

This fuses multi-head attention, LayerNorm, GELU, and skip connections into single
optimized kernels. The optimized model loads faster and runs faster.

**PREREQUISITE: Verify model architecture first**

Before running the optimizer, confirm the model's actual architecture. Do NOT assume
`--model_type bert --num_heads 12 --hidden_size 768`. Run:

```bash
python -c "
import onnx
model = onnx.load('model_quantized.onnx')
print('Inputs:', [i.name for i in model.graph.input])
print('Outputs:', [o.name for o in model.graph.output])
# Check for attention pattern: look for MatMul→Softmax→MatMul
for node in model.graph.node:
    if node.op_type in ('Attention', 'MultiHeadAttention', 'MatMul'):
        print(f'{node.op_type}: {node.name}, inputs={list(node.input)}')
"
```

If CodeRankEmbed uses a non-standard attention layout (e.g., GQA, MQA, or a custom op),
the `--model_type bert` flag will produce a broken or unoptimized model. The optimizer
will still run but may silently skip fusions.

**Where to apply**: The model files are cached by `@huggingface/transformers` under
`~/.cache/huggingface/`. We can either:
1. Run the optimizer as a post-download step and point the pipeline at the optimized file
2. Host the pre-optimized model on HuggingFace as a separate repo/branch

**Expected impact**: 5-15% faster inference + faster cold starts (graph opt already baked in).

**Risks**: Requires Python + `onnxruntime` installed for the one-time step. The optimized
model is specific to the ORT version; major ORT upgrades may need re-optimization.

**Files**: New `scripts/optimize-onnx-model.sh`, `core/embedding-service.js` (model path)

---

#### O2. Pre-Optimized ORT Format (.ort)

**Problem**: Even with O1, loading `.onnx` files involves parsing the protobuf model
definition. ONNX Runtime's `.ort` format is a pre-baked flatbuffer that eliminates this
parsing overhead entirely.

**Fix**: Convert the ONNX model to ORT format ahead of time:

```bash
# Convert to ORT format (bakes in all optimizations)
python -c "
import onnxruntime as ort
so = ort.SessionOptions()
so.optimized_model_filepath = 'model.ort'
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
ort.InferenceSession('model_quantized.onnx', so)
"
```

**Expected impact**: Faster model load (eliminates protobuf parse + optimization pass).
Most impactful for CLI tools and frequent incremental indexing where cold starts matter.

**Risks**: `.ort` format is ORT-version-specific. Need to regenerate on ORT upgrades.
The `@huggingface/transformers` pipeline may not accept `.ort` directly; need to verify
or bypass the pipeline (see L7).

**Files**: New `scripts/optimize-onnx-model.sh`, `core/embedding-service.js`

---

### Tier 1: Critical (Expected: 10-50x local speedup)

#### L0. Length-Sorted Bucketing

**Problem**: Even with batching (L1) and sequence length cap (L2), batching a mix of
80-token snippets with 900-token chunks pads everything to the longest sequence in the
batch. With transformers, compute scales with `batch_size * max_seq_len^2`, so one long
doc inflates the cost for the entire batch.

**Fix**: Sort texts by estimated token length before batching, then group into buckets:

```javascript
async function callLocalModelBucketed(texts, options = {}) {
  const maxLength = options.maxLength ?? INDEXING_MAX_LENGTH;  // L2 truncation cap (default 512)

  // Length estimate: ~4 chars/token is a safe default for code.
  // On first indexing run, calibrate against actual tokenizer output (see below).
  const charPerToken = getCalibrationFactor();  // default 4, tuned per-project
  const batchingSafety = options.batchingSafety
    ?? Number(process.env.SWEET_SEARCH_BATCHING_SAFETY ?? 1.15); // batching-only slack, tunable
  const indexed = texts.map((text, i) => {
    const est = Math.ceil((text.length / charPerToken) * batchingSafety);
    const estTokens = Math.max(1, Math.min(est, maxLength)); // clamp: [1, maxLength] — truncation is the real ceiling
    return { text, origIdx: i, estTokens };
  });
  indexed.sort((a, b) => a.estTokens - b.estTokens);

  // Adaptive batch sizing: bigger batches for short texts, smaller for long
  const embeddings = new Array(texts.length);
  let i = 0;

  while (i < indexed.length) {
    // Token-count budget: keep total tokens per batch roughly constant.
    // Key: use the LONGEST doc in the candidate batch (not the shortest)
    // because padding fills every doc to the longest in the batch.
    const tokenBudget = 16384;  // ~16k tokens per forward pass
    const baseHardCap = options.hardCap ?? (maxLength <= 256 ? 128 : 64);
    const resolveHardCap = options.resolveHardCap ?? (() => baseHardCap);
    const memCapBytes = 512 * 1024 * 1024; // 512MB RSS headroom cap
    const memGuardHighWatermark = 0.85;    // only intervene when process is already near cap

    // Peek ahead to find batch size where longest doc * count <= budget.
    // Invariant: candidateLongest is the longest if we INCLUDE this next item,
    // candidateCount is the resulting batch size if we include it.
    // Cap estimates by maxLength: after L2 truncation, padding compute is bounded.
    let batchSize = 1;
    while (i + batchSize < indexed.length) {
      const rawEst = indexed[i + batchSize].estTokens;           // sorted ascending, this would be longest
      const candidateLongest = Math.min(rawEst, maxLength);      // truncation caps actual padding
      const candidateCount = batchSize + 1;                      // batch size if we include this item
      const candidateHardCap = resolveHardCap(candidateLongest); // optional token-aware hardCap policy
      if (candidateCount > candidateHardCap) break;
      if (candidateLongest * candidateCount > tokenBudget) break;
      batchSize = candidateCount;
    }

    // RAM guard (OOM prevention only, not batch shaping).
    // Keep token-budget as the primary shaper; only shrink when RSS is already high.
    const rss = process.memoryUsage().rss;
    if (
      !process.env.SWEET_SEARCH_DISABLE_MEM_GUARD &&
      rss > memCapBytes * memGuardHighWatermark
    ) {
      batchSize = Math.max(1, Math.floor(batchSize / 2));
    }

    const batch = indexed.slice(i, i + batchSize);

    const batchTexts = batch.map(b => b.text);
    const batchEmbeddings = await callLocalModelBatch(batchTexts);

    for (let j = 0; j < batch.length; j++) {
      embeddings[batch[j].origIdx] = batchEmbeddings[j];
    }
    i += batchSize;
  }

  return embeddings;
}
```

**Why this works**: A batch of 64 short docs (100 tokens each) costs the same compute as
a batch of 4 long docs (1000 tokens each). By grouping similar lengths, padding waste
drops from up to 10x to near zero.

**Token-count batching vs fixed batch size**: Instead of `batchSize: 32` everywhere,
set a max token budget per batch (e.g., 16k tokens). Short docs batch in groups of 50+,
long docs in groups of 4-8. This keeps compute per forward pass consistent.

**RAM guard (OOM-only)**: Keep token-budget batching as the performance shaper. The
memory guard should only trigger when live RSS is already close to a configured cap
(e.g., `rss > 0.85 * memCapBytes`), then halve `batchSize` defensively. This avoids
artificial under-batching on healthy machines while still preventing OOM on constrained
hosts. If you want a diagnostic estimate, prefer `poolBytes * scratchMultiplier` over
`seq_len * hidden * layer_fudge` math.

**Expected impact**: 1.5-4.7x on top of L1 (depends on length variance in corpus).
MongoDB's token-count batching study showed 4.7x over naive fixed-size batching. Real
codebases with mixed function/class/comment chunks will see significant gains.

**Calibrating the chars/token estimate**: The `chars / 4` heuristic works for typical
code but can skew on minified JS, unicode-heavy files, or long identifiers. On first
indexing run, sample ~200 texts, run `tokenizer.encode(text).length` (fast, no tensors),
and compute per-sample `chars / tokens`. Use the **median** (p50), not mean, as the
default `charsPerToken` calibration (mean is unstable under minified-file outliers).
For batching only, apply a small safety multiplier (e.g., 1.10-1.20; default 1.15) to
reduce token-budget overshoot from underestimation. Optionally store a conservative
safety statistic (e.g., `p90TokensPerChar`) to cap pathological cases further. Cache
calibration in `.sweet-search/token-ratio.json`.

Make the safety factor configurable (`options.batchingSafety` and/or
`SWEET_SEARCH_BATCHING_SAFETY`) so it can be tuned from real padding-inflation telemetry
without code changes.

**Risks**: None. Accuracy is identical (no truncation change). The sort is O(n log n)
which is negligible vs embedding time.

**Files**: `core/embedding-service.js`

---

#### L1. True Batch Inference for Local Model

**Problem**: `callLocalModel()` runs a `for` loop calling `model(text)` one doc at a time.
The `@huggingface/transformers` pipeline supports batch inputs natively.

**Fix**: Pass the entire batch array to the pipeline in a single call. Use a per-batch
pool allocation to avoid both the `Array.from()` waste and the `subarray()` buffer-reuse
risk (see Memory / Buffer Lifetime Policy below).

```javascript
// BEFORE (current - sequential, copies)
async function callLocalModel(texts) {
  const model = await getLocalPipeline();
  const embeddings = [];
  for (const text of texts) {
    const output = await model(text, { pooling: 'mean', normalize: true });
    embeddings.push(Array.from(output.data));
  }
  return embeddings;
}

// AFTER (batched, safe copy into pool)
async function callLocalModel(texts, options = {}) {
  const model = await getLocalPipeline();
  const { maxLength = INDEXING_MAX_LENGTH } = options;
  const rawOutput = await model(texts, {
    pooling: 'mean',
    normalize: true,
    padding: true,              // pad to batch max (NOT 'max_length' — see L0/L2)
    truncation: true,           // L2: sequence length cap
    max_length: maxLength,      // L2: cap at 512 for indexing (truncation only)
  });

  // Normalize output shape: HF JS pipeline may return either:
  //   - one object with flat .data (batch × dim) — fast path
  //   - array of per-input objects — slow fallback (log warning, consider L7)
  const dim = EMBEDDING_PROVIDERS.local.dimensions.full; // 768
  let flat;
  // Allocate pool buffer up front — used by both fast and slow paths
  const pool = new Float32Array(texts.length * dim);

  const needed = texts.length * dim;

  if (Array.isArray(rawOutput)) {
    // Slow path: HF returned array-of-objects. Single-pass copy into pool.
    console.warn('  [L1] Pipeline returned array-of-objects — slow path. Consider L7 (direct ORT session).');
    if (rawOutput.length !== texts.length) {
      throw new Error(`[L1] Output count mismatch: got ${rawOutput.length} embeddings for ${texts.length} texts`);
    }
    for (let i = 0; i < rawOutput.length; i++) {
      pool.set(rawOutput[i].data, i * dim);  // one .set() per item, no intermediate allocations
    }
  } else {
    // Fast path: flat Float32Array — single bulk copy into pool
    if (rawOutput.data.length < needed) {
      throw new Error(`[L1] Unexpected output size: got ${rawOutput.data.length} floats, need ${needed} (${texts.length} × ${dim})`);
    }
    pool.set(rawOutput.data.subarray(0, needed));
  }

  const embeddings = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    embeddings[i] = pool.subarray(i * dim, (i + 1) * dim);
  }
  // Dev-only guard: catches accidental container mutation (embeddings[i] = ...)
  if (process.env.NODE_ENV !== 'production') Object.freeze(embeddings);
  return embeddings;
}
```

**Buffer safety strategy**: One `Float32Array` allocation per batch (single `new` +
single `.set()` copy), then zero-copy `subarray()` views from our own pool. This avoids
both the N-copy `Array.from()` problem and the buffer-reuse corruption risk. The single
pool copy is negligible: for a batch of 32 x 768d = 98KB, `.set()` takes <0.01ms.
See the **Memory / Buffer Lifetime Policy** section for the full rationale.

**Tokenizer behavior invariant**: Switching from single-text to batched calls changes
the tokenizer's padding behavior. Verify that:
1. **Padding strategy**: Use `padding: true` (pad to batch max), NOT `padding: 'max_length'`.
   `padding: true` pads each batch to the longest sequence in that batch, so short-only
   batches stay short. `padding: 'max_length'` pads everything to `max_length` (1024),
   wasting compute on short batches — exactly the waste L0 bucketing is designed to avoid.
   The `max_length` option still applies as a truncation cap, just not a padding target.
   Either way, `attention_mask` must correctly zero out all padding positions.
2. **Attention mask**: the pipeline must pass `attention_mask` to the model. Mean pooling
   must apply the mask (sum embeddings * mask / sum mask, not sum / seq_len). Check
   whether `@huggingface/transformers` pipeline does this correctly for batch inputs.
3. **Truncation side**: default is right-truncation. Confirm this matches the single-text
   behavior. Left-truncation would keep the end of long functions, losing signatures.

If any of these differ between single and batch mode, embeddings will silently drift.
The `embedding-batching.test.js` test (see below) catches this by comparing sequential
vs batched output on **mixed-length inputs** (not identical-length), which is where
padding differences surface.

**Validation**: The `@huggingface/transformers` v3.8+ pipeline accepts `string[]` input.
Need to verify that CodeRankEmbed ONNX model handles dynamic batch axes. If not, fall back
to fixed-size micro-batches (e.g., 8 or 16 at a time).

**Risks**:
- Memory: batch of 32 x 1024 tokens x 768d could spike RAM. The L0 bucketing with
  token-count budget handles this by auto-sizing batches.
- ONNX model may not have dynamic batch axis exported. Test with batch size 2 first.

**Expected impact**: 10-30x throughput improvement (400ms/doc -> 15-40ms/doc amortized).

**Files**: `core/embedding-service.js`

---

#### L2. Sequence Length Cap

**Problem**: CodeRankEmbed supports 8192 tokens but transformer attention is O(n^2).
Most code chunks are 50-200 lines (~500-2000 tokens). Padding/computing to 8192 wastes
massive compute.

**Fix**: Set `max_length` and `truncation: true` on the pipeline call. Integrated into the
L1 code above.

```javascript
const INDEXING_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_INDEXING_MAX_LENGTH || '512', 10);
const QUERY_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_QUERY_MAX_LENGTH || '512', 10);
```

Both are independently configurable. Indexing might want 512 (or 1024 for dense corpora),
queries might want 256 for lower latency or 512 for full recall. Keeping them separate
prevents "tuned indexing, accidentally slowed query."

**Why 512 (recommended default)**: The indexer already truncates chunk text to 1500 chars
(line 764). At ~4 chars/token, that's ~375 tokens. A 512 cap gives 37% headroom while
being 16x cheaper than 8192. The attention cost difference: 8192^2 = 67M ops vs 512^2 =
262K ops — a 256x reduction.

1024 is the safe-conservative setting if the chars/token estimate is wrong or the corpus
has dense token content (e.g., minified JS). **Default to 512 with a config override
(`SWEET_SEARCH_INDEXING_MAX_LENGTH`)** and only bump to 1024 if benchmarks show a recall
drop on the specific corpus.

**Expected impact**: 4-16x faster per-doc embedding (from sequence length alone).
512 vs 8192 is 256x less attention compute; even vs 1024 it's 4x less.

**Risks**: Extremely long functions or classes could lose trailing context. The 1500-char
truncation in the indexer already limits this. Monitor MRR impact on CodeSearchNet.

**Files**: `core/embedding-service.js`

---

#### L3. ONNX Runtime Session Options

**Problem**: The model is loaded with zero ONNX session configuration. Default settings
use minimal graph optimization and no memory pooling.

**Fix**: Configure ONNX runtime for maximum CPU throughput:

```javascript
import os from 'os';

// In getLocalPipeline():
localPipeline = await pipeline('feature-extraction', EMBEDDING_PROVIDERS.local.model, {
  quantized: true,
  session_options: {
    // Graph optimization (fuses ops, constant folding)
    graphOptimizationLevel: 'all',           // ORT_ENABLE_ALL

    // Thread parallelism
    intraOpNumThreads: bestIntraOpThreads(), // See L3c auto-tuner
    interOpNumThreads: 2,                    // Parallel operator execution
    executionMode: 'parallel',               // Enable parallel execution

    // Memory optimization
    enableCpuMemArena: true,    // Pre-allocate memory pool, avoids malloc/free per inference
    enableMemPattern: true,     // Track allocation patterns, pre-allocate accordingly

    // Persist optimized graph (see L3b)
    optimizedModelFilePath: getOptimizedModelPath(),
  },
});
```

**ACCEPTANCE GATE: ORT option name validation**

The `@huggingface/transformers` pipeline is supposed to forward `session_options` to
`ort.InferenceSession.create()`. Before implementation, verify:

1. Does `pipeline(..., { session_options: {...} })` actually forward all options?
   (Check `@huggingface/transformers` source for the forwarding path.)
2. Do the option names match the ONNX Runtime Node.js API exactly?
   (Some bindings use camelCase, others use snake_case.)
3. If forwarding is partial or broken, **promote L7 from Phase 4 to Phase 1**. Without
   working option forwarding, L3 and L3b become dead code. L7 (direct ORT session)
   becomes the only way to set session options and is no longer "extreme" — it's required.

**Runtime verification (objective gate)**: Don't rely on source reading alone. After
pipeline creation, run an executable check:

```javascript
// Micro-benchmark: compare inference-only medians (exclude model/tokenizer load time).
// If intraOpNumThreads is forwarded, thread=1 should be measurably slower than thread=N.
async function medianInferenceMs(pipelineInstance, testBatch, runs = 5) {
  const times = [];
  // Warmup once to avoid first-run graph/memory effects in measured runs
  await pipelineInstance(testBatch, { pooling: 'mean', normalize: true, truncation: true, max_length: 512 });
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await pipelineInstance(testBatch, { pooling: 'mean', normalize: true, truncation: true, max_length: 512 });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function verifyOrtForwarding() {
  const p1 = await pipeline('feature-extraction', model, {
    quantized: true, session_options: { intraOpNumThreads: 1 }
  });
  const pN = await pipeline('feature-extraction', model, {
    quantized: true, session_options: { intraOpNumThreads: bestIntraOpThreads() }
  });

  const t1 = await medianInferenceMs(p1, testBatch, 5);
  const tN = await medianInferenceMs(pN, testBatch, 5);

  // If multi-threaded isn't at least 30% faster, forwarding is probably broken
  const speedup = t1 / tN;
  if (speedup < 1.3) {
    console.warn(`ORT forwarding check: speedup=${speedup.toFixed(2)}x — session_options may not be forwarded. Consider L7.`);
    return false;
  }
  return true;
}
```

Run this once during development (not in production). If it returns false, skip L3/L3b
and go straight to L7.

**Gate design requirements**:
- Use the **same fixed `testBatch` texts** for both thread=1 and thread=N runs.
- Use a batch size and text length that are **compute-bound** (typically 16-32
  mid-length snippets), so tokenizer overhead does not mask ORT threading effects.
- Keep warmup + multiple measured runs (median) as shown above for stability.
- Optional future split metric: report `tokenize_ms` vs `ort_ms` if L7 timing is added.

**Naming convention guard and implementation path**: Some `@huggingface/transformers`
versions use `session_options` (snake_case), others use `sessionOptions` (camelCase).
In `getLocalPipeline()`, implement: try `session_options` first → run forwarding gate →
if gate fails, retry with `sessionOptions` → if both fail, promote L7. Keep only the
working key in production (detected once at startup, cached):

```javascript
// In dev/debug mode only:
for (const key of ['session_options', 'sessionOptions']) {
  const opts = { quantized: true, [key]: { intraOpNumThreads: 1 } };
  // Load pipeline, run micro-benchmark, check if thread count changed
}
```

If neither naming works, go straight to L7.

Option names intended to match `onnxruntime-node` `SessionOptions` (verify against your
installed ORT version; the runtime forwarding gate above is authoritative):
- `graphOptimizationLevel`: `'disabled'` | `'basic'` | `'extended'` | `'all'`
- `intraOpNumThreads`: number
- `interOpNumThreads`: number
- `executionMode`: `'sequential'` | `'parallel'`
- `enableCpuMemArena`: boolean
- `enableMemPattern`: boolean
- `optimizedModelFilePath`: string (path to save/load optimized graph)

**`enableCpuMemArena`**: Pre-allocates a memory pool so repeated forward passes don't
trigger malloc/free cycles. Particularly impactful for batched inference where the same
allocation pattern repeats thousands of times.

**`enableMemPattern`**: Tracks memory allocation patterns from the first few inferences
and pre-allocates accordingly for subsequent runs. Reduces allocation overhead to near zero
after warmup.

**Warmup**: After loading the model with `enableMemPattern: true`, run 1-2 tiny warmup
batches (e.g., `["warmup"]`) before real inference. This lets ORT observe the memory
allocation pattern and pre-allocate for subsequent batches. Without warmup, the first
real batch pays the pattern-learning cost. The warmup embeddings are discarded.

```javascript
// After pipeline load, before returning:
await localPipeline(["warmup"], { pooling: 'mean', normalize: true, truncation: true, max_length: 64 });
// Discard output — this just primes ORT's memory arena and pattern allocator
```

**Expected impact**: 2-4x speedup (thread parallelism + graph fusion + memory pooling).
Warmup adds ~50-100ms at load time but makes the first real batch 20-40% faster.

**Risks**: Thread contention with Node.js event loop at high thread counts. Use sensible
default of `Math.min(Math.max(1, physicalCores - 1), 8)` for `intraOpNumThreads` to
reserve one core for orchestration/search work. Memory increases with thread count.

**Files**: `core/embedding-service.js`

---

#### L3b. Persist Optimized Graph to Disk

**Problem**: ONNX Runtime re-optimizes the model graph on every cold start. For a 137M
parameter model, this adds 200-500ms of startup latency per process.

**Fix**: Use `optimizedModelFilePath` to save the optimized graph once and reload it on
subsequent runs:

```javascript
import crypto from 'crypto';

function getOptimizedModelPath() {
  const cacheDir = path.join(os.homedir(), '.cache', 'sweet-search');
  fs.mkdirSync(cacheDir, { recursive: true });

  // Deterministic cache key: ORT version + model file hash
  // Prevents stale graph after ORT upgrade or model change
  const ortVersion = require('onnxruntime-node/package.json').version;
  const modelPath = getModelFilePath();  // path to model_quantized.onnx
  const modelHash = crypto.createHash('sha256')
    .update(fs.readFileSync(modelPath))
    .digest('hex')
    .slice(0, 12);

  return path.join(cacheDir, `coderankembed-optimized-ort${ortVersion}-${modelHash}.onnx`);
}
```

On first run, ORT optimizes the graph and saves it to the specified path. On subsequent
runs, it loads the pre-optimized graph directly, skipping the optimization pass. The
filename includes ORT version and model hash, so upgrading either automatically triggers
re-optimization (old files can be cleaned up periodically).

**Expected impact**: 200-500ms faster cold starts. Free speed on repeated indexing runs.

**Risks**: The `readFileSync` for hashing adds ~50ms on first call (137M model). Cache
it in memory after first computation. The deterministic filename eliminates the stale
cache risk entirely — no mtime checks needed.

**Files**: `core/embedding-service.js`

---

#### L3c. Threading Auto-Tuner (Deferred)

**Problem**: Optimal `intraOpNumThreads` and `interOpNumThreads` values depend on the
specific CPU, model, and batch size.

**For Phase 1**: Use the sensible default. Don't over-engineer this.

```javascript
function bestIntraOpThreads() {
  // Physical cores (not hyperthreads), reserve one for Node/event loop, cap at 8
  const physicalCores = Math.ceil(os.cpus().length / 2);
  return Math.min(Math.max(1, physicalCores - 1), 8);
}
```

**For Phase 4 (only if needed)**: Full grid-search tuner that tries
`{cores, cores/2} x {interOp: 1, 2}`, benchmarks 10 docs each, caches the best
config per CPU model. Adds complexity, first-run latency, and cache invalidation
headaches for maybe 10-15% difference. Not worth it unless users report perf issues
on specific hardware.

**Files**: `core/embedding-service.js`

---

### Tier 2: Important (Expected: 2-5x additional)

#### L4. Zero-Copy Embedding Pipeline

**Problem**: Multiple wasteful copies happen in the embedding pipeline:
1. `Array.from(output.data)` converts `Float32Array` to `Array` (doubles memory)
2. `Buffer.from(new Float32Array(embedding).buffer)` in `insertVectors()` creates
   another copy if input is already a `Float32Array`

For 4500 embeddings of 768d: 4500 * 768 * 4 bytes * 3 copies = ~40MB of GC pressure.

**Fix**: L1's pool allocation already solves the embedding output side: each batch
produces a pool `Float32Array` with `subarray()` views. This item audits the rest
of the pipeline to ensure those views flow through without unnecessary copies.

```javascript
// insertVectors: if embedding is already a Float32Array subarray view,
// use byte-offset-aware Buffer.from to avoid copying
embeddingBlob: embedding instanceof Float32Array
  ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
  : Buffer.from(new Float32Array(embedding).buffer),
```

**Audit needed**: Check all consumers of `getEmbeddings()` / `embed()` output:
- `insertVectors()` in index-codebase-v21.js - wrap with byte offset awareness
- `hnsw-index.js` `add()` method - **verified copy-safe in current code**:
  normalizes into a new array and creates `new Float32Array(normalized)` before insert
- `colbert-index.js` - verify accepts `Float32Array`
- `sweet-search.js` cosine similarity - iterates with indexing, compatible
- `floatToBinary()` / `floatToInt8()` - iterate with indexing, compatible
- Search for in-place mutation patterns (`embedding[i] =`, in-place normalize, quantize
  in-place). Mark each consumer path as either **pure/read-only** or **must copy first**.

**Dev rollout guard (mutation sentinel)**: During rollout, add a cheap checksum check in
debug mode to detect accidental in-place mutation after `getEmbeddings()`:

```javascript
function checksum8(v) {
  let s = 0;
  for (let i = 0; i < Math.min(8, v.length); i++) s += v[i];
  return s;
}

const c0 = checksum8(embeddings[0]);
// ... downstream pipeline steps
if (checksum8(embeddings[0]) !== c0) {
  throw new Error('Embedding mutated in-place');
}
```

**Note**: With the L1 pool strategy, `subarray()` views are always safe because we own
the pool buffer. The pipeline's internal buffer is copied once into the pool via `.set()`,
and all downstream consumers read from pool views that never get overwritten. See the
**Memory / Buffer Lifetime Policy** section for the full ownership model.

**Expected impact**: 20-30% less GC pressure, minor latency improvement.

**Files**: `core/embedding-service.js`, `core/index-codebase-v21.js`

---

#### L5. OpenVINO Execution Provider (Intel CPUs)

**Problem**: Vanilla ONNX Runtime uses generic CPU kernels. Intel CPUs have specialized
AVX-512, VNNI, and AMX instructions that OpenVINO exploits.

**Fix**: If running on Intel, add `onnxruntime-node-openvino` and configure:

```javascript
const isIntel = os.cpus()[0]?.model?.includes('Intel');

localPipeline = await pipeline('feature-extraction', EMBEDDING_PROVIDERS.local.model, {
  quantized: true,
  session_options: {
    executionProviders: isIntel
      ? [{ name: 'OpenVINOExecutionProvider' }, 'CPUExecutionProvider']
      : ['CPUExecutionProvider'],
    // ... other options from L3
  },
});
```

**Expected impact**: 1.5-2x on Intel CPUs (on top of L3 gains). Intel's optimum-intel
benchmarks show up to 4.5x for INT8 quantized embedding models with VNNI/AMX acceleration.

**Risks**: Additional dependency. May not be compatible with all ONNX models. Needs
`onnxruntime-node` compiled with OpenVINO support, or separate `openvino-node` package.
Not applicable on AMD/ARM systems.

**Files**: `core/embedding-service.js`, `package.json`

---

#### L6. FP16 Inference on CPU

**Problem**: Even with INT8 quantized weights, activations run in FP32. Some ONNX runtimes
support FP16 compute on modern CPUs with minimal accuracy loss.

**Fix**: Enable via `graphOptimizationLevel: 'all'` which includes FP16 fusion passes.
Already covered by L3. The additional step is verifying CPU support for F16C/AVX-512-FP16
and potentially using a model exported with mixed precision.

**Expected impact**: 1.2-1.5x speedup (depends on CPU support).

**Risks**: Accuracy may degrade slightly. Benchmark MRR before/after.

**Files**: `core/embedding-service.js`

---

#### L7. Bypass Pipeline for Direct ORT Session (Advanced)

**Problem**: The `@huggingface/transformers` pipeline adds overhead per call: tokenizer
wrapping, output object construction, postprocessing. For maximum throughput, the pipeline
convenience layer becomes a measurable bottleneck after L1/L2/L3 are applied.

**Fix**: Load the tokenizer and ORT session separately, run inference directly:

```javascript
import { AutoTokenizer } from '@huggingface/transformers';
import ort from 'onnxruntime-node';

let tokenizer, session;

async function initDirect() {
  tokenizer = await AutoTokenizer.from_pretrained('jalipalo/CodeRankEmbed-onnx');
  session = await ort.InferenceSession.create('model_quantized.onnx', {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: bestIntraOpThreads(),
    enableCpuMemArena: true,
    enableMemPattern: true,
  });
}

async function embedDirect(texts, maxLength = 1024) {
  // Pre-tokenize batch
  const encoded = tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: maxLength,
    return_tensors: 'np',  // or appropriate format
  });

  // Run ORT session directly
  const feeds = {
    input_ids: new ort.Tensor('int64', encoded.input_ids, [texts.length, maxLength]),
    attention_mask: new ort.Tensor('int64', encoded.attention_mask, [texts.length, maxLength]),
  };

  const results = await session.run(feeds);

  // Mean pooling + normalize in tight loop
  const output = results.last_hidden_state.data;
  // ... custom mean pooling with attention mask
}
```

**Expected impact**: 10-30% faster than pipeline path (avoids wrapper overhead).
Most noticeable at high throughput after L1/L2/L3 remove the bigger bottlenecks.

**Risks**: Must replicate exact pooling + normalization logic. Any difference produces
embeddings incompatible with existing indexes. Requires `onnxruntime-node` as a direct
dependency (currently pulled in transitively by `@huggingface/transformers`).

**Priority**: Only implement after L1/L2/L3 if pipeline overhead is measurable in profiling.

**Files**: `core/embedding-service.js`, `package.json`

---

#### M1. Smaller Model for Indexing, CodeRankEmbed for Queries

**Problem**: CodeRankEmbed (137M params) is used for both indexing and queries. But at
query time we have a reranker (FlashRank / Voyage Rerank-2.5) that compensates for lower
initial retrieval quality. Using a smaller model for indexing could be much faster while
the reranker preserves final result quality.

**Current state**: `all-MiniLM-L6-v2` (22M params, 384d) is already loaded for the
SemanticCache (line 383 of embedding-service.js). It's 6x smaller than CodeRankEmbed.

**Trade-off**:

| Model | Params | Dim | CodeSearchNet MRR | Latency/doc |
|---|---|---|---|---|
| CodeRankEmbed | 137M | 768 | ~77.9% | ~400ms (current) |
| all-MiniLM-L6-v2 | 22M | 384 | ~60% | ~20ms |
| CodeRankEmbed + L1/L2/L3 | 137M | 768 | ~77.9% | ~5ms (estimated) |

**Verdict**: With L1/L2/L3 applied, CodeRankEmbed becomes fast enough (~5ms/doc) that
the quality trade-off of switching to MiniLM isn't worth it. **Deprioritize this unless
L1/L2/L3 don't deliver expected gains.** If they don't, MiniLM indexing + CodeRankEmbed
query + reranker is a valid fallback strategy.

**Files**: `core/embedding-service.js`, `core/config.js`

---

### Tier 3: Voyage API Optimizations

#### V1. Server-Side Matryoshka Truncation

**Problem**: During indexing, we request full 1024d embeddings from Voyage, then truncate
to 512d client-side via `truncateForHNSW()`. Voyage supports `output_dimension` parameter
to do this server-side, reducing payload size by 50%.

**Fix**: Pass `outputDimension` during indexing calls:

```javascript
// In generateEmbeddings() for Voyage:
batchEmbeddings = await callVoyageAPI(batch, config, {
  outputDimension: config.dimensions.hnsw,  // 512 instead of 1024
});
```

**Caveat**: Only do this when the caller explicitly wants HNSW-dimension embeddings.
The full-dimension embeddings are still needed for:
- Vocabulary storage (pre-computed cache)
- ColBERT token embeddings
- Binary/Int8 quantized artifacts (need full precision source)

**Apply to all providers**: Mistral also supports Matryoshka (`[3072, 1024, 512, 256]`)
and Jina supports it (`[1024, 512, 256, 128, 64]`). The same `outputDimension` pattern
should be applied to all providers that support server-side truncation. Check each
provider's API for the exact parameter name.

**Implementation**: Add an `outputDimension` option to `generateEmbeddings()` that gets
passed through to the provider API call. The indexer calls it with `hnsw` dimension; other
callers get full dimension by default.

**Expected impact**: 50% smaller API response payloads, ~20-30ms faster per batch
(less data transfer). Also reduces memory during indexing.

**Files**: `core/embedding-service.js`, `core/index-codebase-v21.js`

---

#### V2. Concurrent Batch Requests

**Problem**: `generateEmbeddings()` sends batches sequentially via a `for` loop. With
Voyage's 300 req/min rate limit and 128 batch size, we're leaving concurrency on the table.

**Fix**: Send N batches concurrently (respecting rate limits):

```javascript
async function generateEmbeddings(texts, provider, options = {}) {
  const config = EMBEDDING_PROVIDERS[provider];
  const batchSize = config.batchSize || 32;
  const concurrency = options.concurrency || 4;  // Max concurrent API calls

  const batches = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  const results = [];
  for (let i = 0; i < batches.length; i += concurrency) {
    const concurrent = batches.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      concurrent.map(batch => embedBatch(batch, provider, config))
    );
    results.push(...batchResults.flat());
  }
  return results;
}
```

**Expected impact**: 2-4x faster Voyage indexing (limited by API rate limits).
For 4500 docs at batch=128: 36 batches. Sequential: ~36 * 250ms = 9s.
Concurrent (4): ~9 * 250ms = 2.25s.

**Risks**: May hit Voyage rate limits faster. The existing `RateLimiter` class needs to
be truly concurrency-safe under `Promise.all`. Sequential rate limiters (track timestamps,
check on call) often break when N requests arrive in the same microtick — all N see
"under limit" and fire simultaneously.

**Required design: queue-based rate limiter**. Don't rely on "check timestamps and
proceed." The limiter should expose `await limiter.acquire()` that serializes permits
through an internal queue/mutex:

```javascript
class TimeWindowRateLimiter {
  constructor(maxRPM, options = {}) {
    // Use 60-second sliding window to match actual RPM definition.
    // A 1-second window with ceil(rpm/60) is too permissive for edge cases
    // (e.g., RPM=61 → ceil=2/sec → allows 120 RPM if sustained).
    this.windowMs = 60_000;
    this.maxInWindow = maxRPM;
    this.timestamps = [];    // dispatch timestamps within 60s window

    // Optional microburst smoother: enforce soft per-second cap in addition to 60s RPM cap.
    // Keeps provider behavior stable while preserving strict 60s correctness.
    this.secondWindowMs = 1_000;
    this.maxPerSecond = options.maxPerSecond ?? (Math.floor(maxRPM / 60) + 1);
    this.secondTimestamps = []; // dispatch timestamps within 1s window

    this._mutex = Promise.resolve();  // serializes acquire() callers
  }

  async acquire() {
    // Mutex: serialize all callers so Promise.all can't stampede.
    // Each caller chains onto the previous one's completion.
    const prev = this._mutex;
    let releaseMutex;
    this._mutex = new Promise(resolve => { releaseMutex = resolve; });

    await prev;  // wait for previous caller to finish acquiring

    try {
      // Sliding window: wait until we have capacity
      while (this._atMinuteCapacity() || this._atSecondCapacity()) {
        const waitMs = this._nextWaitMs();
        await new Promise(r => setTimeout(r, waitMs));
        this._pruneWindows();
      }

      const now = Date.now();
      this.timestamps.push(now);
      this.secondTimestamps.push(now);
    } finally {
      releaseMutex();  // let next caller proceed
    }
  }

  // No release() method. This is purely time-window-based:
  // - Permits are governed by dispatch timestamps, not completion.
  // - No caller needs to remember to call release().
  // - No deadlock risk from forgotten release().

  _atMinuteCapacity() {
    this._pruneWindows();
    return this.timestamps.length >= this.maxInWindow;
  }

  _atSecondCapacity() {
    this._pruneWindows();
    return this.secondTimestamps.length >= this.maxPerSecond;
  }

  _nextWaitMs() {
    const now = Date.now();
    const minuteWait = this.timestamps.length > 0
      ? Math.max(1, this.windowMs - (now - this.timestamps[0]))
      : 1;
    const secondWait = this.secondTimestamps.length > 0
      ? Math.max(1, this.secondWindowMs - (now - this.secondTimestamps[0]))
      : 1;
    return Math.min(minuteWait, secondWait);
  }

  _pruneWindows() {
    const now = Date.now();
    const minuteCutoff = now - this.windowMs;
    const secondCutoff = now - this.secondWindowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < minuteCutoff) {
      this.timestamps.shift();
    }
    while (this.secondTimestamps.length > 0 && this.secondTimestamps[0] < secondCutoff) {
      this.secondTimestamps.shift();
    }
  }
}
```

This is **time-window-based with no `release()` needed**. `acquire()` tracks dispatch
timestamps in a 60-second sliding window (matching the RPM definition) and blocks when
the window is full. A chained promise mutex serializes callers so `Promise.all` can't
stampede past the check. Callers never need to call `release()` — permits expire
naturally as timestamps fall out of the window. No deadlock risk.

The 60s window remains the source of truth for RPM correctness. The optional 1s cap is
only a microburst smoother to reduce provider-side 429 spikes; it does not replace the
60s guarantee. The concurrency test (see below) should still assert that no 60-second
window exceeds configured RPM.
Unit tests must assert only the 60s invariant; the 1s smoother is best-effort and may
vary by provider/traffic shape.

**Files**: `core/embedding-service.js`

---

#### V2b. Request/Response Compression

**Problem**: Embedding API requests send large JSON payloads (code text) and receive large
JSON responses (float arrays). Neither direction is compressed.

**Fix**: Enable gzip on request, accept compressed responses:

```javascript
// In callVoyageAPI():
const jsonBody = JSON.stringify(payload);

// Attempt compressed request with graceful fallback
const { gzipSync } = await import('zlib');
const compressed = gzipSync(Buffer.from(jsonBody));

const headers = {
  'Authorization': `Bearer ${config.apiKey}`,
  'Content-Type': 'application/json',
  'Accept-Encoding': 'gzip, br',        // Always request compressed response
};

// Only send compressed if provider supports it (probe on first call)
if (providerSupportsRequestCompression(provider)) {
  headers['Content-Encoding'] = 'gzip';
}

const { body, statusCode, headers: resHeaders } = await pool.request({
  path: '/v1/embeddings',
  method: 'POST',
  headers,
  body: providerSupportsRequestCompression(provider) ? compressed : jsonBody,
});

// Handle 415 Unsupported Media Type or 400 with content-encoding error:
// mark provider as not supporting request compression, retry with plain JSON
if (statusCode === 415 || (statusCode === 400 && !providerSupportsRequestCompression(provider))) {
  markProviderNoCompression(provider);
  // Retry with uncompressed body...
}

// Response decompression: check if undici already auto-decompressed.
// undici may auto-decompress when `Accept-Encoding` is set, depending on version
// and configuration. Double-decompression will corrupt the data silently.
const encoding = resHeaders['content-encoding'];
let responseData = await body.arrayBuffer();

// Only manually decompress if content-encoding header is present AND the data
// still appears compressed. If undici already decompressed, the header may still
// be present but the data is already plain JSON.
const isCompressed = encoding && !looksLikeJson(responseData);
if (isCompressed && encoding === 'gzip') {
  const { gunzipSync } = await import('zlib');
  responseData = gunzipSync(Buffer.from(responseData));
} else if (isCompressed && encoding === 'br') {
  const { brotliDecompressSync } = await import('zlib');
  responseData = brotliDecompressSync(Buffer.from(responseData));
}

// Helper: quick check if data looks like JSON after optional leading whitespace.
function looksLikeJson(data) {
  const u8 = new Uint8Array(data);
  if (u8.length === 0) return false;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (c === 0x20 || c === 0x0A || c === 0x0D || c === 0x09) continue; // ws
    return c === 0x7B || c === 0x5B; // '{' or '['
  }
  return false;
}
```

**Fallback strategy**: Probe request compression on the first API call per provider.
If the server returns 415 (Unsupported Media Type) or 400 with a content-encoding error,
cache that the provider doesn't support request compression and fall back to plain JSON
for all subsequent calls. Response decompression (`Accept-Encoding`) is separate and
universally supported.

**Undici auto-decompress guard**: Depending on undici version and configuration,
`body.arrayBuffer()` may already return decompressed data even when `content-encoding`
header is present. The `looksLikeJson()` check prevents double-decompression, which would
silently corrupt the response. Verify your undici configuration once and document the
behavior. Also handle empty-body responses defensively before decompress/parse.

**Expected impact**: 50-70% smaller payloads in both directions. Most impactful on
slower networks or high-latency connections. For embeddings specifically, float arrays
compress well (~3-4x with gzip).

**Risks**: Not all providers accept `Content-Encoding: gzip` on requests. The fallback
strategy handles this automatically. Response decompression is standard HTTP and safe.
CPU cost of compression is negligible vs network latency savings.

**Files**: `core/embedding-service.js`

---

#### V3. Voyage Int8/Binary During Indexing

**Problem**: We generate float embeddings from Voyage during indexing, then quantize
client-side in the artifact builder. Voyage natively supports `output_dtype: 'int8'`
and `output_dtype: 'ubinary'`, which is more accurate (quantization happens in the
model's weight space, not post-hoc).

**Fix**: Request quantized embeddings directly from Voyage during the artifact build phase:

```javascript
// For binary HNSW: request ubinary directly
const binaryEmbeddings = await callVoyageAPI(batch, config, {
  outputDtype: 'ubinary',
  inputType: 'document',
});

// For int8 rescoring: request int8 directly
const int8Embeddings = await callVoyageAPI(batch, config, {
  outputDtype: 'int8',
  inputType: 'document',
});
```

**Bonus**: Binary/int8 responses are dramatically smaller than float JSON arrays.
A 1024d float vector is 1024 numbers in JSON (~6KB). As ubinary it's 128 bytes.
As int8 it's 1024 bytes. This is effectively V4 (binary return format) - by using
Voyage's native quantized output we get both better quality AND smaller payloads.

**Expected impact**: Better quantization quality (server-side is trained), eliminates
client-side `floatToInt8()` / `floatToBinary()` compute, massively smaller API payloads.

**Risks**: Need to verify Voyage int8 output range matches our expected [-127, 127].
Current `floatToInt8()` scales by max component magnitude; Voyage may use different
scaling. Test cosine similarity accuracy with `int8CosineSimilarity()`.

**Files**: `core/embedding-service.js`, `core/artifact-builder.js`

---

### Tier 3b: ColBERT Path (The Hidden Multiplier)

#### C1. ColBERT Line Embeddings: The 16x Amplifier

**Problem**: The plan's impact estimates are based on 4500 chunk embeddings. But when
ColBERT is enabled (the default for `balanced` and `full` profiles), the indexer also
embeds **every line of every chunk** at `index-codebase-v21.js:1131-1175`:

```javascript
// For each chunk: split into lines, embed each line individually
const MAX_LINES_PER_CHUNK = 16;   // Up to 16 lines per chunk
const MIN_LINE_LENGTH = 10;       // Skip very short lines
const MAX_LINE_LENGTH = 200;      // Truncate long lines
```

For 4500 chunks x up to 16 lines = **up to 72,000 individual embeddings**, all flowing
through the same sequential `callLocalModel()` for-loop. At 400ms/doc, that's potentially
**8 hours** for ColBERT alone.

**Why L0 matters even more here**: ColBERT lines have extreme length variance (10-200
chars, ~3-50 tokens). Without length bucketing, a batch mixing 10-char identifiers with
200-char function signatures pads everything to the longest. The padding waste ratio is
up to 20:1.

**Why L2 (sequence cap) is free here**: Lines are already capped at 200 chars (~50
tokens). A `max_length: 256` would be a no-op but explicitly avoids any surprise from
the tokenizer padding to the model's full 8192 context.

**Current mitigation**: The INDEXER_FIX_PLAN added `--no-colbert` and `--profile=fast`
which skip ColBERT entirely. But when ColBERT IS enabled, the line embedding step
silently dominates total indexing wall time.

**Fix**: All L0/L1/L2/L3 optimizations automatically fix this since ColBERT calls the
same `getEmbeddings()` path. No separate code change needed. But the impact estimates
must account for this:

| Scenario | Embeddings | Current time | With L0+L1+L2+L3 |
|---|---|---|---|
| Chunks only (--no-colbert) | 4,500 | ~30 min | ~10-40s (hardware-dependent) |
| Chunks + ColBERT (default) | 4,500 + 72,000 | **~8.5 hours** | ~2-8 min (hardware-dependent) |

**Critical implementation detail: Flattened mega-batch processing (default)**

The ColBERT line embedding loop MUST NOT call `getEmbeddings()` per-line or per-chunk.
Collect lines into **mega-batches of 5k-10k lines** (not all 72k at once), process each
mega-batch through L0 bucketing, and write results to SQLite before proceeding to the
next mega-batch. This is the **default**, not an optional memory optimization:

- Mega-batch of 10k lines x 768d x 4 bytes = ~30MB pool (manageable)
- Single flat pool of 72k lines = ~210MB (OOM risk on CI boxes / laptops)

Within each mega-batch, L0 bucketing still applies — sort by length, adaptive batch
sizing, all the same logic. The mega-batch boundary just caps peak RSS.

```javascript
// WRONG: per-chunk embedding (current code pattern)
for (const chunk of chunks) {
  const lines = splitIntoLines(chunk);
  const lineEmbeddings = await getEmbeddings(lines);  // N calls to getEmbeddings
}

// RIGHT: mega-batch processing (collect all, process in 10k-line chunks)
const MEGA_BATCH_SIZE = 10_000;  // cap RSS at ~30MB per mega-batch

// Step 1: Collect all lines with parallel ownership array (avoids O(n) filter per mega-batch)
const allLines = [];
const lineOwner = [];  // lineOwner[i] = chunkId that owns line i
for (const chunk of chunks) {
  const lines = splitIntoLines(chunk);
  for (const line of lines) {
    allLines.push(line);
    lineOwner.push(chunk.id);
  }
}

// Step 2: Process in mega-batches (each goes through full L0 bucketing pipeline)
for (let megaStart = 0; megaStart < allLines.length; megaStart += MEGA_BATCH_SIZE) {
  const megaEnd = Math.min(megaStart + MEGA_BATCH_SIZE, allLines.length);
  const megaBatch = allLines.slice(megaStart, megaEnd);

  // L0 bucketing applies inside getEmbeddings — sorts, adaptive batch sizing
  const megaEmbeddings = await getEmbeddings(megaBatch);

  // Stream-insert by scanning the ownership slice once — O(megaBatchSize), not O(numChunks)
  let currentChunk = lineOwner[megaStart];
  let chunkLines = [];
  for (let j = 0; j < megaEmbeddings.length; j++) {
    const owner = lineOwner[megaStart + j];
    if (owner !== currentChunk) {
      insertColBERTLines(currentChunk, chunkLines);
      chunkLines = [];
      currentChunk = owner;
    }
    chunkLines.push(megaEmbeddings[j]);
  }
  if (chunkLines.length > 0) {
    insertColBERTLines(currentChunk, chunkLines);
  }
  // Pool buffers from this mega-batch are now GC-eligible
}
```

Each mega-batch flows through the full L0 bucketing pipeline independently. Pool buffers
from the previous mega-batch are GC-eligible after SQLite insertion, keeping peak RSS at
~30MB regardless of total line count.

**Contiguity constraint**: The `lineOwner[]` stream-insert logic assumes lines for a
given chunk appear contiguously in `allLines[]`. This is guaranteed by the sequential
chunk-by-chunk build loop above. **Do not parallelize the `allLines` build** (e.g., with
worker threads or `Promise.all` over chunks) without changing the regrouping logic to
handle interleaved ownership.

**Order preservation contract**: `getEmbeddings(texts)` MUST return embeddings aligned
to `texts[]` input order even when L0 bucketing sorts internally. The L0 implementation
sorts by length, embeds, then un-sorts via `origIdx` to restore input order. The
`embedding-bucketing.test.js` test verifies this, including duplicate strings and
same-length/different-string cases (order mapping must not rely on unique lengths or
unique text values). If order is broken, the `lineOwner[]` mapping above silently
assigns embeddings to wrong chunks.

**Progress reporting**: ColBERT line embedding is the longest single phase (~1-5 min
with optimizations). Add progress reporting:

```javascript
// In the ColBERT embedding loop:
const totalLines = allLines.length;
let embedded = 0;
const reportInterval = Math.max(1000, Math.floor(totalLines / 20));  // ~20 updates

// After each bucket completes:
embedded += bucketSize;
if (embedded % reportInterval < bucketSize) {
  console.log(`  ColBERT: ${embedded}/${totalLines} lines (${Math.round(embedded/totalLines*100)}%)`);
}
```

**ColBERT batch size boost**: Since ColBERT lines are short (10-200 chars, ~3-50 tokens),
raise `hardCap` to 128 when the current candidate batch's longest sequence is short:

```javascript
// In L0 setup (ColBERT path), make hardCap token-aware:
const resolveHardCap = (candidateLongest) => (candidateLongest <= 128 ? 128 : 64);
```

The token-budget logic already allows large batches for short inputs, but the hardCap=64
default artificially limits it. By making the cap decision token-aware on each candidate,
short-line buckets can scale to 128 while longer buckets stay at 64 automatically. With
128 short lines at ~50 tokens each, one forward pass is still only ~6400 tokens, well
under 16k. This is free throughput — same compute, fewer kernel launches.

**Files**: `core/index-codebase-v21.js` (flattened batching, progress, batch size override), `core/config.js`

---

### Tier 4: Pipeline-Level Optimizations

#### P0. SQLite Write Optimization

**Current state (already implemented)**:
- Prepared statements via `db.prepare()` - YES
- Transaction wrapping via `db.transaction()` - YES
- `synchronous = NORMAL` for normal mode - YES
- Fast-build mode: `synchronous = OFF`, `journal_mode = MEMORY`, `cache_size = -64000` - YES

**What's NOT implemented**:

1. **WAL mode for Linux**: Currently using `journal_mode = DELETE` everywhere due to WSL
   Windows filesystem compatibility. On native Linux or WSL2 with ext4 (not drvfs), WAL
   mode is significantly faster for write-heavy workloads. Add platform detection:

```javascript
const isNativeLinux = process.platform === 'linux' && !process.env.WSL_DISTRO_NAME;
// Or check if the DB path is on a POSIX filesystem
if (isNativeLinux || !isWindowsFilesystem(dbPath)) {
  db.pragma('journal_mode = WAL');
} else {
  db.pragma('journal_mode = DELETE');
}
```

2. **Batch insert size**: `insertVectors()` currently inserts all vectors in a single
   transaction. For very large corpora (10k+ chunks), this can cause memory pressure as
   SQLite holds the entire transaction in memory. Consider chunking into transactions
   of 1000-2000 rows.

3. **CPU work outside DB lock**: Ensure heavy transforms (quantization, binary packing in
   Phase 5) happen before acquiring the DB write lock. Currently Phase 5
   (`buildQuantizedArtifactsPhase`) runs after vector insertion, which is correct.

**Expected impact**: WAL mode gives 2-5x write throughput on Linux. Other items are
defensive (prevent DB from becoming the bottleneck after embedding is fast).

**Files**: `core/index-codebase-v21.js`

---

#### P1. Pre-Tokenization Cache

**Problem**: On retries, re-indexing, or incremental updates, the same text gets
re-tokenized. Tokenization for CodeRankEmbed involves BPE encoding which isn't free.

**Fix**: Cache tokenized tensors keyed by content hash. This becomes more valuable
when combined with L7 (direct ORT session) where we control the tokenization step.

```javascript
import crypto from 'crypto';

const tokenCache = new Map();

async function callLocalModelWithCache(texts) {
  const tokenizer = await getTokenizer();

  const tokenized = texts.map(text => {
    const key = crypto.createHash('md5').update(text).digest('hex');
    if (tokenCache.has(key)) return tokenCache.get(key);
    const tokens = tokenizer(text, { truncation: true, max_length: 1024 });
    tokenCache.set(key, tokens);
    return tokens;
  });

  // Feed pre-tokenized inputs directly to model
}
```

**Expected impact**: Saves ~5-10ms per doc on re-indexing. Marginal for first-time
indexing. Most useful for incremental updates where 90% of chunks are unchanged.

**Risks**: Token cache grows with corpus size. Use LRU eviction (1000-2000 entries).

**Files**: `core/embedding-service.js`

---

#### P2. Async I/O Pipeline

**Problem**: The indexer embeds all chunks, then writes all to SQLite, then builds HNSW.
Each phase waits for the previous to complete. File I/O and SQLite writes block between
embedding batches.

**Fix**: Pipeline the stages so embedding batch N+1 starts while batch N writes to DB.
Also ensure heavy CPU transforms (quantization, binary packing) are done before the
single-writer DB step.

```javascript
async function pipelinedIndexing(allChunks, texts, batchSize) {
  const embeddings = new Array(texts.length);
  let writePromise = Promise.resolve();

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    // Overlap: embed current batch while writing previous batch
    const [batchEmbeddings] = await Promise.all([
      getEmbeddings(batch),
      writePromise,
    ]);

    // Start async write (don't await yet)
    const batchChunks = allChunks.slice(i, i + batchSize);
    writePromise = writeBatchToDb(batchChunks, batchEmbeddings);

    for (let j = 0; j < batchEmbeddings.length; j++) {
      embeddings[i + j] = batchEmbeddings[j].embedding;
    }
  }

  await writePromise;
  return embeddings;
}
```

**Expected impact**: Overlaps I/O with compute. 10-20% wall time reduction.

**Risks**: SQLite doesn't support concurrent writes. The pipeline ensures sequential
writes while overlapping with embedding compute. better-sqlite3 is synchronous, so
"write" here means the JS object construction + serialization, not the actual `stmt.run()`.

**Files**: `core/index-codebase-v21.js`

---

#### P3. Multi-Process Parallelism (Worker Threads)

**Problem**: Node.js single-threaded event loop limits CPU utilization even with ONNX
thread options. For very large codebases (>10k chunks), we could split work across
multiple OS processes.

**Fix**: Use `worker_threads` to run N model instances in parallel:

```javascript
import { Worker } from 'worker_threads';

async function parallelEmbed(texts, numWorkers = 4) {
  const chunkSize = Math.ceil(texts.length / numWorkers);
  const workers = [];

  for (let i = 0; i < numWorkers; i++) {
    const workerTexts = texts.slice(i * chunkSize, (i + 1) * chunkSize);
    workers.push(runWorker(workerTexts));
  }

  const results = await Promise.all(workers);
  return results.flat();
}
```

**Expected impact**: Near-linear scaling with cores (2-4x with 4 workers).

**Risks**: Each worker loads its own model copy (~200MB RAM per instance). On a machine
with 8GB RAM, limit to 2-3 workers. Memory-hungry approach.

**Priority**: Low. L0+L1+L2+L3 should reduce 30min to well under 1 minute. Only pursue
this if that's still too slow.

**Files**: New `core/embedding-worker.js`, `core/embedding-service.js`

---

## Combined Impact Estimate

### Local Model: Chunk Embeddings (4500 chunks)

| Optimization | Per-doc time | Total (4500 docs) | Cumulative speedup |
|---|---|---|---|
| Current (no opts) | ~400ms | ~30 min | 1x |
| + L1 (batching, batch=32) | ~30-60ms | ~2-4.5 min | 7-15x |
| + L0 (length bucketing) | ~15-35ms | ~1-2.5 min | 12-30x |
| + L2 (seq len 512 default; 1024 optional) | ~4-10ms | ~18-45s | 40-100x |
| + L3 (ONNX threads + mem arena) | ~2-5ms | ~9-23s | 80-200x |
| + L3b (cached optimized graph) | ~2-5ms | ~9-22s | faster cold start |
| + L5 (OpenVINO, Intel) | ~1-3ms | ~5-14s | 130-360x |

### Local Model: ColBERT Line Embeddings (up to 72k lines)

| Optimization | Per-line time | Total (72k lines) | Cumulative speedup |
|---|---|---|---|
| Current (no opts) | ~400ms | ~8 hours | 1x |
| + L1 (batching, batch=32) | ~15-40ms | ~18-48 min | 10-27x |
| + L0 (bucketing, large batches) | ~3-8ms | ~3.5-10 min | 50-140x |
| + L2 (seq len 256, lines are short) | ~1-4ms | ~1.2-5 min | 100-400x |
| + L3 (ONNX threads + mem arena) | ~0.5-2ms | ~0.6-2.4 min | 200-800x |

ColBERT lines are short (10-200 chars) so they benefit disproportionately from bucketing
(large batch sizes with minimal padding) and sequence length cap (already short, padding
to 256 vs 8192 is a massive win).

**Why the wide bands**: Per-doc throughput depends heavily on CPU model (AMD vs Intel,
generation, AVX support), available cores, memory bandwidth, and ONNX Runtime version.
The lower end of each range represents older/mobile CPUs; the upper end represents modern
desktop/server CPUs with AVX-512.

### Total Indexing (Chunks + ColBERT)

| Scenario | Current | With L0+L1+L2+L3 (realistic range) |
|---|---|---|
| --no-colbert (chunks only) | ~30 min | **20-90s** |
| Default (chunks + ColBERT) | **~8.5 hours** | **1-5 min** |
| --profile=full (all phases) | ~9+ hours | **2-7 min** |

**Conservative target**: L0+L1+L2+L3 = **under 90 seconds for chunks, under 5 minutes
with ColBERT** on any reasonable hardware (currently 30min / 8.5 hours).
On a modern desktop CPU with AVX-512, expect the lower end of those ranges
(roughly ~15-30s chunks, ~1-2 min ColBERT).
This aligns with the original "10-20 seconds for 10k chunks" estimate from the Claude chat
(which assumed a capable machine).

### Voyage Code 3 (4500 docs)

| Optimization | Batch time | Total (36 batches) | Cumulative speedup |
|---|---|---|---|
| Current (sequential batches) | ~250ms | ~9s | 1x |
| + V1 (server-side 512d) | ~200ms | ~7s | 1.3x |
| + V2 (4x concurrency) | ~200ms | ~2s | 4.5x |
| + V2b (compression) | ~150ms | ~1.5s | 6x |
| + V3 (server-side quant) | ~130ms | ~1.2s | 7.5x |

**Note**: Voyage is already fast. The bottleneck there is API latency, not compute.
Biggest win is V2 (concurrent batches).

---

## Memory / Buffer Lifetime Policy

Embedding buffers flow through several stages: pipeline output -> embedding storage ->
SQLite insertion -> HNSW index -> ColBERT index. Each stage has different lifetime
requirements. This section documents the ownership model to prevent use-after-free bugs
with `subarray()` views.

### Buffer ownership chain

```
Stage 1: Pipeline output (EPHEMERAL - owned by @huggingface/transformers)
  │  The pipeline's internal Float32Array may be reused on the next call.
  │  NEVER hold references to pipeline output.data across calls.
  │
  ▼
Stage 2: Pool buffer (OWNED - one per batch, created in callLocalModel)
  │  new Float32Array(batchSize * dim)  ← we own this
  │  pool.set(outputs.data)             ← copy from pipeline into our buffer
  │  return subarray() views            ← safe: we control the pool's lifetime
  │
  ▼
Stage 3: Embeddings array (VIEWS into pool buffers)
  │  Each embedding is a Float32Array subarray view into a pool from Stage 2.
  │  Pool buffers are NOT garbage collected while views exist (normal GC behavior).
  │  These views are valid until the caller discards them.
  │
  ▼
Stage 4: SQLite insertion (COPY via Buffer.from with byteOffset)
  │  Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
  │  This creates a Node.js Buffer view (no copy), which better-sqlite3's
  │  stmt.run() copies into the database. After insertion, the view can be GC'd.
  │
  ▼
Stage 5: HNSW / ColBERT index (depends on implementation)
     hnsw-index.js add() - VERIFIED (current implementation): copies input by
     normalizing then creating `new Float32Array(normalized)` before insert.
     Therefore HNSW does not rely on caller pool-view lifetime today.
     If this changes in future (reference-holding backend), pool lifetime rules
     above still apply and must be re-validated.
     Fallback safety rule if references are retained: build HNSW incrementally per
     batch, or persist vectors then reload for build so no freed/transient pool views
     are relied on.
```

### Rules

1. **Never hold pipeline output references across calls.** Always copy into a pool.
2. **One pool per batch.** Pools from different batches are independent.
3. **Pool lifetime = max(consumer lifetimes).** If HNSW holds references, the pool
   lives until HNSW build completes. If all consumers copy, pool is GC'd after the
   embedding loop iteration.
4. **For Voyage/remote providers:** Embeddings arrive as JSON arrays parsed into
   regular `Array<number>`. No buffer reuse risk. The pool strategy is local-model-only.
5. **For ColBERT mega-batch processing (default):** Process 10k lines per mega-batch,
   write to SQLite after each, then release the pool. Peak memory: ~30MB per mega-batch.
   Never allocate a single pool for all 72k lines (~210MB) — this is the default behavior,
   not an optional optimization.
6. **Returned embeddings are read-only views.** `getEmbeddings()` returns `Float32Array`
   `subarray()` views into owned pools. Consumers MUST NOT mutate these in place
   (normalize, quantize, clamp, etc.). If mutation is required, copy first:
   `const mutable = new Float32Array(embedding)`. In development, freeze the outer
   `embeddings[]` container to catch accidental reassignment of slots.

### Testing the policy

The mandatory `tests/embedding-buffer-safety.test.js` verifies rules 1 and 2:
embed two batches, confirm first batch's views survive the second call unchanged.

---

## Implementation Order

### Phase 1: Critical Path (ship first, biggest bang)

1. **L0** - Length-sorted bucketing (free, no accuracy risk)
2. **L1** - True batch inference for local model (with `subarray()` zero-copy)
3. **L2** - Sequence length cap (512 default indexing, 512 queries, env override)
4. **L3** - ONNX session options (threads, graph optimization, mem arena/pattern)

**Validation**: Run CodeSearchNet benchmark before/after. MRR should stay within 2%
of baseline. Measure wall time for indexing 4500 docs.

**Post-Phase-1 profiling checkpoint**: After L0-L3 land, record a per-phase time
breakdown before proceeding to Phase 2:

```
Phase                  | Time (s) | % of total
-----------------------|----------|----------
Chunk embedding        |          |
ColBERT line embedding |          |
SQLite vector insert   |          |
HNSW build             |          |
ColBERT index build    |          |
Artifact build (quant) |          |
Total                  |          |
```

This tells you which phase is now the bottleneck. If embedding drops to 20-90s but HNSW
build or SQLite writes take 2 minutes, prioritize P0/P2 over V1/V2. If ColBERT index
build dominates, that's a separate optimization target not covered in this plan. Don't
stop profiling after embedding gets fast — the bottleneck will shift.

**L7 promotion trigger**: Also measure pipeline wrapper overhead separately (time inside
`model(texts, ...)` vs total `callLocalModel()` time). If pipeline wrapper overhead
exceeds 15% of embedding wall time, promote L7 (direct ORT session) from Phase 4 to
Phase 2 — the pipeline convenience layer is now the bottleneck, not ORT itself.

**Must-add embedding metrics** (log these, no telemetry needed):

```
Embedding throughput:  12,450 tokens/sec  (4,500 chunks in 27s)
Padding inflation:     1.3x               (sum(paddedLen) / sum(realLen))
ColBERT throughput:    48,200 tokens/sec   (72,000 lines in 38s)
ColBERT inflation:     1.1x
```

- **tokens/sec**: total estimated tokens embedded / wall seconds. This is the single
  number that tells you if batching + bucketing + ORT options are actually working.
- **padding inflation**: `sum(paddedTokensPerBatch) / sum(realTokensPerBatch)`. If
  inflation stays >2x after L0, the token estimator calibration is off or bucketing
  isn't being used in the hot path. Target: <1.5x for chunks, <1.2x for ColBERT lines.
- Log these per ColBERT mega-batch as well (not only once at end) to surface drift and
  token-estimation pathologies early in long indexing runs.

### Phase 2: Persistence + Voyage (quick wins)

5. **L3b** - Persist optimized graph to disk (faster cold starts)
6. **V1** - Server-side Matryoshka truncation (all providers)
7. **V2** - Concurrent batch requests
8. **L4** - Zero-copy audit across full pipeline

### Phase 3: Advanced (data-driven, after Phase 1 measurements)

9. **O1** - Offline ONNX transformer optimization (one-time)
10. **V2b** - Request/response compression
11. **V3** - Voyage native int8/binary
12. **L5** - OpenVINO (if Intel CPU detected)
13. **P0** - WAL mode on native Linux
14. **P2** - Async I/O pipeline

### Phase 4: Extreme (only if Phase 1-3 insufficient)

15. **L3c** - Threading auto-tuner (full grid search)
16. **L7** - Bypass pipeline for direct ORT session
17. **O2** - Pre-optimized ORT format (.ort)
18. **L6** - FP16 inference
19. **P1** - Pre-tokenization cache
20. **P3** - Multi-process parallelism
21. **M1** - Smaller model for indexing (fallback strategy)

---

## Monitoring & Regression Gates

### Before any changes
- Record baseline: `time node core/index-codebase-v21.js` on a reference project
- Record CodeSearchNet MRR for Python, JS, Go
- Record memory usage peak during indexing
- Record cold start time (model load to first embedding)

### Per-optimization gate
- Indexing time must decrease (or be neutral for quality-only changes)
- CodeSearchNet MRR must not drop more than 2% absolute
- Peak memory must not exceed 2x baseline
- All existing tests must pass (`npm test -- --run`)
- CI should fail on **regressions vs baseline on the same runner** (e.g., tokens/sec down,
  padding inflation up), not on fixed absolute throughput thresholds (hardware variance).

### New tests needed (mandatory for Phase 1 merge)
- `tests/embedding-batching.test.js` **(MANDATORY, blocks merge)**: Verify batch
  inference produces same embeddings as sequential. **Critical**: test with mixed-length
  inputs (e.g., 20-char, 500-char, 1500-char texts in one batch) to catch
  padding/attention_mask/truncation drift. Identical-length tests will pass even if the
  padding logic is wrong. Use a **dual tolerance gate** — different execution order and
  fused kernels can shift floats beyond naive elementwise checks:
  - `maxAbsDiff < 3e-4` (elementwise) **OR**
  - `cosineSimilarity(sequential[i], batched[i]) > 0.999985`
  - Both must hold for every embedding in the batch. Plain `1e-6` elementwise will
    flake on fused attention kernels. The wider `3e-4` / `0.999985` thresholds account
    for Intel vs AMD kernel differences and ORT fusion variations across platforms.
- `tests/embedding-bucketing.test.js`: Verify length-sorted output matches
  original order after un-sorting, including random-length inputs, duplicate strings,
  and same-length/different-string cases.
- `tests/embedding-buffer-safety.test.js` **(MANDATORY, blocks merge)**: Verify that
  `subarray()` views from batch N remain valid after batch N+1 completes. Test:
  1. Embed batch A, save subarray views
  2. Embed batch B
  3. Assert batch A views still hold original values (not overwritten by B)
  4. If this test fails, the pool allocation in L1 has a bug or the pipeline
     is mutating our pool buffer (should be impossible since we `.set()` copy)
- `tests/embedding-perf.test.js`: Benchmark harness for docs/second measurement
- `tests/embedding-padding-sentinel.test.js` **(MANDATORY, blocks merge)**: Verify that
  padding/attention_mask is applied correctly in mean pooling. Test design:
  1. Pick a short text S (e.g., `"function add(a, b)"`)
  2. Embed S alone: `embed([S])` → `embA`
  3. Embed S with a long companion: `embed([S, longText])` → `embB[0]`
  4. Embed S with a different long companion: `embed([S, differentLongText])` → `embC[0]`
  5. Assert `cosSim(embA, embB) > 0.999985` AND `cosSim(embA, embC) > 0.999985`
  6. If the short embedding shifts depending on its batch companions, the attention mask
     is not being applied during mean pooling (the model is pooling over padding tokens).
  This catches "mask not applied in mean pooling" more directly than the mixed-length
  equivalence test alone, because sequential-vs-batched can accidentally both be wrong
  in the same way (both pad to max_length → same wrong result).
- `tests/embedding-truncation-sentinel.test.js` **(MANDATORY, blocks merge)**: Verify
  truncation is respected and stable across sequential vs batched execution:
  1. Pick long text `T` (>1024 tokens) and medium text `M` (~300-400 tokens)
  2. Embed `T` alone with `max_length=512` and `max_length=1024`
  3. Assert these differ meaningfully for `T` (truncation boundary is real)
  4. Embed `M` with `max_length=512` and `max_length=1024`
  5. Assert these are near-identical for `M` (no unnecessary drift below boundary)
  6. For each `max_length` setting, assert sequential vs batched parity with the same
     dual tolerance gate used in `embedding-batching.test.js`
  This catches "max_length ignored" and accidental "padding-to-max_length" regressions.
- `tests/rate-limiter-concurrency.test.js`: Fire N concurrent requests through
  `TimeWindowRateLimiter` via `Promise.all`, assert that the number of requests dispatched
  in any 60-second sliding window never exceeds the configured RPM. Use a mock clock
  (e.g., `vi.useFakeTimers()`) to test without waiting real seconds. This catches
  "works sequentially, breaks under Promise.all" race conditions.
- Add timing instrumentation to `indexCorpus()` in eval path

---

## Rejected / Deferred Ideas

### IPEX / Optimum Intel
Intel Extension for PyTorch (IPEX) with Intel Neural Compressor shows up to 4.5x for
embedding models. However, this is Python-only. Our stack is Node.js + ONNX Runtime.
The equivalent optimization for our stack is L5 (OpenVINO Execution Provider), which
provides similar Intel-specific acceleration through ONNX Runtime's EP mechanism.

### Token-count batching as separate item
Merged into L0. The length-sorted bucketing with adaptive batch sizing achieves the same
goal: consistent compute per forward pass by grouping similar-length texts and sizing
batches by token budget rather than fixed count.

### V4. Binary return format
Merged into V3. By requesting `output_dtype: 'int8'` or `'ubinary'` from Voyage, we
automatically get smaller binary-like payloads instead of JSON float arrays.

### V5. Correct dimension at source everywhere
Merged into V1. The enhanced V1 now explicitly notes applying server-side truncation
to all providers (Mistral, Jina) that support it, not just Voyage.

---

## Why These Were Missed in INDEXER_FIX_PLAN

The INDEXER_FIX_PLAN correctly identified orchestration-level problems (two-phase cold
starts, merkle deletion, ColBERT overhead) and fixed them. But it explicitly scoped out
embedding throughput:

> "Deeper architecture (persistent worker, in-memory corpus ingestion)" - listed as
> out-of-scope for MVP
>
> "Advanced throughput work (R4+) until post-MVP timing data is collected" - deferred

The plan also noted: "Local embedding batch behavior in runtime is not yet verified
end-to-end (JS-level batching exists, runtime execution mode needs profiling)." This
was the correct observation but it was deferred, and the `callLocalModel()` sequential
loop was never actually profiled or fixed.

The Claude web chat suggestions (batching, sequence cap, ONNX opts, OpenVINO, quantization)
came after the INDEXER_FIX_PLAN was already implemented, so they were never incorporated.

The ChatGPT and Claude reviews (2026-02-16) identified additional critical gaps:
length-sorted bucketing, ONNX session memory options, offline graph optimization,
zero-copy views, SQLite write strategy audit, and direct ORT session bypass - none of
which were in the original plan.
