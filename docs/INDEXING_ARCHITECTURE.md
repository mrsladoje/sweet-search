# Indexing & Embedding Architecture

How Sweet Search turns a codebase into searchable vector indexes. This document covers
the module layout, embedding pipelines (local and remote), indexing stages, memory model,
and configuration surface.

---

## Module Map

```
core/
  embedding-service.js        Facade: re-exports all sub-modules, hub functions
                               (generateEmbedding, generateEmbeddings, getEmbedding,
                                getEmbeddings, quantization helpers, warmup/lifecycle)

  embedding-local-model.js    ONNX-based local inference (CodeRankEmbed 137M/768d)
                               L0 bucketing, L1 batch inference, L2 sequence cap,
                               L3 session options, L3b graph persistence,
                               mean pooling + L2 normalization

  embedding-remote.js         API providers (Voyage, Mistral, Jina)
                               Circuit breaker, TimeWindowRateLimiter,
                               V2b gzip compression, HTTP/2 connection pooling

  embedding-cache.js          LRU cache, vocabulary store, semantic cache,
                               query deduplication, auto-persist

  indexer-build.js            Phase 1 (code graph) + Phase 2 (vector embeddings)
                               Schema, insertVectors, pipelinedEmbedAndInsert

  indexer-phases.js           Phase runner helper + orchestration wrappers
                               (discover, determine, build graph, build vectors,
                                update state, print summary)

  indexer-ann.js              Phase 3 (HNSW), Phase 4 (ColBERT), Phase 5 (quantized artifacts)
                               Incremental + full HNSW builds, ColBERT mega-batch,
                               binary HNSW + int8 sidecar

  indexer-utils.js            SQLite journal mode (WAL/DELETE), atomic swap,
                               file discovery, logging helpers

  index-codebase-v21.js       CLI entry point - parses args, calls phase wrappers

  config.js                   EMBEDDING_PROVIDERS, EMBEDDING_CONFIG, HNSW_CONFIG,
                               provider selection, environment variable wiring
```

The facade pattern in `embedding-service.js` keeps the public API stable while the
implementation is split across four files to stay under the 500-line file limit.

---

## Embedding Providers

Provider selection is automatic (highest-priority enabled provider) or explicit via
`EMBEDDING_PROVIDER` env var.

| Provider | Model | Dims (full/HNSW) | Context | Batch | Priority |
|----------|-------|-------------------|---------|-------|----------|
| **Voyage** | voyage-code-3 | 1024 / 512 | 32K | 128 | 1 |
| **Mistral** | codestral-embed-2505 | 3072 / 512 | 32K | 64 | 2 |
| **Jina** | jina-embeddings-v3 | 1024 / 512 | 8K | 128 | 3 |
| **Local** | CodeRankEmbed (ONNX) | 768 / 512 | 8K | 32 | 99 |

All remote providers fall back to local on failure (circuit breaker or rate limit).
The local model is always available.

---

## Local Inference Pipeline

Five optimizations run in sequence when `getEmbeddings()` routes to the local model.

### L0: Length-Sorted Bucketing

`callLocalModelBucketed()` in `embedding-local-model.js:296`

Sorts texts by estimated token length (chars / 4, with a 1.15x safety multiplier),
then groups them into batches using a **token budget** (16,384 tokens per forward pass)
instead of a fixed batch count. Short texts batch in groups of 64-128; long texts
in groups of 4-8. This keeps compute per forward pass roughly constant and minimizes
padding waste.

A hard cap limits maximum batch size. The default is `maxLength`-dependent:
`maxLength <= 256` yields a cap of 128, otherwise 64. With the default
`INDEXING_MAX_LENGTH=512`, the base cap is 64. Callers can override via
`resolveHardCap(candidateLongest)` for per-candidate token-aware caps -- ColBERT does
this to allow 128-item batches when the longest candidate is under 128 tokens.

An RSS memory guard halves batch size when process memory exceeds 85% of 512 MB. This
is OOM-prevention only, not batch shaping.

