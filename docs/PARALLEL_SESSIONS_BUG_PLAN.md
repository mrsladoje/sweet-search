# Parallel Sessions Concurrency Plan (Search Serving)

**Date:** 2026-03-27
**Updated:** 2026-03-30
**Status:** Proposed
**Scope:** Ensure the **search server** handles concurrent search requests safely — multiple CLI invocations, multiple MCP clients, multiple HTTP callers hitting the warm server simultaneously. This plan covers the **query-time** path only. For indexing throughput optimizations (worker thread parallelism, batch pipeline speedups), see `INFERENCE_SPEEDUP_PLAN.md`.

---

## Problem Statement

Sweet Search was designed around a single-user, single-request-at-a-time mental model. The warm server (`search-server.js`) accepts unlimited concurrent HTTP connections, but the underlying model infrastructure has a mixed concurrency story:

| Component | Current behavior | Protected? |
|-----------|-----------------|------------|
| Embedding model load | Singleton + promise dedup | Yes |
| Embedding inference (`callLocalModel`) | Concurrent ORT `session.run()` | No mutex |
| Late interaction model load | Singleton + promise dedup | Yes |
| Late interaction inference (`encodeQuery`, `encodeDocuments`) | Concurrent ORT `session.run()` | No mutex |
| FlashRank reranker inference | Global ONNX mutex (FIFO queue) | Yes |
| LocalReranker inference | Global ONNX mutex (FIFO queue) | Yes |
| HTTP server | Unlimited concurrent connections | No cap |
| SQLite reads (`better-sqlite3`) | Synchronous, blocks event loop | Implicit serial |
| Embedding cache (LRU) | Module-level singleton, JS object | No lock (safe in single-thread JS) |

The rerankers are correctly serialized via `withOnnxMutex()` in `core/onnx-mutex.js`. But embedding and late interaction inference bypass the mutex entirely — they call `session.run()` directly on a shared ORT session.

### Why this hasn't blown up yet

1. Node.js is single-threaded at the JS level, so two `session.run()` calls can't overlap in JS setup.
2. ORT sessions are generally thread-safe for read-only inference (different input buffers → different internal state).
3. The rerankers were explicitly put behind the mutex after empirical crashes — likely cross-encoder models have different threading characteristics than encoder-only models.
4. Most usage today is single-user with one request in-flight at a time.

### When this will blow up

- Multiple Claude Code sessions sharing one warm server (common workflow)
- MCP server handling concurrent tool calls from multiple clients
- CI pipelines running parallel search-based tasks
- Programmatic batch usage via the HTTP API
- Any deployment where Sweet Search serves more than one user

---

## Concrete Risks

### Risk 1: Unbounded concurrent ORT inference (medium)

**What:** N parallel search requests each fire `callLocalModel()` and `encodeQuery()` concurrently. Each triggers `session.run()` on the shared ORT session. ORT's C++ thread pool (`bestIntraOpThreads()` threads per session) handles the parallelism internally.

**Failure mode:** On machines with limited cores, N concurrent inferences each trying to use `bestIntraOpThreads()` native threads creates thread contention and cache thrashing. Latency degrades super-linearly. On edge cases, ORT may produce incorrect results or crash if a model's internal state isn't fully thread-safe (documented ORT issues exist for certain model types).

**Likelihood:** Medium. Encoder-only models (CodeRankEmbed, LateOn-Code) are simpler than cross-encoders, so ORT's thread safety is more reliable. But it's untested under high concurrency.

### Risk 2: Reranker mutex becomes a latency cliff (high)

**What:** The ONNX mutex (`core/onnx-mutex.js`) serializes all reranker work into a single FIFO queue. Under N parallel requests, each reranking step must wait for all N-1 preceding ones.

**Failure mode:** With reranking taking 20-100ms per request, 5 concurrent requests means the last one waits 80-400ms just in the mutex queue. No timeout, no backpressure, no "skip reranking under load" fallback. The HTTP timeout (`SEARCH_SERVER_TIMEOUT_MS = 30s`) is the only safety valve.

**Likelihood:** High under any real concurrent load. This is the primary bottleneck.

### Risk 3: No request concurrency cap (high)

**What:** The HTTP server (`http.createServer`) accepts every incoming connection. There's no semaphore, no max-concurrent-requests limit, no admission control.

