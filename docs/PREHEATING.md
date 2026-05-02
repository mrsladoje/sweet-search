# Session Preheating

> **HCGS Status (2026-05)**: HCGS is disabled by default (`HCGS_CONFIG.enabled = false`); references below describe the original design. Flip the flag to re-enable.

Session preheating eliminates cold-start latency by warming caches, TLS connections, and ML model runtimes before the first user query arrives. It runs automatically at the start of every Claude Code session via a hook that invokes the preheat shell script.

## Architecture

The system uses a **thin-bash + smart-JS** two-file pattern:

| File | Role |
|------|------|
| `.claude/helpers/session-preheat.sh` | Bash wrapper: lock acquisition, server spawn, delegation, daemon launch |
| `core/session-warmup.js` | Warmup coordinator: conditional registry, health polling, connection pooling |

The bash wrapper handles process lifecycle; all warmup intelligence lives in the JS module. This keeps the shell script short (~130 lines) and the warmup logic testable.

## session-preheat.sh

The shell wrapper performs four tasks in sequence:

1. **Lock + stale slug cleanup** — Acquires `/tmp/sweet-search-preheat.lock` (TTL 24h) and removes session slug files older than 4 hours. If a valid lock exists and the server is healthy, the script exits immediately.
2. **Server spawn** — Starts `core/sweet-search.js --serve` in the background if no healthy server is running on port 9876.
3. **Warmup delegation** — Runs `core/session-warmup.js` which handles all conditional warmup logic.
4. **Index maintainer daemon** — Starts `.claude/hooks/index-maintainer.mjs` if not already running (PID-file guarded).

The outer invocation (`session-preheat.sh` without `--worker`) is non-blocking: it cleans slugs, checks the lock, then forks `--worker` via `nohup` and exits immediately so the Claude session isn't delayed.

## session-warmup.js

The warmup coordinator implements a **registry pattern** where each warmup component is a named entry with a phase, a condition function (`when`), and a warmup function.

### Warmup phases

**Pre-ready** tasks run in parallel with server health polling — they don't need the server to be fully initialized:

| Component | What it does |
|-----------|-------------|
| `fts5+hcgs` | Touches SQLite FTS5 page cache and HCGS summary pages. Prefers `warmFromCache()` from `vocab-warmer.js` (uses real cached terms); falls back to raw FTS5 query. |
| `vocabulary` | Reads the binary vocabulary artifact (`.sswv` format) into the OS page cache to avoid a ~100ms stall on the first semantic query. |
| `embedding-api-connection` | Sends a minimal embedding request to the active remote provider (Voyage/Mistral/Jina) to establish the TCP+TLS tunnel. Skipped for local providers. |
| `reranker-api-connection` | Same TLS warmup for the stage-2 reranker API, if the active stage-2 is a remote provider. |

**Post-ready** tasks require the server to be fully initialized and exercise real `/search` endpoints:

| Component | What it does |
|-----------|-------------|
| `query-router` | Fires a lightweight `mode=auto, k=1, rerank=false` search to warm the query routing path. |
| `flashrank` | Fires a `mode=semantic, k=20, rerank=true` search to trigger FlashRank model loading. |
| `colbert` | Fires a `mode=semantic, k=20, colbert=true` search to trigger ColBERT model loading. Only runs when ColBERT is enabled. |

### Orchestration flow

1. Read `/health` — if the server reports `ready`, skip all warmup (idempotent fast path).
2. Build the warmup plan from configuration. Filter to components whose `when()` condition is true.
3. Run all qualifying pre-ready warmups in parallel with `waitForReady()` health polling.
4. Once the server reports ready, run all qualifying post-ready warmups in parallel.
5. Close connection pools and report timing results.

### Connection pooling

Remote API warmups use `undici` `Pool` instances (2 connections, 30s keep-alive) instead of bare `fetch()`. This ensures the established TLS tunnel is reusable by the server process for subsequent real requests. The pool is created per-origin and cleaned up after warmup completes.

Pooling can be disabled by setting `SWEET_SEARCH_USE_UNDICI_POOL=0`.

## Conditional warmup matrix

### Embedding provider matrix

| Active Provider | Warm CodeRankEmbed (local)? | Warm API connection? |
|-----------------|-----------------------------|----------------------|
| `local` | Yes (server handles via init) | No |
| `voyage` / `mistral` / `jina` | Yes (lazy fallback for SemanticCache keys) | Yes (Undici pool) |

### Reranker two-stage cascade matrix

FlashRank is always stage-1 (fast local filter, ~15ms). Stage-2 is conditional:

| Stage-2 Reranker | Warm FlashRank (stage-1)? | Warm stage-2? |
|------------------|---------------------------|---------------|
| None (default) | Yes | No |
| ModernBERT (`USE_LOCAL_RERANKER=true`) | Yes | Yes (+ JIT inference) |
| Voyage Rerank | Yes | Yes (TLS handshake) |
| Jina Rerank | Yes | Yes (TLS handshake) |

## ONNX optimized graph persistence

`core/onnx-session-utils.js` provides shared utilities for ONNX Runtime session configuration:

- **`buildSessionOptions(modelId, suffix)`** — Returns session options with `graphOptimizationLevel: 'all'` and an `optimizedModelFilePath` pointing to `~/.cache/sweet-search/<suffix>-optimized-ort<version>-<hash>.onnx`. The hash is derived from the model ID for cache-key uniqueness.
- **`loadModelWithSessionOptions(loader, baseOptions, sessionOptions)`** — Tries multiple option shapes (`session_options` and `sessionOptions`) to handle `@huggingface/transformers` API differences across versions.
- **`warnIfGraphNotMaterialized(label, sessionOptions)`** — Logs a warning if the optimized graph file doesn't exist yet (first run).

On the first load, ONNX Runtime applies all graph optimizations and writes the result to the optimized path. Subsequent loads skip JIT compilation, saving ~2-5s per model.

Thread configuration scales to available cores: `intraOpNumThreads` is set to `min(8, ceil(cores/2))`, `interOpNumThreads` is 1, execution mode is parallel.

## Async server init

`search-server.js` starts accepting HTTP connections immediately, before `init()` completes. During initialization:

- **`/search`** returns `503` with `{ "status": "starting" }` (or `"failed"` if init errored).
- **`/health`** returns `200` with `{ "status": "starting", "warm": false }`.

Once init completes successfully, `/health` returns `{ "status": "ready", "warm": true }` and `/search` begins serving results. This design enables the warmup coordinator to overlap pre-ready tasks with the server boot window rather than waiting for full initialization.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SWEET_SEARCH_BASE_URL` | `http://localhost:9876` | Server base URL for health polling and warmup requests |
| `SWEET_SEARCH_HEALTH_TIMEOUT_MS` | `1000` | Timeout per individual health check request |
| `SWEET_SEARCH_READY_TIMEOUT_MS` | `10000` | Maximum time to wait for server readiness |
| `SWEET_SEARCH_POLL_MS` | `200` | Interval between health poll attempts |
| `SWEET_SEARCH_USE_UNDICI_POOL` | `1` | Set to `0` to disable Undici connection pooling and use bare `fetch()` |