After embedding, results are un-sorted via `origIdx` to restore input order.

### L1: Batch Inference with Pool Allocation

`callLocalModel()` in `embedding-local-model.js:258`

Passes the full text array to the tokenizer and model in a single call. The pipeline
returns raw tensor output; `extractPooledEmbeddings()` applies masked mean pooling and
L2 normalization.

A per-batch `Float32Array` pool is allocated, the pooled output is copied into it via
`.set()`, and `subarray()` views are returned. This gives zero-copy downstream access
without risk of buffer reuse from the HuggingFace pipeline internals.

In non-production mode, the returned embeddings array is `Object.freeze()`-d to catch
accidental mutation.

The tokenizer is called directly (`model.tokenizer(texts, ...)`) with `padding: true`
(pad to batch max, NOT to `max_length`) and `truncation: true`. This was necessary
because the HuggingFace pipeline's high-level API does not forward `max_length` to the
CodeRankEmbed ONNX model correctly.

### L2: Sequence Length Cap

Two independent constants, configurable via environment:

- `INDEXING_MAX_LENGTH` = 512 (default) - used during indexing
- `QUERY_MAX_LENGTH` = 512 (default) - used during search

The indexer already truncates chunk text to 1,500 chars (~375 tokens at 4 chars/token).
A 512-token cap gives 37% headroom while being 256x cheaper in attention compute than
the model's native 8,192 limit.

### L3: ONNX Session Options

`buildLocalSessionOptions()` in `embedding-local-model.js:62`

- `graphOptimizationLevel: 'all'` - fuses attention, LayerNorm, GELU, skip connections
- `intraOpNumThreads` - physical cores minus 1, capped at 8
- `interOpNumThreads: 2` - parallel operator execution
- `executionMode: 'parallel'`
- `enableCpuMemArena: true` - pre-allocated memory pool
- `enableMemPattern: true` - learns allocation patterns from warmup

The session option key (`session_options` vs `sessionOptions`) is detected at startup
by trying both; whichever loads successfully is cached for the process lifetime.

A warmup call (`["warmup"]` with `max_length: 64`) runs immediately after model load
to prime the memory arena.

### L3b: Graph Persistence

`getOptimizedModelPath()` in `embedding-local-model.js:36`

Saves the ORT-optimized graph to `~/.cache/sweet-search/` with a filename that
encodes the ORT version and model hash. Subsequent runs skip the optimization pass
entirely. Upgrading ORT or changing the model automatically invalidates the cache.

### OpenVINO (Intel Auto Mode)

OpenVINO is auto-enabled on Intel CPUs by default only when OpenVINO provider
artifacts are present in the ONNX runtime bundle. Otherwise it stays on CPU-only.

Overrides:
- `SWEET_SEARCH_USE_OPENVINO=0` disables OpenVINO even on Intel
- `SWEET_SEARCH_USE_OPENVINO=1` explicitly requests OpenVINO (still Intel-gated
  and provider-availability gated)

### L7: Direct ORT Session Bypass

`runDirectOrt()` in `embedding-local-model.js:329`

Bypasses the HuggingFace pipeline wrapper (`pick()`, `validateInputs()`, `replaceTensors()`,
HF Tensor wrapping/unwrapping) by extracting the raw ORT session from
`pipeline.model.sessions['model']` and calling `session.run()` directly with `.ort_tensor`
references from the tokenizer output. For models expecting `token_type_ids` (not CodeRankEmbed),
a zeros `BigInt64Array` is synthesized matching the `input_ids` shape.

Output is bit-identical to the pipeline path: same ORT session, same input tensors, same
`extractPooledEmbeddings()` pooling and L2 normalization.

Safety:
- Env kill switch: `SWEET_SEARCH_DIRECT_ORT=0` disables (default: enabled)
- Init-time probe: logs `[L7] Direct ORT: inputs=[...], outputs=[...]` on model load
- Runtime try/catch: first failure sets sticky `directOrtFailed` flag, all subsequent calls
  fall back to `pipeline.model()` for the process lifetime