**Failure mode:** Under burst load (e.g., agent spawning 10 parallel searches), all 10 enter the pipeline simultaneously. Memory spikes (each holds embedding vectors, candidate lists, graph expansion results). The reranker queue backs up. GC pressure increases. Tail latency explodes.

**Likelihood:** High. This is the most basic missing piece.

### Risk 4: Memory accumulation under concurrent load (medium)

**What:** Each in-flight search holds:
- Query embedding vectors (~3KB)
- Binary query embedding (~384 bytes)
- LI query token vectors (~50KB for 256 tokens × 128d)
- Candidate result sets (~100KB for top-100 with metadata)
- Graph expansion working set (~variable, can be large)

**Failure mode:** N concurrent requests × per-request memory = potential GC pressure spike. The periodic cache clear (every 1000 requests) doesn't help with per-request working memory.

**Likelihood:** Medium. Manageable for 5-10 concurrent requests, problematic for 50+.

### Risk 5: SQLite contention under concurrent reads (low)

**What:** `better-sqlite3` is synchronous. Each `.get()` or `.all()` call blocks the event loop until the C layer returns. Multiple concurrent searches interleave their SQLite reads across event loop ticks.

**Failure mode:** SQLite itself handles concurrent readers fine (WAL mode). But synchronous calls block the event loop, so under heavy load, event loop latency increases and all async operations (HTTP responses, ORT callbacks) get delayed.

**Likelihood:** Low. SQLite reads are fast (sub-ms for indexed lookups). This only matters at very high concurrency.

---

## Design Principles

1. **Don't break the fast path.** Single-request latency must not regress.
2. **Protect models, not just mutexes.** The goal is safe concurrent inference, not just crash prevention.
3. **Backpressure over queuing.** Better to reject/delay a request at the door than let it pile up in internal queues.
4. **Degrade gracefully.** Under load, skip expensive stages (reranking, late interaction) rather than timing out.
5. **Observable.** Expose concurrency state in `/health` so callers can make informed retry decisions.

---

## Proposed Changes

### Phase 1: Request admission control (server-level semaphore)

**File:** `core/search-server.js`

Add a concurrency limiter that caps how many search requests execute simultaneously.

```js
const MAX_CONCURRENT_SEARCHES = parseInt(
  process.env.SWEET_SEARCH_MAX_CONCURRENT || '4', 10
);
let activeSearches = 0;

// In handleRequest, before entering searcher.search():
if (activeSearches >= MAX_CONCURRENT_SEARCHES) {
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Server busy',
    activeSearches,
    maxConcurrent: MAX_CONCURRENT_SEARCHES,
    retryAfterMs: 100,
  }));
  return;
}
activeSearches++;
try {
  // ... existing search logic ...
} finally {
  activeSearches--;
}
```

**Default: 4.** This is enough for normal multi-session use but prevents runaway queue depth. Configurable via env var for power users.

**Why 4:** On an M3 Max with 16 cores, 4 concurrent searches can share ORT's thread pool without catastrophic contention. Each search uses `bestIntraOpThreads()` (typically 5-7) native threads. 4 × 6 = 24 native threads — already exceeding physical cores, but ORT's thread pool is smart about yielding.

Expose in `/health`:

```json
{
  "concurrency": {
    "active": 2,
    "max": 4,
    "queued": 0
  }
}
```

**Exit criteria:**
- Server returns 503 when at capacity
- `/health` reports concurrency state
- No single-request latency regression

### Phase 2: Mutex timeout and queue depth limit

**File:** `core/onnx-mutex.js`

The current mutex is a bare promise chain with no timeout and no queue depth limit. Under concurrent load, the queue grows silently.

Add timeout and depth:

