# Session Preheating

> **HCGS Status (2026-05)**: HCGS is disabled by default (`HCGS_CONFIG.enabled = false`); references below describe the original design. Flip the flag to re-enable.

Session preheating eliminates cold-start latency by warming caches, TLS connections, and ML model runtimes before the first user query arrives. It runs automatically at the start of every Claude Code session via a Claude Code SessionStart hook (`core/search/session-daemon-prewarm.mjs`).

## Daemon launch (current mechanism)

> **Status (2026-05)**: the `session-preheat.sh` bash wrapper described in the
> sections below was replaced by a single Node SessionStart hook,
> `core/search/session-daemon-prewarm.mjs`. References to `session-preheat.sh`,
> port `9876`, and `core/sweet-search.js --serve` describe the earlier design and
> are kept for historical context. The hook talks to the daemon over the Unix
> socket `/tmp/sweet-search.sock`, not an HTTP port.

`sweet-search init` registers one SessionStart entry in `.claude/settings.json`:

```
node <pkg>/core/search/session-daemon-prewarm.mjs
```

On every Claude Code session start the hook launches **two** independent,
fully-detached background processes, then exits immediately so the session is
never blocked. The two launches sit in separate `try` blocks — a stuck or
already-running server never prevents the maintainer from starting, and vice
versa:

1. **Search server** — `core/start-server.js --serve`. Skipped when the Unix
   socket already accepts a connection (a healthy server is up). A tmp lockfile
   (`/tmp/sweet-search-prewarm.lock`) stops two concurrent sessions from both
   spawning.
2. **Index maintainer (incremental indexing)** — see below.

### Index maintainer auto-launch

The maintainer (`core/indexing/index-maintainer.mjs`, spawned as the **package**
copy) keeps the index fresh by reconciling file changes into FTS5, the vector
store, HNSW / binary-HNSW, late-interaction segments, the sparse-gram index, and
the code graph. As of 2026-05 it is **on by default** — a retrieval index that
silently goes stale is worse than useless for agents.

The prewarm hook spawns it detached unless any of these hold:

- **Opt-out** — `SWEET_SEARCH_RECONCILE_V2` is `0`, `false`, or `off`.
- **No index yet** — the project has no `.sweet-search/` state dir (nothing to
  maintain; run `sweet-search index` first).
- **Already running** — a live `index-maintainer.lock` is held in the state dir.
- **Entry missing** — the maintainer module isn't present.

The hook pins `SWEET_SEARCH_PROJECT_ROOT` to the session cwd so the package copy
targets the right project (its `PROJECT_ROOT` would otherwise resolve to the
package root). Single-instance is guaranteed two ways: the hook skips when a live
lock exists, and the daemon itself takes an `O_EXCL` `index-maintainer.lock` on
startup — a second maintainer for the same state dir exits immediately
("Another reconcile v2 maintainer is running").

#### Tick interval (machine-adaptive)

The startup tick interval is chosen from the detected hardware tier:

| Tier | Machine | Interval |
|------|---------|----------|
| low  | CPU-only / low RAM / pre-M3 / unknown / detection-failed | 60s |
| mid  | M3/M4 base or Pro, mid-tier CUDA, 32 GB+ RAM & 12+ cores | 30s |
| high | Apple Max/Ultra, 16 GB+ CUDA | 20s |

15s is the auto-tune floor (`MIN_MS`) only, never a startup default. Explicit
overrides win: `SWEET_SEARCH_RECONCILE_INTERVAL_MS` (ms),
`SWEET_SEARCH_RECONCILE_INTERVAL` (seconds), or `SWEET_SEARCH_RECONCILE_PROFILE`
(`fresh` / `balanced` / `conservative`) — all clamped to `[15s, 300s]`. From the
startup value the tuner adapts within the band based on dirty-set churn, tick
wallclock, CPU pressure, and maintenance backlog, and never overlaps ticks.

