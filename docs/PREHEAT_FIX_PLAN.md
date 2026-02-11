# Preheat Fix Plan: Eliminate Model Duplication

**Status**: Plan (not yet implemented)
**Date**: 2026-02-11
**Scope**: Restructure `session-preheat.sh` to stop loading models in a throwaway process. The search server already loads everything itself — the preheat script should start the server and verify readiness, not duplicate the work.

---

## 1. Problem Statement

The preheat script (`session-preheat.sh`) starts the search server **and** loads all heavy models in a separate inline Node.js process. The server's `init()` (`sweet-search.js:92-166`) already loads the same components:

| Component | Server `init()` loads it? | Preheat also loads it? | Duplication? |
|-----------|--------------------------|----------------------|-------------|
| Binary HNSW index | Yes (line 111) | Yes (`warmBinaryHNSW`) | **Yes** |
| HNSW index | Yes (line 122) | Yes (`warmHNSW`) | **Yes** |
| ColBERT index | Yes (line 133) | Yes (`warmColBERT`) | **Yes** |
| Embedding model (all-MiniLM-L6-v2) | Yes (line 144, via `warmupEmbedding`) | Yes (`warmLocalModel`) | **Yes** |
| Vocabulary cache | Yes (line 144, `initVocabulary: true`) | Yes (`warmVocabulary`) | **Yes** |
| Local reranker (ModernBERT) | Yes (line 150) | Yes (`warmLocalReranker`) | **Yes** |
| FlashRank reranker | No (lazy, on first rerank call) | Yes (`warmFlashRank`) | **Partial** |
| SQLite FTS5 | No (lazy, on first query) | Yes (`warmSQLiteFTS`) | No |
| HCGS summaries DB | No (lazy, on first summary lookup) | Yes (`warmHCGS`) | No |
| Voyage TLS connection | No | Yes (`warmVoyageConnection`) | No |
| WASM Query Router | No (lazy, on first `routeQuery`) | Yes (`warmQueryRouter`) | No |

**6 out of 11 components are fully duplicated.** The preheat loads ~100MB of ONNX models into a process that exits immediately. The only benefit is warming the OS file cache on the very first session — after that, those files are already in page cache.

### Why This Matters

- **Memory**: Two copies of the embedding model (~80MB) and reranker (~150MB) exist in RAM simultaneously during startup
- **CPU**: Two ONNX JIT compilations run concurrently, competing for CPU cores
- **Time**: The server's `init()` may actually be *slower* because the preheat script is competing for the same CPU and I/O resources
- **Complexity**: The preheat script is 440 lines of bash + inline JS that largely duplicates what the server does in 75 lines

---

## 2. Proposed Architecture

### 2.1 New Preheat Flow

```
session-preheat.sh (simplified)
    1. Check lock file (existing logic, keep)        → <1ms
    2. Clean stale session slugs (existing, keep)     → <1ms
    3. Start search server if not running              → spawn & detach
    4. Wait for /health to return ready                → poll, max 10s
    5. Warm non-server components (parallel):
       a. FTS5 page cache (real terms)                 → ~200ms  (VOCAB_PREWARM_PLAN fixes this)
       b. WASM Query Router                            → ~6ms
       c. Voyage TLS handshake (if configured)         → ~100ms
       d. HCGS summary table touch                     → ~50ms
    6. Start index maintainer daemon (existing, keep)
```

**What's removed**: `warmLocalModel`, `warmVocabulary`, `warmFlashRank`, `warmHNSW`, `warmBinaryHNSW`, `warmColBERT`, `warmLocalReranker` — all handled by the server's `init()`.

**What's kept**: Components the server doesn't warm itself (FTS5, WASM router, Voyage TLS, HCGS touch). These are all lightweight (<200ms each).

### 2.2 Server Health Endpoint Enhancement

The current `/health` returns a simple 200 OK as soon as the HTTP listener is up — before `init()` finishes. This means the preheat can't reliably know when the server is actually warm.

Change `/health` to report initialization state:

```js
// GET /health
{
  "status": "ready",       // "starting" | "ready" | "error"
  "components": {
    "hnsw": true,
    "binaryHnsw": true,
    "colbert": true,
    "embedding": true,
    "vocabulary": true,
    "reranker": true
  },
  "initTimeMs": 3847
}
```

The preheat script polls `/health` and only proceeds to step 5 when `status === "ready"`.

### 2.3 FlashRank: Move to Server Init

