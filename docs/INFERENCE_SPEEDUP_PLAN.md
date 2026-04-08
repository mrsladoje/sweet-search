# Inference Speedup Plan

**Date:** 2026-04-08
**Status:** Proposed
**Scope:** Maximize local ONNX inference throughput during indexing on macOS Apple Silicon, Linux x86_64, and WSL2.

This plan covers only the forward-pass work that produces:
- dense embedding vectors for retrieval
- late-interaction token vectors for MaxSim

It does **not** cover:
- search-serving concurrency: see [`PARALLEL_SESSIONS_BUG_PLAN.md`](/Users/admin/Projects/sweet-search-private/docs/PARALLEL_SESSIONS_BUG_PLAN.md)
- binary HNSW / stage-1 retrieval tuning: see [`HNSW_APPROACH.md`](/Users/admin/Projects/sweet-search-private/docs/HNSW_APPROACH.md)
- late-interaction storage and scoring compression: see [`LI_QUANTIZATION_STRATEGY.md`](/Users/admin/Projects/sweet-search-private/docs/LI_QUANTIZATION_STRATEGY.md)
- model-backbone swaps: keep as a separate evaluation track

---

## Current Repo Facts

### Canonical runtime paths

- Embedding model runtime: [`core/embedding/embedding-local-model.js`](/Users/admin/Projects/sweet-search-private/core/embedding/embedding-local-model.js)
- Late-interaction runtime: [`core/ranking/late-interaction-model.js`](/Users/admin/Projects/sweet-search-private/core/ranking/late-interaction-model.js)
- Shared ORT session helpers: [`core/infrastructure/onnx-session-utils.js`](/Users/admin/Projects/sweet-search-private/core/infrastructure/onnx-session-utils.js)
- CoreML provider config: [`core/infrastructure/coreml-provider.js`](/Users/admin/Projects/sweet-search-private/core/infrastructure/coreml-provider.js)
- Indexing orchestration: [`core/indexing/indexer-phases.js`](/Users/admin/Projects/sweet-search-private/core/indexing/indexer-phases.js)
- HNSW / LI build phases: [`core/indexing/indexer-ann.js`](/Users/admin/Projects/sweet-search-private/core/indexing/indexer-ann.js)
- Search warmup coordinator: [`core/search/session-warmup.js`](/Users/admin/Projects/sweet-search-private/core/search/session-warmup.js)

### Current model sizes

Use the managed registry as ground truth:

| Model | Registry Key | ONNX File | Size | Notes |
|------|------|------|------|------|
| CodeRankEmbed INT8 | `coderankembed-int8` | `onnx/model.onnx` | 138.6 MB | 768d embedding output |
| LateOn-Code INT8 | `lateon-code` | `model_int8.onnx` | 150.0 MB | ModernBERT backbone, 128d projected token output |

Important correction: LateOn-Code is **not** a ~600 MB INT8 runtime artifact in the current repo. Worker-pool RAM budgeting must use the real 150 MB model file plus runtime overhead.

### Current architectural state

- Embedding inference already uses a **direct ORT session**, not a HuggingFace pipeline wrapper.
- Optimized graph materialization is already attempted via `optimizedModelFilePath`.
- The indexer already overlaps **vector indexing** and **late-interaction encoding** at the stage level when the platform profile allows it.
- Binary HNSW is already implemented and benchmarked elsewhere. This document should not treat binary retrieval as a missing future idea.
- LateOn-Code currently runs on CPU by design. CoreML is intentionally avoided for LI because prior benchmarking showed severe regression from partial graph partitioning.

---

## Problem Statement

Indexing large repositories is still dominated by repeated ORT `session.run()` calls:

1. Embedding batches are executed through a single session per process.
2. Late-interaction batches are executed through a single session per process.
3. Session configuration is still tuned conservatively rather than benchmarked for current ORT and current hardware.
4. Batch sizing and memory guards were tuned for the single-session path.
5. The existing phase-level parallelism does not yet coordinate CPU budgets with any future per-model worker pools.

The goal is not to chase abstract SOTA claims. The goal is to make the current local models run as fast as possible in this codebase with measurable wins and bounded risk.

---

## Design Principles