```js
let _onnxQueueDepth = 0;
const ONNX_MUTEX_MAX_QUEUE = parseInt(
  process.env.SWEET_SEARCH_ONNX_QUEUE_MAX || '8', 10
);
const ONNX_MUTEX_TIMEOUT_MS = parseInt(
  process.env.SWEET_SEARCH_ONNX_TIMEOUT_MS || '5000', 10
);

export async function withOnnxMutex(fn, { label = 'onnx' } = {}) {
  if (_onnxQueueDepth >= ONNX_MUTEX_MAX_QUEUE) {
    throw new Error(`[OnnxMutex] Queue full (${_onnxQueueDepth}/${ONNX_MUTEX_MAX_QUEUE})`);
  }
  _onnxQueueDepth++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _onnxQueueDepth--;
      reject(new Error(`[OnnxMutex] Timeout after ${ONNX_MUTEX_TIMEOUT_MS}ms waiting for ${label}`));
    }, ONNX_MUTEX_TIMEOUT_MS);

    _onnxQueue = _onnxQueue.then(async () => {
      clearTimeout(timer);
      try {
        const result = await fn();
        _onnxQueueDepth--;
        resolve(result);
      } catch (err) {
        _onnxQueueDepth--;
        reject(err);
      }
    });
  });
}

export function getOnnxQueueDepth() { return _onnxQueueDepth; }
```

**Exit criteria:**
- Mutex rejects after timeout instead of waiting forever
- Queue depth is observable
- Existing tests pass (update `resetOnnxMutex` to also reset depth)

### Phase 3: Extend mutex to embedding and late interaction inference

**Files:** `core/embedding-local-model.js`, `core/late-interaction-model.js`

Today, only FlashRank and LocalReranker go through `withOnnxMutex()`. The embedding and late interaction models call `session.run()` directly.

This phase wraps inference (not loading) in the mutex:

```js
// In embedding-local-model.js callLocalModel():
import { withOnnxMutex } from './onnx-mutex.js';

// Wrap the actual session.run() call, not the entire function
const output = await withOnnxMutex(
  () => runDirectOrt(pipeline, modelInputs),
  { label: 'embedding' }
);
```

```js
// In late-interaction-model.js encodeQuery() / encodeDocuments():
const hidden = await withOnnxMutex(
  () => runRawInference(session, tokenized, ort),
  { label: 'late-interaction' }
);
```

**Important:** Wrap only `session.run()`, not tokenization or pre/post-processing. Tokenization is pure JS and can run concurrently without issues. Only the native ORT inference needs serialization.

**Why this is safe:** The rerankers already proved this pattern works. Serializing inference may add latency under concurrency, but it eliminates the risk of ORT thread pool contention and potential correctness issues.

**Performance note:** This makes all ORT inference serial through a single queue. For a single request, there's zero overhead (no other work in the queue). For concurrent requests, inference is serialized but tokenization, graph expansion, SQLite reads, and all other JS work still runs concurrently in the event loop. The total wall-clock overhead is bounded by `(N-1) × inference_time_per_request`.

**Exit criteria:**
- All ORT `session.run()` calls go through `withOnnxMutex()`
- Single-request latency unchanged (benchmarked)
- Concurrent requests don't crash or produce incorrect results

### Phase 4: Graceful degradation under load

**Files:** `core/sweet-search.js`, `core/cascaded-scorer.js`

When the ONNX mutex queue is deep or the server is under load, skip expensive optional stages rather than queuing:

```js
import { getOnnxQueueDepth } from './onnx-mutex.js';

// In the search pipeline, before reranking:
const underPressure = getOnnxQueueDepth() > 2;
if (underPressure && !options.forceRerank) {
  stats.reranking = { skipped: true, reason: 'queue_pressure' };
  // Return results with only MaxSim/HNSW scores — still useful
} else {
  // Normal reranking path
}
```

Similarly for late interaction scoring: if the queue is deep and we already have decent HNSW scores, skip the MaxSim rescore.

**This is a quality tradeoff, not a correctness issue.** Results without reranking are still good — they're just not as precisely ordered. Under load, fast approximate results are better than slow exact results.

**Exit criteria:**
- Search pipeline checks queue pressure before expensive stages
- Skipped stages are reported in `stats`
- Results are always returned (never hang waiting for mutex)

### Phase 5: Client-side retry with backoff

**Files:** `core/search-server.js` (503 response), `core/search-cli.js` (client)

When the server returns 503, the CLI should retry with exponential backoff:

```js
// In queryServer() or search-cli.js:
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 50;

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  const result = await queryServer(query, options);
  if (result.error === 'Server busy' && attempt < MAX_RETRIES) {
    const delay = BASE_DELAY_MS * (2 ** attempt) + Math.random() * 50;
    await new Promise(r => setTimeout(r, delay));
    continue;
  }
  return result;
}
```

**Exit criteria:**
- CLI retries on 503 with backoff
- Total retry time bounded (< 1 second for 3 retries)
- Stats report retry count when applicable

