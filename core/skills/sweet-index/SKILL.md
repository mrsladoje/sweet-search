---
name: sweet-index
description: "Use when (re)indexing a Sweet Search project. Runs the full-profile indexer with GPU model prewarming (CoreML cascade on M3+, candle Metal on M1/M2, ORT CPU elsewhere), kills ORT CPU models during indexing to avoid memory contention, and rewarms them for query readiness on completion. Incremental runs under 20 files stay on ORT CPU."
category: developer-tooling
priority: high
tokenEstimate: 600
agents: []
implementation_status: active
optimization_version: 1.0
last_optimized: 2026-04-17
dependencies: [sweet-search]
quick_reference_card: true
tags: [indexing, embeddings, late-interaction, gpu, coreml, metal, ort, prewarming, sweet-search]
trust_tier: 1
---

# /sweet-index — Index the Codebase

<default_to_action>
When the user invokes `/sweet-index`, run the full-profile indexing command
immediately. Do not ask clarifying questions — the indexer is idempotent, safe
to re-run, and handles incremental vs full reindex automatically.
</default_to_action>

## What this does

Runs `core/indexing/index-codebase-v21.js` with the `--full` flag so every
artifact is rebuilt from scratch. The indexer itself manages the model
lifecycle end-to-end:

1. **Kill resident ORT CPU models** — prevents memory contention and mutex
   fighting with the GPU models about to be loaded.
2. **Detect best backend** via `hardware-capability.js` —
   `coreml-cascade` on M3+ Apple Silicon, `candle-metal` on M1/M2,
   `candle-cuda` on Linux + NVIDIA, and the optimized **ORT INT8 CPU** path
   on any host with no usable accelerator (no GPU models are loaded there).
3. **Load GPU models + warmup forward pass** (accelerator hosts only) —
   compiles Metal pipelines, CoreML variant bundles, and BLAS thread pools
   so the first indexing batch pays no cold-start cost.
4. **Index the codebase** — code graph, vector embeddings, HNSW,
   late-interaction index, quantized artifacts, sparse-gram index.
5. **Kill GPU models** — releases Metal queues and Neural Engine.
6. **Load + warmup ORT CPU models** — both embedding and LI get one dummy
   forward pass so the first query after indexing is warm.

On small-changeset incremental runs (under 20 files) — and on any host with
no usable accelerator — the indexer skips the GPU swap entirely and indexes on
the optimized ORT INT8 CPU path.

## Usage

```bash
node core/indexing/index-codebase-v21.js --full
```

Or via npm script:

```bash
npm run index:full
```

## What to report

After the command completes, pick out these lines from stderr:

- `GPU index pool armed (<backend>)` → confirms which backend was used
- `embed=<load>+<warm>ms, li=<load>+<warm>ms` → prewarm timings
- `CPU models warmed for queries: load=…ms, warm=…ms (embed=ok, li=ok)` →
  confirms ORT CPU is armed for subsequent searches
- `INDEXING COMPLETE (FULL)` with `Duration`, `Files indexed`, `Entities`,
  `Relationships` → headline stats

## Flags (full list)

| Flag | Purpose |
|------|---------|
| `--full` | Full reindex — rebuild everything. Always armed via this skill. |
| `--no-late-interaction` | Skip LI index (faster, lower quality). Rarely wanted. |
| `--late-interaction-pool=N` | Token pooling factor (2 halves tokens). |
| `--vectors-only` | Skip code graph — breaks GraphRAG. Avoid. |
| `--graph-only` | Only build code graph, skip vectors. |
| `--verbose` / `-v` | Force per-phase progress output. |

Do **not** pass `--sqlite-fast` — it disables fsync between phases and is
only safe for benchmarking on throwaway state.

## When not to use

- **Single-file edits**: the indexer auto-detects small changesets and stays
  on CPU, so `/sweet-index` is still safe, but a watcher-triggered
  incremental run is cheaper.
- **Queries feel slow**: usually means the ORT CPU models are not loaded.
  Run `/sweet-index` once to rewarm them, or restart the sweet-search
  server.