FlashRank is currently lazy-loaded on first rerank call. Since we're removing the preheat's `warmFlashRank`, the server should eagerly load it during `init()` to avoid a cold-start penalty on the first search that triggers reranking.

Add to `sweet-search.js init()`:

```js
// Pre-initialize FlashRank reranker
if (!shouldUseLocalReranker()) {
  const { pipeline } = await import('@xenova/transformers');
  await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', { quantized: true });
  this.log('FlashRank: Pre-initialized');
}
```

### 2.4 WASM Query Router: Move to Server Init

The query router (`routeQuery`) is also lazy — WASM loads on first call. Since the server uses it on every request, it should warm during `init()`:

```js
// Pre-initialize WASM query router
routeQuery('warmup');
routeQuery('how does authentication work');
this.log('QueryRouter: WASM JIT warmed');
```

After this, the preheat script doesn't need to warm the query router either — further simplifying it.

---

## 3. Resulting Preheat Script

After the changes, `session-preheat.sh` shrinks from ~440 lines to ~80 lines:

```
1. Lock check + stale slug cleanup (existing)
2. Start server if not running
3. Poll /health until status=ready (max 10s)
4. Warm remaining non-server items:
   - FTS5 with real terms (via VOCAB_PREWARM_PLAN's warmLexical)
   - Voyage TLS handshake (if configured)
   - HCGS summary table touch
5. Start index maintainer daemon
```

The inline Node.js block drops from ~230 lines (11 async functions + Promise.all) to ~30 lines (3 lightweight warmups).

---

## 4. Interaction with Other Plans

| Plan | What it fixes | Interaction |
|------|--------------|-------------|
| **VOCAB_PREWARM_PLAN** | FTS5 with real terms, vocabulary with codebase terms, HNSW traversal warming, hybrid pipeline warming | Preheat calls `warmAll({ depth: 'light' })` after server is ready. The server handles model loading; vocab warmup handles the search-mode warming. |
| **HCGS_ENHANCE** | Faster summarization, dual-model embedding | No interaction with preheat. HCGS changes affect indexing pipeline, not session startup. |
| **AST_CHUNKER_FIX_PLAN** | Expand chunker to 22 languages | No interaction with preheat. Chunker runs during indexing, not startup. |

The key integration point: after the server reports `status: "ready"`, the preheat calls the vocab warmup at `light` depth (200 terms, <3s). This is where the VOCAB_PREWARM_PLAN's `warmLexical`, `warmSemantic` (HNSW traversal), and `warmHybrid` run — using the server's already-loaded models via HTTP, not loading separate copies.

---

## 5. Implementation Steps

1. **Enhance `/health` endpoint** in `sweet-search.js`
   - Return `{ status: "starting" | "ready", components: {...}, initTimeMs }`
   - Report ready only after `init()` completes

2. **Move FlashRank + Query Router to server `init()`**
   - Eagerly load FlashRank during init (not lazy)
   - Run two `routeQuery()` calls to warm WASM JIT

3. **Rewrite preheat inline JS**
   - Remove all 7 duplicated warmup functions
   - Keep: FTS5 real-term warmup, Voyage TLS, HCGS touch
   - Add: poll `/health` until `status === "ready"`

4. **Integrate VOCAB_PREWARM_PLAN's light warmup**
   - After server ready, call `warmAll({ depth: 'light' })` via the server or direct import
   - This replaces the 3 remaining non-server warmups (FTS5, HNSW traversal, hybrid pipeline)

5. **Simplify bash wrapper**
   - Remove the massive inline JS heredoc
   - Replace with a small Node script or direct HTTP calls to the server

---

## 6. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Preheat script lines | ~440 | ~80 |
| Inline JS warmup functions | 11 | 0 (all via server or vocab warmup) |
| Peak memory during startup | ~500MB (2 processes loading models) | ~300MB (server only) |
| Total warmup wall time | ~4s | ~4s (same — server init is the bottleneck either way) |
| CPU contention during startup | High (2 ONNX JIT compilations) | None (single process) |

---

## 7. Open Questions

1. **Vocab warmup via HTTP or direct import?** After the server is ready, should the preheat call `/vocab-prewarm?depth=light` (HTTP to server) or `import('./core/vocab-warmer.js')` (direct, same as current)? HTTP is cleaner (single process) but adds ~10ms overhead. Direct import means the preheat still runs Node.js, but only for lightweight work.

2. **FlashRank vs Local Reranker**: The server currently loads one or the other based on `USE_LOCAL_RERANKER`. Should it always eagerly load whichever is configured, or keep lazy loading for whichever isn't the default?
