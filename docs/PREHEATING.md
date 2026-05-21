# Session Preheating

> **HCGS Status (2026-05)**: HCGS is disabled by default (`HCGS_CONFIG.enabled = false`); references below describe the original design. Flip the flag to re-enable.

Session preheating eliminates cold-start latency by warming caches, TLS connections, and ML model runtimes before the first user query arrives. It runs automatically at the start of every Claude Code session via a Claude Code SessionStart hook (`core/search/session-daemon-prewarm.mjs`).

## Daemon launch (current mechanism)

### Startup layers — what actually guarantees freshness

Default-on incremental indexing must not depend on any one editor's hooks. There
are three layers that can start the maintainer, all routing through one shared,
idempotent launcher (`core/indexing/maintainer-launcher.mjs`):

1. **Core warm search-server first-use — the durable guarantee.** Every normal
   `sweet-search` use goes through the warm search server (the native CLI
   auto-starts it on first query via `auto_start_server()`). `startServer()`
   calls the shared launcher once at startup, so the default-on reconcile
   maintainer starts on first use **regardless of Claude / Codex / MCP**. This is
   the layer you can rely on. It starts the daemon detached and returns — it does
   **not** run a blocking reconcile tick (the maintainer runs its own first tick
   at t=0 in its own process; blocking the first query on indexing would add
   latency and risk flakiness).
2. **Claude / Codex SessionStart hooks — best-effort prewarm/convenience.** They
   call the same launcher so the maintainer is already warming while you read the
   first reply. They are *not* the hard guarantee: Codex hooks are interactive
   only, require `[features] hooks = true` + `/hooks` trust, and **`codex exec`
   does not fire SessionStart**. See "Codex CLI" below.
3. **MCP server startup — optional.** If (and only if) MCP is enabled/configured,
   its startup calls the same launcher too. MCP is never installed or required
   for incremental indexing.

All three are idempotent and lock-guarded: the maintainer's own `O_EXCL`
`index-maintainer.lock` is the hard no-duplicate guarantee, so calling the
launcher from several layers (or repeatedly) never starts a second maintainer.

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

All three startup layers above call the one shared launcher
(`core/indexing/maintainer-launcher.mjs` → `launchMaintainer()`), which spawns it
detached unless any of these hold:

- **Opt-out** — `SWEET_SEARCH_RECONCILE_V2` is `0`, `false`, or `off`.
- **No index yet** — the project has no `.sweet-search/` state dir (nothing to
  maintain; run `sweet-search index` first).
- **Already running** — a live `index-maintainer.lock` is held in the state dir.
- **Entry missing** — the maintainer module isn't present.

The launcher pins `SWEET_SEARCH_PROJECT_ROOT` to the resolved project root so the
package copy targets the right project (its `PROJECT_ROOT` would otherwise
resolve to the package root). It is stdout-clean (stderr only, and only when
verbose) so machine-readable commands stay parseable, and it returns fast.
Single-instance is guaranteed two ways: the launcher skips when a live lock
exists, and the daemon itself takes an `O_EXCL` `index-maintainer.lock` on
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
--codex` is the **complete normal setup** — one command, no extra flags. It wires
the Codex equivalent, reusing the same `session-daemon-prewarm.mjs` launcher (it's
harness-agnostic — reads only env/cwd, writes nothing to stdout):

- **`.codex/hooks.json`** — a `SessionStart` hook (`matcher: "startup|resume"`)
  whose command is git-root anchored:
  `cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && node <relpath>`.
  Codex runs hook commands with the *session* cwd (which may be a subdirectory),
  so a bare relative path is unreliable — anchoring to the git root fixes both
  path resolution and the launcher's own project-root detection without writing
  a machine-specific absolute path into the (often committed) file.
- **`[features] hooks = true`** in the project `.codex/config.toml` — the
  canonical feature flag (hooks are a **stable**, current-Codex feature, v0.132+).
  `init --codex` enables it for the project itself via a comment-preserving,
  append-if-absent edit (no TOML round-trip), so you do **not** need a separate
  enable step. A deprecated `codex_hooks` flag from an older Codex / older
  sweet-search is **migrated** to `hooks` in place (Codex now warns on
  `codex_hooks`). The user-level `~/.codex/config.toml` is left untouched unless
  you pass the legacy/advanced `--codex-enable-global-hooks` (not required for
  normal setup).
- **`AGENTS.md`** — `--codex` implies `--agents` (Codex's instruction file).
- **MCP is not touched.** `init --codex` never writes `.mcp.json`; MCP stays
  optional and unrelated to default incremental indexing.

`uninstall` removes the sweet-search-owned `SessionStart` entry from
`.codex/hooks.json` (deleting the file if it was the only entry); the config-flag
is left in place (harmless, possibly shared).

**The only manual step `init --codex` can't do for you is project trust:**

- **Review/trust repo-local hooks.** Run `/hooks` inside Codex to review and
  trust the project's `.codex/hooks.json` before Codex will run it. (If you ever
  need to toggle the feature itself, `codex --enable hooks` does that — but
  `init --codex` already sets `[features] hooks = true` in the project config, so
  the normal path doesn't need it.)

Even if you skip the `/hooks` trust step, **default index freshness is still
guaranteed** — it does not live in the Codex hook. The core warm search-server
first-use launcher (see "Startup layers" above) starts the incremental maintainer
on first `sweet-search` use under any agent, Codex included. The Codex hook is
purely an early prewarm convenience.

> **Status: best-effort convenience layer — NOT the freshness guarantee.** Live
> validation against Codex CLI **v0.132** found the Codex hook path too fragile to
> rely on:
> - `hooks` is a **stable** feature in 0.132 (`codex features list` → `hooks
>   stable true`); the older `codex_hooks` is deprecated and warns.
> - Hook **trust is persisted** in `~/.codex/config.toml` under `[hooks.state]`,
>   keyed by the hooks.json **absolute path + content hash** — so editing the
>   hook (e.g. re-running init) invalidates trust and re-requires `/hooks`.
> - **`codex exec` (non-interactive) does NOT fire SessionStart hooks** — a
>   `--json` run emits no `session_start` event. SessionStart is interactive-only.
> - Interactive firing additionally needs `/hooks` review/trust (or the
>   per-invocation `--dangerously-bypass-hook-trust`).
>
> Because of all that, **the maintainer's freshness guarantee does not live in
> Codex hooks** — it lives in the core warm search-server first-use startup (see
> "Startup layers" above), which runs regardless of editor. The Codex hook is
> kept only as an extra prewarm convenience for interactive Codex sessions.

Independent of all the above, the native `sweet-search` CLI auto-starts the
*search server* on first query (via the Rust CLI's `auto_start_server()`), and
that server startup now also starts the default-on maintainer through the shared
launcher — so under **any** agent (Codex included), normal search use keeps the
index fresh without depending on hooks or MCP.

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