- `unloadLocalModel()` resets the failure flag

---

## Remote Provider Pipeline

### Server-Side Matryoshka (V1)

During indexing, `buildVectorIndex()` passes `outputDimension` (defaults to HNSW dim,
typically 512) to the provider API. Voyage uses `output_dimension`, Mistral uses
`dimensions`, Jina uses `dimensions`. This halves the response payload and avoids
client-side truncation.

### Concurrent Batch Requests (V2)

`generateEmbeddings()` in `embedding-service.js:125` sends batches in groups of
`concurrency` (default 4) via `Promise.all`. Each batch acquires a permit from the
`TimeWindowRateLimiter` before dispatch.

### TimeWindowRateLimiter

`embedding-remote.js:238`

A concurrency-safe rate limiter using a 60-second sliding window with a chained-promise
mutex. `acquire()` serializes callers so `Promise.all` cannot stampede past the limit.

Features:
- 60-second sliding window matching the provider's actual RPM definition
- Optional per-second microburst smoother (prevents 429 spikes)
- No `release()` needed - permits expire as timestamps leave the window
- No deadlock risk

### Gzip Compression (V2b)

`compressedApiRequest()` in `embedding-remote.js:146`

Compresses request bodies with gzip when the compressed size is under 90% of the
original. Sets `Accept-Encoding: gzip, br` for response decompression. A `looksLikeJson()`
guard prevents double-decompression when undici auto-decompresses.

Provider compression support is probed on first call: a 415 or 400 response triggers
a fallback to uncompressed for all subsequent requests to that provider.

### Circuit Breaker

`embedding-remote.js:13`

Standard three-state circuit breaker (CLOSED / OPEN / HALF_OPEN) with 5-failure
threshold and 60-second cooldown. When open, all requests fall back to the local model.

---

## Indexing Pipeline Stages

A full indexing run (via `index-codebase-v21.js`) executes these phases:

### 1. File Discovery

`discoverFilesPhase()` - finds all indexable files in the project, respecting
gitignore and configured exclusion patterns. Supports `--stdin` for targeted indexing
of specific files.

### 2. Change Detection

`determineFilesToIndexPhase()` - compares file content hashes against the stored
incremental state to find changed/new/removed files. Skipped for `--full-reindex`.

### 3. Code Graph (Phase 1)

`buildCodeGraph()` in `indexer-build.js` - extracts entities and relationships using
`GraphExtractor`, resolves relationship targets, stores in `code-graph.db`. Runs
summary backup/restore to preserve HCGS summaries across graph rebuilds.

### 4. Vector Embeddings + DB Write (Phase 2)

`buildVectorIndex()` in `indexer-build.js` - parses files into chunks via `ASTChunker`,
then uses `pipelinedEmbedAndInsert()` to overlap embedding with database writes.

**Pipelined embed+write (P2)**: While batch N+1 is embedding, batch N's results are
inserted into SQLite. This overlaps I/O with compute. The `pipelinedEmbedAndInsert()`
function manages a prepared statement, a transaction wrapper, and batch-size-aware
insert chunking (2,000 rows per transaction).

**Zero-copy inserts (L4)**: `buildInsertItems()` uses byte-offset-aware
`Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)` for
`Float32Array` subarray views, avoiding copies before SQLite insertion.

### 5. HNSW Index (Phase 3)

`buildHNSWIndex()` / `incrementalUpdateHNSW()` in `indexer-ann.js` - builds or
updates the float HNSW index. Embeddings are Matryoshka-truncated to HNSW dimension
(512d) before insertion.

### 6. ColBERT Index (Phase 4)

`buildColBERTIndex()` in `indexer-ann.js`

Splits each chunk into lines (10-200 chars, up to 16 per chunk), collects them into a
flat array with a parallel ownership array, then processes in **mega-batches of 10,000
lines**. Each mega-batch flows through the full L0 bucketing pipeline.