1. Benchmark the current repo, not generic papers.
2. Respect bounded contexts: new indexing helpers live under `core/indexing/`.
3. Keep the search-serving path unchanged.
4. Coordinate resources globally across embedding and LI work.
5. Prefer low-risk runtime wins before risky quantization or model changes.
6. Do not assume CoreML, INT4, or Olive help until measured on this repo.

---

## Benchmark Protocol

The old plan referenced commands and scripts that do not exist anymore. Use the current tooling.

### Primary benchmark

Use the current indexing harness or direct full-index runs:

```bash
# Full-index benchmark harness
node scripts/benchmark-harness.js --full-index

# Direct baseline runs when deeper instrumentation is needed
node core/indexing/index-codebase-v21.js --full --quiet
node core/indexing/index-codebase-v21.js --full --quiet --sqlite-fast
```

### Result storage

Benchmark artifacts should live under:

```text
.claude/benchmarks/results/
```

Do not reference a nonexistent `benchmarks/` directory.

### Metrics

Every phase should collect:

| Metric | Notes |
|------|------|
| Total wall-clock index time | Primary business metric |
| Embedding batches/sec | From embedding path only |
| LI batches/sec or docs/sec | From LI path only |
| P50/P95 batch latency | Add lightweight JSON timings in runtime modules |
| Model load time | Cold start and warm start |
| Peak RSS | Whole process high-water mark |
| CPU utilization | Sampled during index run |
| Correctness | Embedding cosine similarity and LI ranking stability |

### Instrumentation gap to close first

The repo has benchmarking scripts, but not the exact per-batch JSON output assumed by the old plan. Before optimization work, add lightweight timing output to the existing runtime paths instead of inventing new scripts.

Suggested instrumentation targets:

- [`core/embedding/embedding-local-model.js`](/Users/admin/Projects/sweet-search-private/core/embedding/embedding-local-model.js)
- [`core/ranking/late-interaction-model.js`](/Users/admin/Projects/sweet-search-private/core/ranking/late-interaction-model.js)
- [`scripts/benchmark-harness.js`](/Users/admin/Projects/sweet-search-private/scripts/benchmark-harness.js)

### Mandatory A/B Gate Protocol

Every phase must pass this gate before merging into the main branch. No exceptions.

#### Baseline requirement

Before starting any phase, commit a baseline benchmark summary artifact to `.claude/benchmarks/results/`. The baseline must be taken on the same hardware, same ORT version, same benchmark flags, and same test corpus that will be used for the A/B comparison. If Phase 0b upgrades ORT, the post-upgrade baseline becomes the new reference for all subsequent phases. Commit summarized results and delta tables, not raw per-run logs unless they are needed to explain an anomaly.

#### Run protocol

1. **Warmup:** 2 full-index runs, discarded.
2. **Measurement:** Minimum 5 full-index runs for both A (baseline) and B (candidate).
3. **Environment:** Same machine, same background load, same benchmark flags as the baseline run. Record the exact flags used, including concurrency.
4. **Reporting:** For each metric in the Metrics table above, report mean, P95, and standard deviation across the 5 runs.

#### Acceptance thresholds

| Metric | Gate | Notes |
|------|------|------|
| Total wall-clock index time | B must be faster by >3% mean, or within 1% if the phase is correctness-only | 3% threshold accounts for run-to-run noise |
| Embedding batches/sec | Must not regress >1% mean | Regression here blocks merge even if wall-clock improves elsewhere |
| LI batches/sec | Must not regress >1% mean | Same as above |
| P95 batch latency | Must not regress >5% | Tail latency guard |
| Peak RSS | Must not regress >10% | Hard cap; if a phase adds workers, budget the increase explicitly |
| Model load time | Must not regress >20% cold, >5% warm | Cold start tolerance is higher because it is amortized |
| Correctness — embedding | Cosine similarity >0.999 vs baseline on fixed corpus | Bit-identical is ideal; 0.999 is the floor |
| Correctness — LI ranking | Kendall tau >0.99 on top-50 results for fixed query set | Ranking stability matters more than vector similarity for LI |

#### Rollback criteria

If any gated metric regresses beyond its threshold and cannot be resolved within the phase scope, revert the phase branch. Do not carry regressions forward into the next phase hoping to fix them later.

#### Artifact checklist

Each phase merge must include:

