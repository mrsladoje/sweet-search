<div align="center">

<img src="assets/sweet-search-banner-pixelated.svg" alt="sweet-search" width="100%" />

### *Maybe grep isn't all you need…*

**A local-first hybrid code-search engine built for AI coding agents.**
Semantic + lexical + structural search over your working tree, GPU-accelerated local inference,
and an evolved system prompt that teaches your agent to use it all — even on plain CPU.

[![npm](https://img.shields.io/npm/v/sweet-search?color=cb3837&label=npm)](https://www.npmjs.com/package/sweet-search)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](package.json)
[![platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](#%EF%B8%8F-platform-support)
[![inference](https://img.shields.io/badge/inference-100%25%20local-success)](#-gpu-accelerated-indexing-fully-local)

</div>

---

Your AI agent burns most of its tokens *looking* for code: grep, read, grep again, read more.
**sweet-search** replaces that loop with six purpose-built tools that return ranked, self-contained answers —
backed by a Rust/WASM engine, ColBERT-style late interaction, a code knowledge graph, and an index that
updates itself as you type.

<div align="center">

**10.2×** ripgrep's median grep speed &nbsp;·&nbsp; **2.9 ms** warm queries &nbsp;·&nbsp; **47×** faster reranking kernels &nbsp;·&nbsp; **0** API keys

<sub>measured in-repo — sources in [Benchmarks](#-benchmarks)</sub>

</div>

## ✨ Highlights

- **Hybrid retrieval** — BM25F lexical + dense semantic + structural graph signals, fused per query by a CatBoost router running in WASM
- **Agent-native by design** — token-budgeted output tiers, an MCP server, and a GEPA-evolved system prompt installed into Claude Code, Codex, Gemini CLI, and Cursor with one command
- **Indexed grep, ~10× ripgrep** — a sparse n-gram prefilter skips the files that provably can't match
- **ColBERT-style reranking, locally** — per-token MaxSim late interaction on hand-written SIMD kernels
- **Runs on anything** — Apple Metal, CUDA, CoreML Neural Engine, or plain CPU via INT8 ONNX; same engine, auto-selected
- **Never stale** — a reconcile daemon keeps the index converged with your *working tree*, uncommitted edits included
- **Fits in RAM** — INT4-quantized binary index segments and memory-mapped HNSW
- **Local-first** — all models run on-device; nothing is sent anywhere, ever

## 📚 Table of Contents

- [Quickstart](#-quickstart)
- [Benchmarks](#-benchmarks)
- [The Six Tools](#-the-six-tools)
- [An Agent Prompt That Was Evolved, Not Written](#-an-agent-prompt-that-was-evolved-not-written)
- [GPU-Accelerated Indexing, Fully Local](#-gpu-accelerated-indexing-fully-local)
- [An Index That Never Goes Stale](#-an-index-that-never-goes-stale)
- [The Native Engine Room](#-the-native-engine-room)
- [The Ranking Stack](#-the-ranking-stack)
- [Works With Your Agent](#-works-with-your-agent)
- [Platform Support](#%EF%B8%8F-platform-support)
- [Prior Art & Acknowledgements](#-prior-art--acknowledgements)
- [License](#-license)

## 🚀 Quickstart

```bash
npm install -g sweet-search

cd your-repo
sweet-search init     # one-time: downloads local models, wires up your agent
sweet-search index    # builds the index — GPU-accelerated where available

sweet-search "where do we validate JWT tokens?"
```

That's it. `init` is idempotent and SHA256-verifies every model binary; re-running it is always safe.
From then on the index maintains itself — edit, save, search.

<details>
<summary><b>Setup options & details</b></summary>

```bash
sweet-search init --wizard          # interactive: shows your hardware, recommends a model tier
sweet-search init --profile core    # lexical-only, no model downloads (CI-friendly)
sweet-search init --li-model edge   # compact late-interaction model for constrained machines
sweet-search uninstall              # clean removal: models, caches, config — never your code
```

- **Requirements:** Node ≥ 18. macOS (arm64/x64) and Linux (x64/arm64) ship native binaries; other platforms fall back to WASM/JS automatically.
- **Footprint:** CPU-only hosts download a few hundred MB of INT8 models; GPU hosts add ~1.2 GB of FP32 backbones (skipped automatically where they'd be useless); M3+ Macs can additionally fetch a ~3.2 GB CoreML cascade for Neural Engine acceleration. Everything lands in `~/.cache/sweet-search/models/` and is used strictly on-device.
- **Agent wiring:** init injects the tool-routing system prompt into `CLAUDE.md` (and `AGENTS.md`, `GEMINI.md`, Cursor rules via flags), registers a session-start prewarm hook so your first query hits a warm daemon, and installs a `/sweet-index` skill in Claude Code.
- **What gets indexed:** what you'd expect — `.gitignore` is respected, `node_modules`/build dirs/minified artifacts are denied, files over 1 MB skipped, with a `.sweet-search-ignore` for extra rules.

</details>

## 📊 Benchmarks

> 🚧 **The headline numbers are still cooking.** A reproducible public benchmark suite — retrieval quality on public code-search datasets, end-to-end agent task evals across model families, and cross-hardware indexing throughput, with methodology, seeds, and reproduction scripts — lands here soon.

What's already measured and written up in-repo:

| What | Result | Source |
|------|--------|--------|
| Indexed grep vs ripgrep | **10.2× faster** at the median (8.5–17.7× across 5 repos, 353 queries, 1 ms p50 — identical match counts on every query) | [`docs/GREP_INDEXING_STRATEGY.md`](docs/GREP_INDEXING_STRATEGY.md) |
| Warm query latency (native CLI) | **2.9 ms** warm · 108 ms cold | [`docs/INIT_STRATEGY.md`](docs/INIT_STRATEGY.md) |
| MaxSim rerank kernels | **1.26 s → 27 ms** for a 231-candidate pass (47× native Rust; 16× WASM SIMD) | [`docs/MAXSIM_OPTIMIZATION.md`](docs/MAXSIM_OPTIMIZATION.md) |
| HNSW tuning for code | **−33%** search p50, **+5.9 pp** recall@200 | [`docs/HNSW_APPROACH.md`](docs/HNSW_APPROACH.md) |
| Indexing memory | peak JS heap **785 MB → 213 MB** | [`docs/DISK_FLUSHING_STRATEGY.md`](docs/DISK_FLUSHING_STRATEGY.md) |
| CoreML cascade (M3 Max) | **18% faster** full indexing vs the Metal baseline | [`docs/INIT_STRATEGY.md`](docs/INIT_STRATEGY.md) |

<sub>Internal measurements on our development corpora; per-doc methodology at the links.</sub>

## 🧰 The Six Tools

Six small tools, one shared index. Each returns ranked, deduplicated, token-budgeted output designed
to be *consumed by an agent* — a useful answer, not a wall of matches to scroll through.

| Tool | What you give it | What you get back |
|------|------------------|-------------------|
| `ss-search` | a natural-language query | ranked, **self-contained code blocks** |
| `ss-grep` | an exact regex/literal | `file:line` hits, **ranked** |
| `ss-find` | a regex **+** a query | regex matches, **semantically re-ranked, as code blocks** |
| `ss-semantic` | a file **+** a question | just the **relevant spans** of that file |
| `ss-trace` | a symbol | **callers + callees + impact**, in one call |
| `ss-read` | a file (± line range) | exact bytes **+ symbol metadata** |

### `ss-search` — the full retrieval stack in one call

```bash
ss-search "how are websocket reconnects handled?" -k 5
```

One query fires the whole pipeline:

1. **CatBoost query router** — a 498-tree gradient-boosted classifier compiled to WASM decides lexical vs hybrid from 50 single-pass features (camelCase/snake_case decomposition, CJK density, path shape…) in microseconds, with a low-confidence reject option that falls back to max-recall hybrid. Real file paths short-circuit straight to lexical.
2. **Dual retrieval** — **BM25F** over field-weighted FTS5 (a hit on a function's *name* outweighs one buried in its body 10:1) runs in parallel with a **three-stage ANN cascade**: binary HNSW (Hamming distance over 64-byte binarized vectors, candidates in ~100 µs) → INT8 rescoring → full-precision float32 rescoring from a memory-mapped sidecar.
3. **Convex-combination fusion** with route-specific weights and quantile normalization — and an automatic **RRF** fallback when score distributions degenerate.
4. **Identifier-Anchored Retrieval (IAR)** — if your English mentions a real symbol, an exact-name lookup against the code graph injects that entity into the pool, even when the encoder ranked something tangential higher.
5. **Intent-aware reranking** — docs/tests/config demoted when you want implementation; log-scaled call-site reference boosts surface the function everyone actually calls.
6. **Adaptive graph expansion** — typed-edge walks (imports / extends / calls / uses) 1–2 hops out along the AST-derived knowledge graph, with intent-selected edge types, PathRAG-style flow-threshold pruning, and degree normalization so hub entities can't dominate.
7. **Late-interaction rerank** — ColBERT-style per-token MaxSim over the quantized token index, on kernels that took a 231-candidate scoring pass from **1.26 s to 27 ms**.
8. **Answer packaging** — near-duplicate siblings collapse to the best-matching member, MMR balances diversity, and entity-aware expansion emits *self-contained* blocks (whole functions with imports, docstrings, decorators) under an auto-selected **3k / 8k / 12k token budget** driven by post-ranking signals like top-1 dominance.

<details>
<summary><b>More</b></summary>

- The expensive 8k/12k tiers are tuned to fire on roughly 1–5% of queries — the default case stays cheap. Force a tier with `--full` / `--xl`, or a mode with `--mode lexical|semantic|hybrid|pattern`.
- Also available as `sweet-search "<query>"` on the CLI and the `search` MCP tool.

</details>

### `ss-grep` — grep, minus every wasted millisecond

```bash
ss-grep "parseRetryAfter" -k 10
```

**10.2× faster than ripgrep end-to-end at the median** — measured across **353 realistic queries on 5 real repos**
(range 8.5–17.7× per repo, 1 ms p50), with **identical match counts on every single query**. Three things buy that:

- **A sparse n-gram index** (inspired by [Cursor's fast-regex-search](https://cursor.com/blog/fast-regex-search) and GitHub's Blackbird): instead of a fixed trigram table, gram boundaries adapt to *your* codebase's character-pair frequencies, so common trigrams get absorbed into longer, more selective grams.
- **Regex-AST literal extraction + SIMD intersection**: required substrings are pulled from the pattern's syntax tree, posting lists are intersected with NEON/SSE2 block merges (galloping search for skewed sizes), and only the files that *can* match — typically 0.1–5% of the corpus — see the real regex.
- **Fully in-process**: verification runs on Rust's regex crate with Rayon across all cores, inside the warm daemon, in a single NAPI call. No child process is ever spawned — zero fork/exec, zero pipe I/O, zero JSON re-parsing.

Hits come back **ranked and scored**, so an agent can trust the top one and stop.

<details>
<summary><b>More</b></summary>

- Full methodology, per-repo table, and the optimization log: [`docs/GREP_INDEXING_STRATEGY.md`](docs/GREP_INDEXING_STRATEGY.md).
- Regexes with no extractable literals fall back to native grep over the indexed file set; fixed-string and glob queries use a ripgrep fallback.

</details>

### `ss-find` — ColGrep, on a faster engine

```bash
ss-find "token refresh logic" --regex "refresh.*[Tt]oken"
```

Inspired by LightOn's [ColGrep](https://github.com/lightonai/next-plaid/tree/main/colgrep) — regex precision,
semantically ranked — but rebuilt on our own substrate:

- The regex stage runs on the **same indexed sparse-gram engine as `ss-grep`** (in-process, no subprocess), not a filesystem scan.
- The ranking stage scores candidates with **per-token MaxSim over pre-indexed late-interaction embeddings** — no model inference over documents at query time — on our custom kernels: native Rust + Rayon takes a 231-candidate MaxSim pass from **1.26 s down to 27 ms** (WASM SIMD fallback at 16×).
- Regex tokens are merged into the semantic query, so the ranking sees both what you typed and what you matched.
- Like `ss-search`, it answers with **ranked, self-contained code snippets** — not bare `file:line` — so the find *and* the read collapse into one tool call. In our 30-question agent-workflow eval that eliminated **every follow-up read** and cut tokens **25.4%** vs a grep + read workflow, at quality parity (gap of 0.01 on a 5-point scale).
- On the 60-query pattern benchmark, MaxSim ranking lifts MRR@10 to **0.45** vs **0.11** for raw grep ordering — 4× more likely the right hit lands on top.

<details>
<summary><b>More</b></summary>

- Requires the late-interaction index (built by default; `--li-model none` disables pattern mode).
- Also available as `sweet-search --mode pattern` and via the `search` MCP tool's `regex` argument.

</details>

### `ss-semantic` — hybrid retrieval, scoped to one file

```bash
ss-semantic src/auth/session.ts "where does the cookie get its expiry?"
```

You know the file; this finds the lines. Every indexed chunk of the file is scored by **three independent
signals** — BM25-style lexical term match, exact symbol-name match (weighted 1.5×), and ColBERT-style
MaxSim over late-interaction token embeddings — fused with **Reciprocal Rank Fusion** (k=60), with
symbol-less fragment chunks demoted 0.85× so real definitions win ties. The top spans are then
**re-read from disk** (±2 context lines, overlapping spans merged), so the answer is filesystem ground
truth even mid-edit; if the file is newer than its index entry you get an explicit staleness warning.

The useful answer: just the relevant spans with line numbers — not the whole file through your context window.

<details>
<summary><b>More</b></summary>

- Unindexed files degrade gracefully to a plain read. Defaults: top 5 spans, relevance threshold 0.4, 8k-char cap.
- Also available as `sweet-search read-semantic` and the `read-semantic` MCP tool.

</details>

### `ss-trace` — graph algorithms, not grep guesswork

```bash
ss-trace processOrder --in src/orders/service.py
```

One call returns a symbol's **callers, callees, and transitive impact paths** from the AST-derived code
graph (entities + typed `calls`/`imports`/`extends`/`uses` edges, persisted in SQLite at index time).
Ranking fuses three signals:

- **Query-time Personalized PageRank** via Forward Push — a *local* algorithm that spreads mass directionally from your target symbol and touches only the neighborhood it reaches, never the whole graph;
- **Index-time edge-weighted global PageRank** (damping 0.85), precomputed into a `page_rank` column — a function called from five sites carries five units of mass, and it costs *zero* at query time;
- **Structural heuristics** — relationship type, depth, exported-API status, fan-in — with penalties for test-only and external paths.

Because the graph is prebuilt, the global ranking is precomputed, and the personalized walk is local,
a full three-section trace costs milliseconds. The relation word (`callers` / `callees` / `impact`)
re-weights how the response token budget is split; `--in` disambiguates duplicate names; `--depth`
bounds impact traversal (1–4).

<details>
<summary><b>More</b></summary>

- Honest caveat: call-graph extraction is precise but incomplete on highly dynamic code (bare-name dispatch, metaprogramming) — traces can be sparse there, and the agent prompt teaches a recovery strategy for exactly that case.
- Also available as `sweet-search trace` and the `trace` MCP tool.

</details>

### `ss-read` — exact bytes, with the index's knowledge attached

```bash
ss-read src/db/pool.js 120 180
```

A read tool that is **filesystem-grounded by construction**: bytes come straight from disk (never from
the index, so never stale), but each indexed file arrives annotated with its **cAST chunk metadata** —
symbol name, entity type, signature, line span — joined from the AST chunk index. The agent gets the
code *and* the structural map of what it's looking at in one call: cite, navigate, or trace next
without another search.

<details>
<summary><b>More</b></summary>

- The CLI/MCP form scales it up: `sweet-search read <file...>` (and the `read` MCP tool) batches **1–20 files in a single call**, each with the same symbol metadata — twenty files for the price of one tool invocation.

</details>

> The `ss-*` wrappers ship in the npm package and are what the installed agent prompt drives. Every
> capability is equally available as `sweet-search` CLI subcommands and as MCP tools — see
> [Works With Your Agent](#-works-with-your-agent).

## 🧠 An Agent Prompt That Was Evolved, Not Written

Giving an agent six tools is easy. Getting it to *stop grepping in circles* is not.

`sweet-search init` installs a ~1k-token system prompt that encodes a complete search discipline —
and it wasn't hand-written. It was **evolved with a GEPA-style optimization loop**: reflective mutation
by one model family, scored on a dual Pareto front (accuracy × cost) across two *different* production
targets, then validated on held-out probes and on **model families that were never part of the
optimization**, and finally hand-hardened with a correctness editing pass.

What it teaches:

- **Cheapest tool first** — hold an exact identifier? One `ss-grep`, trust the top hit, stop. No semantic search "just to confirm."
- **Trust the ranking** — confirm with at most one narrow read, never a re-run of a hit that already matched.
- **Absence is an answer** — two complementary empty probes (one semantic, one lexical) settle a negative; no third synonym, no `find`/`ls` spiral.
- **No raw-shell escape** — the #1 token-waster we found in trajectory analysis is agents abandoning the index for dozens of raw `grep`/`find` calls after one empty result. The prompt closes that door explicitly.
- **A reasoning checkpoint** — before a third probe, the agent must state what it has established and what its blind spot is.

<details>
<summary><b>How it was validated</b></summary>

- **Optimization targets:** two frontier model families in production harnesses (Claude Code and Codex-style CLIs), scored jointly so the prompt can't overfit to one model's quirks.
- **Selection:** dual Pareto fronts over per-probe accuracy and measured cost; candidates gated by paraphrase-invariance (the prompt's behavior must survive rewording).
- **Held-out discipline:** a dev probe set for iteration, a held-out set checked only at milestones, and a sealed vault set opened exactly once. Joint maximin on held-out: **0.988**; out-of-distribution probes: **0.95+**; vault: **0.963** — 2.5 pp below held-out, well inside the pre-registered 15% acceptance gate.
- **Held-out model families (HOMP):** the final prompt passed on two model families from different vendors that were never used during evolution — evidence the routing rules generalize, not memorize.
- All figures are from the in-repo evaluation program (internal probe suites; see [`docs/PHASE7.md`](docs/PHASE7.md)); the benchmark suite that will make these externally reproducible is in progress.
- Installation is idempotent and marker-delimited: re-running `init` updates the managed block in `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursor/rules` without touching anything else you wrote.

</details>

## ⚡ GPU-Accelerated Indexing, Fully Local

All inference is on-device, in Rust, via [candle](https://github.com/huggingface/candle) — with the
attention path swapped for **fused kernels tuned per backend**, and an honest CPU story for machines
with no accelerator at all.

| Your hardware | What runs |
|---------------|-----------|
| Apple Silicon (M1+) | candle **Metal**, BF16, fused SDPA attention |
| Apple Silicon (M3+) | … plus a **CoreML Neural Engine cascade** (~18% faster full indexing, measured on M3 Max) |
| NVIDIA GPU (SM 7.0+) | candle **CUDA**; **flash-attention** on Ampere+ |
| Anything else | **ONNX Runtime INT8** — optimized CPU path, ~139 MB embedding model, no GPU weights downloaded |

<details>
<summary><b>What's actually custom here</b></summary>

- **Surgical attention swap:** we vendor the upstream model implementations (NomicBERT for embeddings, ModernBERT for late interaction) and replace only the attention forward pass — an MLX-ported fused SDPA kernel on Metal, `candle-flash-attn` with varlen packing on CUDA Ampere+, and byte-for-byte upstream math on CPU so the fallback is provably identical.
- **A silent-NaN bug, found and fixed:** Apple's Metal SDPA kernel downcasts attention masks to F16, which saturates the standard `f32::MIN` mask to `-Inf` and quietly produces NaN on padded rows — collapsing retrieval quality. We clamp the mask and serialize Metal command-buffer submissions (concurrent submission corrupts outputs on shared queues). Details in [`crates/sweet-search-native/src/inference/`](crates/sweet-search-native/src/inference/).
- **CoreML cascade:** 18 pre-traced `.mlpackage` variants (bucketed by sequence length) dispatched to the Apple Neural Engine through an Objective-C shim; oversized batches fall through to Metal. Gated to M3+ because on M1/M2 the ANE doesn't beat its own compile overhead — we measured, so it's off there.
- **GPU off the event loop:** inference runs as napi `AsyncTask` on libuv worker threads, so tokenization and SQLite writes overlap GPU compute instead of stalling behind it.
- **Pipelined indexing:** while batch *N+1* embeds, batch *N*'s vectors stream into SQLite through zero-copy buffer views; full rebuilds write to a temp file and atomically swap, so a crash never leaves you serving half an index.
- **Models:** CodeRankEmbed (768-d, code-specialized) for embeddings; LateOn-Code (ModernBERT) for per-token late interaction, in a full-fidelity `standard` and a compact `edge` variant (~9× smaller FP32 backbone; ~2× smaller on the INT8 CPU path).
- **AST-aware chunking:** files are parsed with real tree-sitter grammars (14 languages) and split by a cAST-style recursive merge — whole functions and classes, never a function sliced in half — with a 39-config regex fallback covering 70+ file extensions beyond those.

</details>

## 🔄 An Index That Never Goes Stale

Most code indexes rot the moment you start typing. sweet-search ships a **reconcile daemon** that
keeps every tier of the index converged with your **working tree** — uncommitted edits included —
without you ever running a command.

- **Save → searchable** at the next reconcile tick — auto-tuned per machine between 15 s and 300 s, typically 15–60 s on a warm, idle box
- **Tracks the filesystem, not git** — unstaged and uncommitted changes are first-class; deleted or newly-gitignored files disappear from results automatically
- **Atomic by construction** — every tick publishes all five index tiers (float HNSW, binary HNSW, late-interaction segments, sparse-gram, code graph) through a single fsync-renamed epoch manifest, so a query never sees a half-updated index
- **No-op edits cost almost nothing** — content hashing collapses byte-identical rewrites and editor touch events into skipped re-encoding work

<details>
<summary><b>Deep dive</b></summary>

- **Baseline gate:** the daemon never plays first-index-builder. It verifies a full-indexer fingerprint (epoch manifest + merkle config fingerprint + the vectors DB it names) before touching anything, and reports `waiting_for_initial_index` otherwise — no corrupted partial baselines.
- **One admission policy:** the full indexer and the reconciler share a single `createAdmissionPolicy` module (include globs → deny list → `.sweet-search-ignore` → 1 MB size cap → batched `git check-ignore`), so the two paths cannot drift.
- **Orphan sweep:** files that are deleted, newly excluded, or newly oversized get tombstoned across every tier; the index converges to exactly what a fresh full rebuild would produce.
- **Self-maintenance:** per-tier health watermarks (tombstone fraction, stale-doc ratio, delta ratio) schedule low-priority background compaction in a separate worker — the index stays fast over months without a manual rebuild.
- **Worktree-safe:** a worktree stamp plus a single-writer lockfile prevent two daemons from silently interleaving index histories across git worktrees.
- **Resource-polite:** ticks are budgeted (≤50 files / ≤2 s CPU per tick), run CPU-only (the GPU is reserved for cold full indexing), and the interval auto-tunes from load average, churn, and backlog.
- `sweet-search reconcile status` / `reconcile inspect <path>` explain exactly what the daemon thinks and why. Opt out any time with `SWEET_SEARCH_RECONCILE_V2=0`.

</details>

## 🦀 The Native Engine Room

Four Rust crates do the heavy lifting, each with a graceful fallback so the engine runs everywhere:

| Crate | What it does |
|-------|--------------|
| `sweet-search-native` | candle GPU/CPU inference, sparse-gram grep engine, SIMD posting-list intersection, SimHash/MinHash-LSH dedup, HuggingFace tokenizers — all over zero-copy NAPI |
| `wasm-maxsim` | a hand-written WASM SIMD kernel computing ColBERT MaxSim in ~4 KB (~1.6 KB gzipped), with fused INT8 dequantization inside the SIMD pipeline plus a 4-bit nibble-packed path |
| `wasm-router` | the 498-tree CatBoost query router, loop-unrolled, zero-allocation |
| `sweet-search-cli` | a native CLI that talks to a warm search daemon over a per-project Unix socket — **2.9 ms** measured warm-path queries |

<details>
<summary><b>Deep dive</b></summary>

- **MaxSim, three speeds:** scoring auto-selects the best available tier — native Rust + Rayon across all cores (**47×** vs baseline JS in our microbenchmark), portable WASM SIMD (**16×**), or a norm-cached pure-JS fallback (3.5×). Equivalent rankings, any platform.
- **SIMD set intersection:** posting-list intersection dispatches per-pair — galloping search when one list is ≥8× smaller, 4-wide NEON/SSE2 block merges for balanced lists, scalar merge for small ones — following the Lemire/Clausecker line of work.
- **Dedup at index time:** near-duplicate chunks are fingerprinted (64-bit SimHash + 128-permutation MinHash), clustered with banded LSH + union-find, then *re-validated pairwise* against the exemplar so transitive weak links can't glue unrelated clusters together. Duplicates skip embedding entirely — and at query time the best-matching *sibling* can take the exemplar's slot, so collapsing copies never hides the right answer.
- **Per-project warm daemon:** the CLI derives an isolated socket path from an FNV-1a hash of the project root, auto-starts the server on first use, and falls back to pure JS where no native binary exists (measured: 2.9 ms warm / 108 ms cold / 64.7 ms JS fallback).
- **Native tokenization:** the official HuggingFace `tokenizers` crate over NAPI — batched, cached, no Python anywhere in the stack.

</details>

### 🗜️ TurboQuant: an index that fits in RAM

A 17k-document codebase's late-interaction index weighed **1.34 GiB** as JSON-encoded INT8. The binary
segment format cut the same index to **~396 MiB** (3.4× of pure ASCII bloat, gone) — and the INT4
default packs token vectors at half a byte each on top of that. Laptop-sized, fully in RAM.

<details>
<summary><b>Deep dive</b></summary>

- **INT4 by default:** per-token min/scale quantization with nibble packing (two values per byte), A/B-tested against the INT8 baseline with no meaningful retrieval regression before becoming the default.
- **SSLX binary segments:** the index persists as ~10k-document binary segment files with structured headers and CRC32 footers — a crash costs you at most one segment, not the index.
- **Three-stage retrieval:** a binary HNSW (Hamming distance over 64-byte binarized vectors, ~32× smaller than float HNSW) produces candidates in ~100 µs, INT8 rescoring narrows them, and a float32 sidecar rescores the final pool — speed without giving up top-result quality.
- **Memory-mapped HNSW:** the float graph index loads via `mmap` (USearch `view()`), contributing **0 MB** to the V8 heap at search time; the OS reclaims pages under pressure.
- **Streaming indexer:** vectors stream from SQLite cursors instead of materializing in arrays — peak JS heap during indexing dropped from ~785 MB to ~213 MB, with 30-second fsync-ordered checkpoints bounding crash loss. The OOM cliff that used to appear above ~200k chunks is gone; large repos index comfortably on an 8 GB machine.
- Tuned HNSW parameters and zero-GC search internals (typed-array heaps, generation-stamped visited lists) cut search p50 by 33% while *raising* recall@200 by 5.9 pp in our internal evaluation ([`docs/HNSW_APPROACH.md`](docs/HNSW_APPROACH.md)).

</details>

## 🎯 The Ranking Stack

Retrieval quality comes from *layers*, each one cheap, each one earning its place:

1. **Route** — CatBoost classifies the query (lexical / semantic / hybrid) and sets fusion weights; real file paths short-circuit straight to lexical
2. **Retrieve** — BM25F field-weighted lexical (a match on a function's *name* outranks one buried in a body) in parallel with the three-stage vector pipeline
3. **Fuse** — convex combination with per-route weights and quantile normalization, falling back to Reciprocal Rank Fusion on degenerate score distributions
4. **Anchor** — name a real symbol in your query and identifier-anchored retrieval injects the exact-name entity, even when the encoder ranked something tangential higher
5. **Rerank** — ColBERT-style MaxSim late interaction over the quantized token index
6. **Expand** — typed-edge graph walks (1–2 hops, intent-adaptive, PathRAG-style flow pruning) pull in the related code a single chunk can't show
7. **Polish** — intent-aware demotion of docs/tests/config when you want implementation, call-site reference boosts, MMR diversity, near-duplicate sibling re-ranking

<details>
<summary><b>Deep dive & design honesty</b></summary>

- **Intent awareness:** a lightweight classifier distinguishes "fix this crash" from "how do I use this API" and tunes graph-edge selection, result limits, and chunk-type preferences per intent.
- **Quality priors:** each chunk carries a 0–1 prior from test proximity, git recency, symbol centrality (PageRank), comment density, and complexity — production code surfaces, stale fixtures sink.
- **Community structure:** a canonical Leiden algorithm detects code communities on the entity graph at index time, feeding vocabulary prewarming and structural signals — the engine understands your modules, not just your directories.
- **Multilingual:** 14 languages get full tree-sitter AST treatment; a 39-config registry covers 70+ extensions beyond that; router features handle camelCase/snake_case decomposition, CJK density, and German compounds.
- **Long-query rescue:** wordy natural-language queries that FTS5 would tokenize into an unsatisfiable AND get a multi-query BM25F + RRF fallback — one query per content keyword, fused.
- **A negative result we ship anyway:** we built a full cross-encoder rerank cascade behind an adaptive confidence gate, measured it on our evaluation sets — and it didn't beat MaxSim at 3× the latency. So it ships **disabled** (`SWEET_SEARCH_CASCADE_ENABLED=true` if you want to try). We'd rather ship the faster path than a fancier diagram.

</details>

## 🔌 Works With Your Agent

sweet-search meets your agent wherever it is — shell tools, MCP, or injected instructions:

```jsonc
// .claude/mcp.json — that's the whole integration
{
  "mcpServers": {
    "sweet-search": {
      "command": "npx",
      "args": ["sweet-search-mcp", "--project-root", "/absolute/path/to/your/repo"]
    }
  }
}
```

- **MCP server** — 8 tools (`search`, `trace`, `read`, `read-semantic`, `index`, `health`, `repo-map`, `vocab-prewarm`), 2 resources, 2 prompts; all search tools declared read-only and idempotent
- **Harness injection** — `init` writes the evolved system prompt into Claude Code, Codex (`--codex`, including session hooks), Gemini CLI (`--gemini`), and Cursor (`--cursor`) from one canonical source
- **Repo maps for sub-agents** — the `repo-map` tool returns a PageRank-ranked symbol overview squeezed into any token budget, perfect for briefing a delegated agent
- **Warm from the first query** — a SessionStart hook pre-launches the search daemon so models, vocabulary, and indexes are loaded before you ask anything

<details>
<summary><b>Deep dive</b></summary>

- **Tool routing enforcement (opt-in):** `init --enforce-tools` denies the native Grep tool in Claude Code and installs a hint hook nudging native Read toward `ss-read`/`ss-semantic` — for when you want the discipline guaranteed, not suggested.
- **`/sweet-index` skill:** a Claude Code slash command for a full GPU-aware reindex, installed by init.
- **Vocabulary prewarm:** `sweet-search prewarm-vocab` mines your repo's real identifiers, detects code communities (Leiden), and pre-warms all three search modes so even the first semantic query of a session is cache-warm.
- **Honest committed-state:** init never writes machine-specific absolute paths into committed settings files, and all instruction injection is marker-delimited and reversible.

</details>

## 🖥️ Platform Support

| Platform | Engine | Acceleration |
|----------|--------|--------------|
| macOS arm64 (Apple Silicon) | native | Metal (M1+) · CoreML Neural Engine (M3+) |
| macOS x64 (Intel) | native | ONNX Runtime INT8 CPU |
| Linux x64 (glibc) | native | CUDA (SM 7.0+, flash-attn on Ampere+) or INT8 CPU |
| Linux arm64 (glibc) | native | CUDA (Jetson Orin / Grace) or INT8 CPU |
| Windows | — | via WSL2 (= Linux x64) |
| Everything else | WASM/JS fallback | runs everywhere Node ≥ 18 runs |

Native binaries are selected automatically at `npm install` time via optionalDependencies — no flags, no postinstall scripts to debug. Every native fast path has a WASM or JS fallback that produces the same results.

## 🙏 Prior Art & Acknowledgements

sweet-search stands on a lot of shoulders, and we'd rather name them than pretend otherwise:

- **[ColBERT](https://arxiv.org/abs/2004.12832)** (Khattab & Zaharia) — late interaction; **[LightOn](https://huggingface.co/lightonai)** for the LateOn-Code models and the ColGrep concept our pattern mode parallels
- **[ripgrep](https://github.com/BurntSushi/ripgrep)** (BurntSushi) — the bar for grep, and our verification baseline
- **GitHub's [Blackbird](https://github.blog/engineering/the-technology-behind-githubs-new-code-search/)** — the sparse n-gram indexing idea we tuned per-codebase
- **[candle](https://github.com/huggingface/candle)** & **[MLX](https://github.com/ml-explore/mlx)** — Rust ML and the fused SDPA kernels we build on; **[HuggingFace tokenizers](https://github.com/huggingface/tokenizers)**
- **[Aider](https://github.com/Aider-AI/aider)** — the repo-map idea, here rebuilt on a real knowledge graph
- **[USearch](https://github.com/unum-cloud/usearch)** — memory-mapped HNSW; **Malkov & Yashunin** for [HNSW](https://arxiv.org/abs/1603.09320) itself
- **[CatBoost](https://catboost.ai/)** — the query router model; **Traag et al.** for the [Leiden algorithm](https://arxiv.org/abs/1810.08473); **Cormack et al.** for RRF; **[PathRAG](https://arxiv.org/abs/2502.14902)** for flow-pruned graph expansion; **[cAST](https://arxiv.org/abs/2506.15655)** for structure-aware chunking
- **[GEPA](https://arxiv.org/abs/2507.19457)** — the reflective evolutionary prompt-optimization paradigm behind our agent prompt
- **[nomic-ai](https://huggingface.co/nomic-ai)** — the CodeRankEmbed embedding model

## 📄 License

[Apache-2.0](LICENSE) © [PanonIT](https://panonit.com)

---

<div align="center">

**If sweet-search saves your agent's tokens, a ⭐ helps other agents' humans find it.**

</div>