Mega-batch processing bounds peak RSS at ~30 MB per batch (vs ~210 MB for all 72K lines
at once). After each mega-batch, embeddings are regrouped by chunk and inserted into the
ColBERT index.

ColBERT line batches use a relaxed hard cap (128 items for sequences under 128 tokens)
and `maxLength: 256` since lines are inherently short.

### 7. Quantized Artifacts (Phase 5)

`buildQuantizedArtifactsPhase()` in `indexer-ann.js` - builds binary HNSW (32x smaller,
Hamming distance) and int8 vector sidecar (4x smaller) from `codebase.db`. Skipped
for small incremental updates (threshold-gated with accumulated change tracking).

### Parallel Execution

HCGS summary regeneration runs in parallel with vector embedding (Phase 2 + summaries
overlap via `Promise.all`). **Note (2026-05): HCGS is disabled by default
(`HCGS_CONFIG.enabled = false`); the phase short-circuits and no LLM calls fire.**

---

## SQLite Write Strategy

### Journal Mode (P0)

`configureJournalMode()` in `indexer-utils.js:26`

| Condition | Mode | Settings |
|-----------|------|----------|
| `sqliteFastMode` flag | MEMORY | `synchronous=OFF`, `cache_size=-64000` |
| Native Linux (not WSL drvfs) | WAL | `synchronous=NORMAL`, `wal_autocheckpoint=1000` |
| WSL/Windows/other | DELETE | `synchronous=NORMAL` |

`isWalSafe()` returns `true` only on Linux. On WSL (detected via `WSL_DISTRO_NAME`
env var), it additionally rejects drvfs paths matching `/mnt/[a-zA-Z]/` (Windows
filesystem mounts that don't support WAL's shared-memory protocol). WSL with native
ext4 paths (e.g., `/home/...`) still gets WAL.

### Batch Insert Chunking

`insertVectors()` and `pipelinedEmbedAndInsert()` chunk inserts into transactions of
2,000 rows (`BATCH_INSERT_SIZE`) to cap SQLite's in-memory transaction footprint.

### Atomic Swap

Full rebuilds write to a `.tmp` file, then `atomicSwapDatabase()` renames it over the
production database. This prevents serving a half-built index.

---

## Buffer Lifetime Model

Embedding buffers flow through five stages with well-defined ownership:

```
Pipeline output (EPHEMERAL)     May be reused by HF pipeline on next call
       │
       ▼
Pool buffer (OWNED)             new Float32Array(batchSize * dim) per batch
       │                        pool.set(output.data) - single copy
       ▼
subarray() views (READ-ONLY)    Returned by callLocalModel()
       │                        Safe: we own the pool, it's never overwritten
       ▼
SQLite insertion (COPY)         Buffer.from() with byteOffset awareness
       │                        better-sqlite3 copies into DB file
       ▼
HNSW / ColBERT (COPY)          HNSW normalizes into new Float32Array before insert
                                ColBERT uses int8 quantization (separate allocation)
```

Rules:
1. Never hold pipeline output references across calls
2. One pool per batch - pools from different batches are independent
3. Consumers must not mutate subarray views in-place (copy first if needed)
4. Remote provider embeddings arrive as parsed JSON arrays - no buffer reuse risk
5. ColBERT mega-batches release pools after SQLite insertion; peak ~30 MB per batch

---

## Environment Variables

### Embedding

| Variable | Default | Effect |
|----------|---------|--------|
| `EMBEDDING_PROVIDER` | (auto) | Force a specific provider: `voyage`, `mistral`, `jina`, `local` |
| `VOYAGEAI_API_KEY` | (none) | Enables Voyage Code 3 |
| `MISTRAL_API_KEY` | (none) | Enables Mistral Codestral Embed |
| `JINA_API_KEY` | (none) | Enables Jina Embeddings v3 |
| `SWEET_SEARCH_INDEXING_MAX_LENGTH` | 512 | Token cap for indexing embeddings |
| `SWEET_SEARCH_QUERY_MAX_LENGTH` | 512 | Token cap for query embeddings |
| `SWEET_SEARCH_BATCHING_SAFETY` | 1.15 | Safety multiplier for token estimation |
| `SWEET_SEARCH_DISABLE_MEM_GUARD` | (unset) | Disable RSS-based batch size reduction |
| `SWEET_SEARCH_USE_OPENVINO` | (auto) | OpenVINO auto-enabled on Intel only when provider is available; set `0` to disable |
| `SWEET_SEARCH_INDEXING_OUTPUT_DIMENSION` | (HNSW dim) | Server-side Matryoshka dimension |
| `SWEET_SEARCH_EMBEDDING_CONCURRENCY` | 4 | Max concurrent API batch requests |