- [ ] Baseline artifact (committed before work began)
- [ ] Candidate artifact (5-run summary with mean/P95/stddev)
- [ ] Delta table showing A vs B for every gated metric
- [ ] Pass/fail verdict for each gate
- [ ] Hardware and environment description (machine, OS, ORT version, Node version, flags)

Store all artifacts under `.claude/benchmarks/results/{phase}/`.

---

## Phase 0: Baseline Hygiene

**Effort:** Small
**Priority:** Must do first

### 0a. Fix stale plan assumptions

Correct the plan itself before implementation:

- Replace old pre-DDD paths with current paths under `core/embedding/`, `core/ranking/`, `core/infrastructure/`, `core/search/`, and `core/indexing/`
- Replace nonexistent scripts:
  - `scripts/compare-benchmarks.js`
  - `scripts/compare-embedding-quality.js`
- Replace the nonexistent `benchmarks/` output folder with `.claude/benchmarks/results/`
- Remove references to `loadModelWithSessionOptions()`: the current embedding path already creates ORT sessions directly
- Correct LateOn-Code memory math from `~600MB` to the actual 150 MB INT8 artifact plus runtime overhead

### 0b. Upgrade ONNX Runtime before profiling

Current workspace version:

```text
onnxruntime-node 1.24.1
```

Upgrade to the latest `1.24.x` line first and re-baseline. This matters because:

- ORT `1.24.2` fixed LUT GEMM / `MatMulNBitsLutGemm` issues relevant to later INT4 evaluation
- benchmarking old session behavior before the runtime bump risks optimizing the wrong baseline

### 0c. Re-scope this plan

Remove these items from the main implementation track:

- search keep-alive timers
- LI CoreML warmup
- binary HNSW as a new future feature
- backbone-swap recommendations presented as inference-speed work

They are either out of scope, already implemented elsewhere, or not justified by current repo evidence.

---

## Phase 1: Session Baseline Cleanup

**Effort:** Small-Medium
**Est. impact:** 5-20%
**Files:** [`core/embedding/embedding-local-model.js`](/Users/admin/Projects/sweet-search-private/core/embedding/embedding-local-model.js), [`core/ranking/late-interaction-model.js`](/Users/admin/Projects/sweet-search-private/core/ranking/late-interaction-model.js), [`core/infrastructure/onnx-session-utils.js`](/Users/admin/Projects/sweet-search-private/core/infrastructure/onnx-session-utils.js)

### 1a. Benchmark `executionMode: 'sequential'`

This is the highest-priority session setting experiment.

Current state:

- embedding session options use `executionMode: 'parallel'`
- shared helper session options use `executionMode: 'parallel'`
- `interOpNumThreads` is already `1` in shared helpers, but still `2` in the embedding-specific builder

For BERT-family encoder graphs, parallel execution mode is usually the wrong default unless the graph has meaningful branch-level parallelism.

Required experiment matrix:

| Setting | Values |
|------|------|
| `executionMode` | `parallel`, `sequential` |
| `interOpNumThreads` | `1`, current default |
| `intraOpNumThreads` | current heuristic, capped variants |

Do not change this blindly. Benchmark it.

### 1b. Replace toy warmup with realistic warmup

Current embedding warmup is still:

- one short text
- `max_length=64`

That does not match indexing traffic.

Update both model runtimes to warm with realistic batch shapes and real indexing lengths:

- embedding: realistic indexing max length and batch sizes
- LI: realistic document encoding lengths and batch sizes

Use two-pass warmup:

1. first pass for kernel selection and graph specialization
2. second pass for stable measurement and allocator settling

### 1c. Keep graph-cache verification, but simplify the story

The current embedding path already:

- creates ORT sessions directly
- writes `optimizedModelFilePath`
- warns if the optimized artifact does not materialize

Phase 1 should keep that verification and extend it to LI if useful, but the old “HF session-options forwarding fallback” section should be removed entirely.

### 1d. CoreML work is embedding-only

For this repo, CoreML should remain an **embedding-only** benchmark branch.

Do not include LI CoreML warmup or LI CoreML tuning in the main track. The current LI runtime intentionally forces CPU because previous measurements showed partial-partition regressions.

For embedding on Apple Silicon, benchmark only the option shapes actually supported cleanly by `onnxruntime-node` in this repo, which currently means `coreMlFlags`-based variants in [`core/infrastructure/coreml-provider.js`](/Users/admin/Projects/sweet-search-private/core/infrastructure/coreml-provider.js).

