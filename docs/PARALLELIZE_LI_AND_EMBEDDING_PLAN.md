# Parallelize Search Embedding & LI Query Encoding

**Status:** Research / Benchmarking Required
**Risk:** Low (implementation is a promise-hoist; no algorithmic change)

## Problem

The search-time embedding (`getBinaryEmbedding`) and the late-interaction
query encoding (`encodeQuery`) run **sequentially** today, even though
`encodeQuery` depends only on the query text — not on search results.

Current call sites:
- `getBinaryEmbedding(query)` — `core/search-semantic.js:161`
- `encodeQuery(query)` — `core/search-postprocess.js:261` (legacy path)
  or `core/cascaded-scorer.js:221` (cascade path)

`encodeQuery` doesn't fire until **after** the entire 3-stage pipeline +
graph expansion completes. That's wasted wall-clock time.

## Proposed Change

Fire `encodeQuery(query)` eagerly at pipeline entry, in parallel with the
search embedding. Await the resulting promise only when LI scoring is needed.

```js
// At pipeline entry (search-semantic.js or sweet-search.js):
const liPromise = useLateInteraction ? encodeQuery(query) : null;
const embedResult = await getBinaryEmbedding(query);

// ... stages 1-3, graph expansion ...

// When LI scoring is needed (postprocess / cascade):
const queryTokens = liPromise ? await liPromise : null;
```

## What This Overlaps

On the happy path (warm caches, Voyage remote provider):

| Step | Current (ms) | Parallel (ms) |
|------|-------------|---------------|
| getBinaryEmbedding (cached) | ~0.1 | ~0.1 |
| Stages 1–2.5 | ~1–3 | ~1–3 |
| Graph expansion | ~2–15 | ~2–15 |
| **encodeQuery (ONNX)** | **~2–10** | **hidden** |
| **Total saved** | — | **~2–10ms** |

Cold embedding (remote API, ~50–200ms network) gives even more overlap
since `encodeQuery` (CPU) runs entirely behind the network wait.

## CPU Contention Analysis

The two operations use **different compute resources**:

- `getBinaryEmbedding` → remote API call (Voyage) = **network-bound**, or
  local ONNX session (one model)
- `encodeQuery` → local ONNX session (LateOn-Code), CPU-bound,
  uses `bestIntraOpThreads()` for intra-op parallelism

### M3 Max (128GB, 16 cores)

- Remote embedding: **zero contention** — one is network I/O, one is CPU
- Local embedding: two ONNX sessions, ~4–8 threads each, 16 cores available
  — fits comfortably, **no contention expected**
- Verdict: **clear win**

### Windows/WSL (10GB RAM, ~4–8 cores)

- Remote embedding: **same as M3 Max — pure win**
- Local embedding: two ONNX sessions may cause thread oversubscription on
  4-core machines. Memory pressure from two models loaded simultaneously.
- Verdict: **likely net-positive, but must benchmark**
- Worst case is a wash (two CPU-bound sessions fighting for cores), not a
  regression

## Open Questions (Requires More Research)

1. **Thread pool sharing**: Do both ONNX sessions share an ORT thread pool
   or create independent pools? If shared, contention is self-regulated.
2. **Memory impact**: LateOn-Code model is ~100–400MB. On 10GB machines,
   both models loaded + search data could cause swap pressure.
3. **Error propagation**: If `encodeQuery` fails early (model not loaded,
   OOM), the error surfaces late. Need to handle rejected promise gracefully
   so it doesn't crash the pipeline.
4. **Cascade vs legacy path**: The promise needs to be threaded through to
   whichever path consumes it. Cascade scorer currently does its own
   `encodeQuery` call — need to pass the pre-fired promise instead.

## Benchmarking Plan

Must benchmark on **both** machines before merging:

- [ ] M3 Max 128GB — warm cache, cold cache, local provider, remote provider
- [ ] Windows/WSL 10GB — same matrix
- [ ] Measure: total latency, `encodeQuery` latency, CPU utilization
- [ ] Confirm no recall/quality regression (parallelism shouldn't affect
      output, but verify)

## Implementation Scope

- Hoist `encodeQuery` call to `semanticSearch3Stage` (or `search()` entry)
- Thread the promise through `searchContext` to `applyPostRetrieval`
- Thread it to `cascadedScore` as an option
- Add config gate: `LATE_INTERACTION_CONFIG.parallelEncode` (default: true)
  with env override `SWEET_SEARCH_PARALLEL_LI_ENCODE=0` to disable
- ~50 lines of change across 3 files