### Indexing

| Variable | Default | Effect |
|----------|---------|--------|
| `SWEET_SEARCH_DATA_DIR` | `.sweet-search/` | Data directory for all indexes |

---

## Test Coverage

### Embedding Correctness (`tests/embedding-correctness.test.js`)

Consolidated suite (single ONNX model load, ~12s saved vs separate files). Contains:

- **Truncation sentinel** - verifies `max_length=512` produces different embeddings than
  `max_length=1024` for long texts, and near-identical for short texts
- **Padding sentinel** - verifies a short text produces the same embedding regardless of
  its batch companions (catches broken attention masks in mean pooling)
- **Batching parity** - verifies sequential vs batched inference produces equivalent
  results within dual tolerance (`maxAbsDiff < 3e-4` OR `cosSim > 0.999985`)
- **Bucketing order preservation** - verifies L0 sort+unsort restores original order,
  including duplicate strings and same-length/different-string cases
- **Buffer safety** - verifies batch N's subarray views survive batch N+1 unchanged

### Rate Limiter (`tests/rate-limiter-concurrency.test.js`)

Fires N concurrent `acquire()` calls through `TimeWindowRateLimiter` with fake timers,
asserts no 60-second window exceeds configured RPM.

### Performance Benchmark (`tests/embedding-perf.test.js`)

Throughput harness reporting docs/second and tokens/second. Excluded from default
`npm test` run (opt-in only).

---

## Known Limitations

**Truncation is local-only.** The `@huggingface/transformers` pipeline does not forward
`max_length` to the CodeRankEmbed ONNX model. The current workaround calls the tokenizer
directly (`model.tokenizer()`) with explicit truncation, then feeds the token tensors to
`model.model()`. This bypasses the pipeline's convenience layer but achieves correct
truncation.

**ColBERT line contiguity.** The mega-batch stream-insert logic assumes lines for a
given chunk appear contiguously in the flat array. This is guaranteed by the sequential
chunk-by-chunk build loop. Parallelizing the line collection step would break the
regrouping logic.

---

## Deferred Optimizations (Phase 4)

These were analyzed but deferred because Phases 1-3 brought indexing from ~30 minutes
(chunks only) / ~8.5 hours (with ColBERT) to well under 5 minutes:

- **P3: Worker threads** - multi-process parallelism with N model instances. Each worker
  loads ~200 MB. Only pursue if single-process throughput is insufficient.
- **P1: Pre-tokenization cache** - cache tokenized tensors by content hash. Most useful
  for incremental re-indexing where 90% of chunks are unchanged.
- **L3c: Threading auto-tuner** - full grid search over intraOp/interOp thread counts.
  Current heuristic (physical cores - 1, cap 8) works well enough.
- **O1/O2: Offline ONNX optimization** - pre-optimize the model graph with Python tools.
  Script exists at `scripts/optimize-onnx-model.sh` but requires Python + onnxruntime.
- **L6: FP16 inference** - mixed-precision compute on CPUs with F16C/AVX-512-FP16.
- **M1: Smaller indexing model** - use MiniLM-L6-v2 (22M params) for indexing, keep
  CodeRankEmbed for queries. Not needed after batching made CodeRankEmbed fast enough.

The original analysis and impact estimates were in `docs/INDEXING_OPT_PLAN.md`
(removed after implementation; see git history at commit `40e25bf`).