---

## Phase 2: Coordinated Indexing Worker Pools

**Effort:** Medium-Large
**Est. impact:** 1.5-3x, machine-dependent
**Files:** new [`core/indexing/indexer-pool.js`](/Users/admin/Projects/sweet-search-private/core/indexing/indexer-pool.js), new [`core/indexing/indexer-worker.js`](/Users/admin/Projects/sweet-search-private/core/indexing/indexer-worker.js), [`core/indexing/indexer-phases.js`](/Users/admin/Projects/sweet-search-private/core/indexing/indexer-phases.js), runtime helpers as needed

### Goal

Introduce per-model worker pools for indexing without breaking the current stage-level overlap.

### Critical correction

The old plan treated embedding and LI pools as mostly independent and RAM-gated. That is incomplete.

The allocator must budget for:

1. vector workers
2. LI workers
3. the fact that both stages may already run concurrently
4. the main thread, SQLite work, chunking, and HNSW build work

### Required design

Use a **single global allocator** for indexing resources:

- detect physical cores
- reserve headroom for the main thread and I/O
- reserve memory for both active model pools
- allocate sessions jointly, not one pool at a time

Start conservative:

- no more than one pool per model initially
- no more than a small number of sessions per model
- cap total active ORT sessions across embedding and LI

The first implementation should optimize for stability, not maximum fan-out.

### Worker ownership

New code belongs under the indexing bounded context:

- `core/indexing/indexer-pool.js`
- `core/indexing/indexer-worker.js`

Do **not** create `core/indexer-pool.js` at the repo root.

### Failure handling

Keep these protections from the old draft:

- per-batch timeout
- worker restart budget
- requeue in-flight work on worker exit
- fallback to inline single-session inference if all workers fail

---

## Phase 3: Buffer Reuse and Batch Retuning

**Effort:** Small-Medium
**Est. impact:** 5-15%
**Files:** [`core/embedding/embedding-local-model.js`](/Users/admin/Projects/sweet-search-private/core/embedding/embedding-local-model.js), [`core/ranking/late-interaction-model.js`](/Users/admin/Projects/sweet-search-private/core/ranking/late-interaction-model.js), [`core/indexing/indexer-pool.js`](/Users/admin/Projects/sweet-search-private/core/indexing/indexer-pool.js)

### 3a. Worker-local typed-array reuse

Once worker pools exist, add worker-local reusable input and output buffers to reduce allocation churn and GC pressure during sustained indexing.

This is a good follow-up optimization because:

- it stacks on top of worker pools
- it is low risk
- it benefits both embedding and LI paths

### 3b. Re-tune the existing memory guard