---

## What NOT to do

### Don't use worker threads for search-serving inference

For the **search path**, ORT already manages its own native thread pool (`intraOpNumThreads`). Adding worker threads to the search server would mean:
- Duplicating the ORT session (doubled model memory) for marginal latency improvement
- Each worker's ORT thread pool competing with others on short-lived queries
- Complexity for marginal benefit when single-query latency is already ~15ms

The right answer for search serving is: one ORT session per model, serialized inference via mutex, concurrent everything else.

> **Note:** Worker threads *are* the right approach for **indexing throughput** (bulk embedding of thousands of chunks). That use case is covered in `INFERENCE_SPEEDUP_PLAN.md` Phase 3, which uses a separate `IndexerPool` with adaptive session count based on hardware.

### Don't create per-request model instances

ORT model loading is expensive (~500-2000ms) and the models use significant memory (~100-400MB). Creating per-request instances would be catastrophic. The singleton pattern is correct.

### Don't add a full job queue / worker pool system

This is a local search tool, not a web service at scale. A simple semaphore + mutex is sufficient. Adding Redis, Bull, or other job queue infrastructure would be massive over-engineering.

### Don't serialize the entire search pipeline

Only ORT inference needs the mutex. Everything else (tokenization, SQLite reads, graph expansion, score computation, result formatting) is safe to run concurrently and should continue to do so.

---

## Relationship to INIT_PLAN.md

This plan is orthogonal to the INIT_PLAN phases. It can be implemented at any time without blocking or being blocked by packaging work.

However, two INIT_PLAN items are relevant:

1. **Phase 6b (napi-rs expansion):** When tokenization moves to native Rust, the tokenizer will also need concurrency consideration. The Rust `tokenizers` crate is thread-safe, so this should be fine — but the napi-rs bridge needs to be non-blocking.

2. **Phase 7 (native end-to-end model execution):** If ORT inference moves into native Rust (via ORT C API), the mutex can move to Rust as well (a proper `tokio::sync::Mutex` or `std::sync::Mutex`), which is more efficient than the JS promise-chain pattern.

Until then, the JS-level changes in this plan are sufficient and will remain correct even after the native migration.

---

## Implementation Order

| Phase | Effort | Risk reduction | Priority |
|-------|--------|---------------|----------|
| 1: Server semaphore | Small (1 file, ~30 lines) | High — prevents runaway | **Do first** |
| 2: Mutex timeout + depth | Small (1 file, ~40 lines) | High — prevents infinite waits | **Do first** |
| 3: Extend mutex to all ORT | Medium (2 files, ~20 lines each) | Medium — safety net | Second |
| 4: Graceful degradation | Medium (2-3 files) | Medium — UX under load | Third |
| 5: Client retry | Small (1-2 files) | Low — polish | Last |

Phases 1 and 2 are independent and can be done in parallel. Phase 3 depends on Phase 2 (needs the timeout). Phase 4 depends on Phase 3 (needs `getOnnxQueueDepth`). Phase 5 depends on Phase 1 (needs 503 responses).

---

## Testing Strategy

### Unit tests

- `onnx-mutex.js`: timeout fires, queue depth limit rejects, queue depth counter is accurate, reset clears all state
- Server semaphore: 503 returned when at capacity, counter increments/decrements correctly, finally block always decrements

### Integration tests

- Fire N concurrent search requests against warm server, verify all return valid results (no crashes, no garbled output)
- Fire N+1 requests where N = max concurrent, verify the extra request gets 503
- Fire requests while mutex queue is artificially slow, verify timeout triggers
- Verify graceful degradation: under pressure, results returned without reranking, stats indicate skipped stages

### Benchmark

- Compare single-request latency before/after (must not regress)
- Measure concurrent throughput: 4 parallel requests total time vs 4 sequential
- Measure tail latency (p99) under 4-8 concurrent requests

---

## Acceptance Criteria

1. The warm server handles 4+ concurrent search requests without crashes, garbled results, or ORT errors
2. Excess requests get a clear 503 with retry guidance, not silent hangs
3. The ONNX mutex has a timeout — no request waits more than 5 seconds for inference
4. Single-request latency is unchanged (verified by benchmark)
5. `/health` reports concurrency state (active requests, queue depth)
6. Under load, the system degrades gracefully (faster approximate results) rather than queuing to timeout