#### Inspect, opt out, and stop

- **Disable**: `export SWEET_SEARCH_RECONCILE_V2=0` (prevents auto-launch and
  routes any manually-started daemon to the legacy path).
- **Inspect**: `sweet-search reconcile status` reports enabled/source, the
  resolved interval (ms / source / tier), dirty/backlog/dead-letter counts, and
  the maintainer lock (present / pid / alive / stale).
- **Stop**: `sweet-search uninstall` stops a running maintainer (SIGTERM,
  escalating to SIGKILL after a short grace) and clears its lock, alongside
  stopping the search daemon.

### Codex CLI (`--codex`)

The auto-launch above is a **Claude Code** SessionStart hook (`.claude/settings.json`).
Other agents don't read that file. For the OpenAI Codex CLI, `sweet-search init
--codex` wires the equivalent, reusing the same `session-daemon-prewarm.mjs`
launcher (it's harness-agnostic — reads only env/cwd, writes nothing to stdout):

- **`.codex/hooks.json`** — a `SessionStart` hook (`matcher: "startup|resume"`)
  whose command is git-root anchored:
  `cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && node <relpath>`.
  Codex runs hook commands with the *session* cwd (which may be a subdirectory),
  so a bare relative path is unreliable — anchoring to the git root fixes both
  path resolution and the launcher's own project-root detection without writing
  a machine-specific absolute path into the (often committed) file.
- **`[features] hooks = true`** in the project `.codex/config.toml` — the
  canonical feature flag as of Codex v0.132+ — added via a comment-preserving,
  append-if-absent edit (no TOML round-trip). A deprecated `codex_hooks` flag
  from an older Codex / older sweet-search is **migrated** to `hooks` in place
  (Codex now warns on `codex_hooks`). With `--codex-enable-global-hooks` the same
  flag is also set in the user-level `~/.codex/config.toml`.
- **`AGENTS.md`** — `--codex` implies `--agents` (Codex's instruction file).

`uninstall` removes the sweet-search-owned `SessionStart` entry from
`.codex/hooks.json` (deleting the file if it was the only entry); the config-flag
is left in place (harmless, possibly shared).

**To actually run the hook, you must do two things init cannot do for you:**

1. **Enable hooks.** Set `[features] hooks = true` in `config.toml` (init does
   this in the project file by default), or start Codex with `codex --enable
   hooks`. If your Codex only honors the user-level flag, re-run init with
   `--codex-enable-global-hooks` (writes `~/.codex/config.toml`).
2. **Review/trust repo-local hooks.** Run `/hooks` inside Codex to review and
   trust the project's `.codex/hooks.json` before Codex will run it.

> **Status: experimental / best-effort.** Codex hooks are themselves marked
> EXPERIMENTAL (`features.hooks`, available since ~v0.114; the flag was briefly
> named `codex_hooks` and is now deprecated in favor of `hooks` as of v0.132).
> There is also an **open upstream report (openai/codex#17532)** that repo-local
> hook config may not fire in interactive sessions on some versions. This wiring
> is verified at the file/schema level (unit tests) and matches the documented
> hook shape, but has **not** been validated firing inside a live Codex session.
> If it doesn't fire: confirm `[features] hooks = true` is honored (try the
> user-level flag / `codex --enable hooks`), trust the project with `/hooks`,
> check that issue, or fall back to starting the maintainer manually:
> `node <pkg>/core/indexing/index-maintainer.mjs` with `SWEET_SEARCH_PROJECT_ROOT`
> set to the project.

Independent of all the above, the native `sweet-search` CLI still auto-starts the
*search server* on first query (via the Rust CLI's `auto_start_server()`), so
search works under any agent — only the incremental **maintainer** needs the hook
(or a manual start / an open Claude Code session on the same project).

## Architecture

> _Historical design (pre-2026-05). See **Daemon launch (current mechanism)**
> above for how sessions start the server + maintainer today._

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