Current embedding bucketing still contains a fixed RSS guard in [`core/embedding/embedding-local-model.js:442`](/Users/admin/Projects/sweet-search-private/core/embedding/embedding-local-model.js#L442).

That logic should become adaptive:

- keep it on lower-memory machines
- relax or disable it on larger-memory systems
- re-evaluate once worker pools exist, because process RSS behavior will change materially

### 3c. Re-tune batching for multi-session execution

Current bucketing was tuned for a single-session path.

After Phase 2:

- re-balance token budgets for per-worker micro-batches
- bucket by estimated length per worker
- reduce padding waste without starving workers

Do not retune batch sizes before the worker-pool shape is stable.

---

## Phase 4: ORT Artifact Optimization

**Effort:** Medium
**Est. impact:** 5-20%, mostly startup and cold runs
**Files:** runtime loaders plus optional build scripts

### 4a. Validate optimized graph persistence

Keep `optimizedModelFilePath` enabled and measure:

- first cold load
- second warm load
- optimized artifact size
- whether the artifact is reused across sessions

This is low risk and already partly wired up.

### 4b. Benchmark ORT format models

Before reaching for Olive, benchmark ORT format (`.ort`) as the official ORT-native artifact path for faster loading and runtime optimization packaging.

This should be a benchmark branch, not a blind migration:

- convert embedding model
- convert LI model
- compare load time, RSS, and throughput vs plain ONNX

### 4c. Olive is optional, not default

The old plan pushed Olive too early and used incorrect LI backbone assumptions.

If Olive is tested:

- use the real backbone dimensions from current configs
- treat it as an optional offline optimization pipeline
- compare it against plain ONNX and ORT format

Do not assume Olive wins just because it exists.

### 4d. Prepacked weights are a later optimization

Prepacked weight sharing is interesting only if session initialization remains a visible bottleneck after long-lived workers are in place.

Because it likely requires custom native binding exposure, it should remain a later-stage experiment.

---

## Phase 5: Quantization Track

**Effort:** Medium
**Est. impact:** Potentially large, but risky
**Priority:** Benchmark-gated only

### 5a. Evaluate embedding INT4 first

If the goal is maximum speed with bounded risk, start with the embedding model only.

Why:

- pooled embedding outputs are easier to validate
- INT4 gains are more plausible after the ORT `1.24.x` upgrade
- correctness checks are simpler

Quality gates:

- cosine similarity vs INT8
- retrieval recall regression on code-search evals
- full-index throughput and wall-clock

### 5b. Keep LI INT4 as a separate experiment

Do **not** bundle LI INT4 into the same rollout as embedding INT4.

Reasons:

- LI emits token vectors, not pooled embeddings
- quality errors compound through MaxSim
- validation should focus on ranking stability, not only vector similarity

For LI, the gate should be search-ranking stability on the existing evaluation pipeline, not just tensor-level drift.

---

## Separate Speed-First Evaluation Track

These items may be worth testing if the requirement is absolute speed, even at some quality cost, but they should not be mixed into the core runtime-optimization plan.

### A. `lateon-code-edge`

This is the nearest-term “smaller model” option already supported by the repo:

- configured in [`core/infrastructure/config/ranking.js`](/Users/admin/Projects/sweet-search-private/core/infrastructure/config/ranking.js)
- already loadable via `--late-interaction-model=lateon-code-edge`

This should be benchmarked explicitly as a speed-vs-quality tradeoff.

### B. Token pooling / LI index reduction

If indexing throughput is bottlenecked by LI, token-pool and storage-reduction levers may beat more speculative model-runtime work. Keep those decisions aligned with [`LI_QUANTIZATION_STRATEGY.md`](/Users/admin/Projects/sweet-search-private/docs/LI_QUANTIZATION_STRATEGY.md).

### C. Backbone swap

CodeRankEmbed replacement, ModernBERT embedding variants, or other model swaps should remain a separate evaluation document. They are not direct inference-speed refactors of the current local path.

---

## Implementation Order

| Step | Work | Priority |
|------|------|------|
| 0 | Fix plan drift, benchmark drift, and ORT version drift | Must do first |
| 1 | Session baseline cleanup: realistic warmup, execution-mode A/B, graph-cache verification | First implementation step |
| 2 | Coordinated indexing worker pools | Core throughput work |
| 3 | Buffer reuse and batch retuning | Follow-up optimization |
| 4 | ORT artifact optimization: optimized graphs, ORT format, optional Olive | Independent branch after Phase 1 |
| 5 | Quantization track: embedding INT4 first, LI INT4 later | Experimental only |
| Eval | `lateon-code-edge` and other speed-first tradeoffs | Separate benchmark branch |

---

## Expected Wins

Do not carry forward the old multiplicative speedup claims as commitments.

Reasonable expectations:

- Phase 1: measurable but modest
- Phase 2: largest likely gain
- Phase 3: useful incremental win
- Phase 4: mostly cold-start and load-path benefits unless ORT format is unusually strong here
- Phase 5: potentially large, but high-risk and benchmark-gated

Conservative planning target:

```text
~2-4x end-to-end indexing throughput improvement
```

That is a planning estimate, not a promise. The worker-pool implementation and global CPU budgeting will determine whether the upper half of that range is real.

---

## Explicit Non-Goals

- Rewriting the runtime in Rust
- Replacing the embedding model based on unclear benchmark comparisons
- Treating binary HNSW as “missing”
- Enabling LI on CoreML without fresh proof
- Adding keep-alive timers to an indexing-only speed plan
- Shipping INT4 for both models at once

---

## References

- ONNX Runtime threading docs: <https://onnxruntime.ai/docs/performance/tune-performance/threading.html>
- ONNX Runtime CoreML EP docs: <https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html>
- ONNX Runtime ORT format docs: <https://onnxruntime.ai/docs/performance/model-optimizations/ort-format-models.html>
- ONNX Runtime releases: <https://github.com/microsoft/onnxruntime/releases>
