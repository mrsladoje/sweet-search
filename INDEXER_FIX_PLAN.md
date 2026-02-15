# Indexer Performance Fix Plan

## 1) Problem Statement

Running `eval/run_all.js --benchmarks=all --max-queries=200` is taking ~1h+ with long stalls in indexing-heavy benchmarks (for example COIR/AdvTest scale).

Current bottlenecks in code:

1. `eval/lib/indexer.js` runs indexing in two separate child processes (`--graph-only` then `--vectors-only`), so local embedding model state is cold-loaded repeatedly.
2. `eval/lib/indexer.js` deletes `merkle-state.json` between phases, forcing vectors phase to re-process everything.
3. ColBERT indexing is always built during indexing and always enabled during benchmark querying (`useColBERT: true`), multiplying embedding work.
4. Local embedding batch behavior in runtime is not yet verified end-to-end (JS-level batching exists, runtime execution mode needs profiling).
5. Benchmarks are orchestrated sequentially in `eval/run_all.js`, with no explicit fast/quality profiles.

Prewarming only the parent benchmark runner does not solve child-process cold starts.

## 2) Goals

1. Reduce total `run_all` wall time substantially without silently degrading benchmark validity.
2. Make speed/quality tradeoffs explicit via CLI profiles.
3. Preserve a safe fallback path to current behavior.

## 3) Non-Goals

1. No change to benchmark datasets or metric formulas.
2. No permanent removal of ColBERT; only controlled toggles/profiles.
3. No large architectural rewrite in first pass.

## 4) Fix Strategy (Phased)

Execution update:

1. The immediate execution order is now MVP-first and supersedes the older broad ordering below.
2. Deliver a small, measurable slice first, then expand only if data shows remaining bottlenecks.

## Phase 0: Instrumentation First (prerequisite)

Before changing behavior, add timing breakpoints and persist them in benchmark outputs:

1. process/model load time
2. graph build time
3. vector embedding time
4. HNSW build time
5. ColBERT build time
6. artifact build time
7. query phase time

Reason:

1. Ensures optimization decisions are data-driven, not guess-driven.
2. Validates whether model cold start, ColBERT, or another phase dominates.

## Phase A: MVP Slice (ship first)

Scope for first implementation pass:

1. `A1` guarded single-pass indexing (no default flip until ONNX-conflict validation passes)
2. `A3` profile system (`fast|balanced|full`) and ColBERT controls
3. `R2` fail-fast when native ANN backend is unavailable (`--require-native-ann`)
4. `R5` benchmark-only SQLite fast mode (explicit flag/profile gated)

Out-of-scope for MVP:

1. Deeper architecture (persistent worker, in-memory corpus ingestion)
2. Advanced throughput work (`R4+`) until post-MVP timing data is collected

## Detailed Backlog (Post-MVP)

### A1. Remove forced two-process indexing in eval path

Change `eval/lib/indexer.js` to support single indexer invocation per benchmark corpus (no graph/vectors split), with compatibility fallback.

- Add `indexMode` option: `single` (candidate) or `two-phase` (legacy fallback).
- `single` mode command: `node core/index-codebase-v21.js --quiet` (or `--full --quiet` if we want deterministic full rebuild in eval corpora).
- Keep `two-phase` available behind explicit flag/env for rollback.
- Validate historical ONNX conflict risk before making `single` the default.

Expected impact:
- Cuts process cold starts by ~2x in eval indexing path.
- Removes merkle-state deletion hack from default path.

### A2. Remove merkle deletion in default flow

In `eval/lib/indexer.js`, stop unlinking `.sweet-search/merkle-state.json` in normal mode.

- Only retain special handling if `two-phase` compatibility mode is explicitly enabled.
- Document why deleting state is unsafe and expensive.

Expected impact:
- Prevents unnecessary full vector reprocessing between phases.

### A3. Add explicit benchmark profiles and ColBERT toggles

Add CLI options to `eval/run_all.js` and `eval/run_benchmark.js`:

- `--profile=fast|balanced|full` (default `balanced`)
- `--use-colbert=true|false` (overrides profile)
- `--build-colbert=true|false` (overrides profile)

Profile defaults:

1. `fast`: `buildColBERT=false`, `useColBERT=false`
2. `balanced`: `buildColBERT=false`, `useColBERT=false` for indexing-heavy bulk runs
3. `full`: `buildColBERT=true`, `useColBERT=true`

Wire-through:

- `eval/lib/indexer.js` passes a no-ColBERT switch to core indexer when requested.
- `eval/lib/indexer.js` `initSearch(...)` accepts `useColBERT` instead of hardcoding `true`.

Expected impact:
- Removes largest avoidable embedding multiplier for routine benchmark sweeps.

## Phase B: Throughput Improvements (medium risk)

### B1. Add core indexer ColBERT build switch

In `core/index-codebase-v21.js`:

- Add `--no-colbert` (and optionally `--colbert`) CLI handling.
- Skip `buildColBERTIndex(...)` when disabled.

This lets eval control indexing cost directly without patching core behavior ad hoc.

### B2. Improve local embedding throughput

In `core/embedding-service.js`:

- Optimize `callLocalModel(texts)` to use real batching if supported by transformers pipeline (array input), else fallback to current per-item loop.
- Add guarded tunables:
  - local batch size override env (for benchmark runs only)
  - optional ONNX thread knobs via env passthrough

Expected impact:
- Better CPU utilization for large corpus embeddings.

### B3. Optional in-process warmup before first indexing run

For single-process indexing modes, call embedding warmup once per process before first heavy embedding loop.

Expected impact:
- Eliminates first-call local model latency spikes and makes timing more predictable.

## Phase C: Structural Improvement (higher effort, highest ceiling)

### C1. Persistent index worker for benchmark suites

Introduce a long-lived index worker used by `run_all`:

1. One child process started once.
2. Receives corpus path + options per benchmark via IPC.
3. Reuses loaded local embedding model across benchmarks.

This directly addresses repeated model cold loads across the full benchmark suite.

Risk:
- Requires careful handling of path-scoped config (`SWEET_SEARCH_PROJECT_ROOT`) and module-level singletons.

Fallback:
- Keep non-worker mode as default until validated.

## 5) File-Level Change Plan

1. `eval/lib/indexer.js`
   - Replace default two-phase spawn with single-pass mode.
   - Remove default merkle unlink.
   - Add options object (`indexMode`, `buildColBERT`, `useColBERT`).
2. `eval/run_all.js`
   - Add profile/toggle CLI flags.
   - Pass options into indexing + search init.
   - Print active profile for reproducibility.
3. `eval/run_benchmark.js`
   - Mirror CLI/profile behavior from `run_all.js`.
4. `core/index-codebase-v21.js`
   - Add `--no-colbert` support.
   - Condition ColBERT phase on flag.
5. `core/embedding-service.js`
   - Improve local embedding batching path.
   - Add guarded benchmark-oriented tuning knobs.
6. `eval/lib/evaluator.js` (if needed)
   - Ensure query path respects `useColBERT` selection.

## 6) Validation Plan

## Functional checks

1. Index files are produced correctly for each benchmark corpus.
2. `search.init()` works when ColBERT index is absent and `useColBERT=false`.
3. Existing `--skip-index` behavior still works.

## Performance checks

Collect per-benchmark timings:

1. corpus prep
2. indexing total
3. query phase total
4. total benchmark time

Run matrix:

1. Use the A/B matrix in Section 12 as the canonical experiment set.

## Quality checks

Compare key metrics (MRR@10, Recall@20, NDCG@10):

1. `balanced`/`fast` profiles may trade quality for speed; capture deltas explicitly.
2. `full` profile should be near-baseline quality with improved runtime from reduced process churn and better embedding throughput.

## 7) Acceptance Criteria

1. `run_all --benchmarks=all --max-queries=200 --profile=balanced` completes in materially less time than baseline and without failures.
2. No benchmark crashes due to missing ColBERT artifacts when ColBERT is disabled.
3. `--profile=full` remains available for highest-quality runs.
4. Legacy two-phase path remains behind explicit opt-in until confidence is high.

## 8) Rollout and Risk Control

1. Ship Phase A behind defaults that prioritize stability (`single` mode with explicit legacy fallback).
2. Add simple timing logs in output so regressions are obvious.
3. Land Phase B only after Phase A performance and correctness are verified.
4. Implement Phase C only if Phase A+B are insufficient for target runtime.

## 9) Open Decisions

1. Should `balanced` default to ColBERT off (recommended for iterative benchmarking)?
2. Do we require strict metric parity in default mode, or is speed-first default acceptable with explicit `full` mode?
3. Did the historical ONNX conflict for single-pass indexing actually reproduce on current stack, or can `single` become default safely?
4. Does local embedding currently execute true tensor batching in runtime, or internal per-item loops?
5. Is persistent worker worth the complexity after post-MVP measurements?

## 10) Additional Research Findings (New)

These are additional opportunities not yet included in Phases A-C, prioritized by likely speedup vs implementation risk.

### R1. Add `--no-artifacts` path for benchmark indexing (high impact, low-medium risk)

Observation:

1. The indexer builds quantized artifacts after vector phase (`core/index-codebase-v21.js`), but benchmark runs can operate on float HNSW only.

Plan:

1. Add a benchmark-only switch to skip Phase 5 artifact generation.
2. Wire this through `eval/lib/indexer.js`, `eval/run_all.js`, and `eval/run_benchmark.js`.

Expected impact:

1. Removes additional post-embedding build time on every benchmark corpus.

### R2. Fail fast when ANN backend degrades to JS fallback (high impact, low risk)

Observation:

1. `core/hnsw-index.js` silently falls back to pure JS when `usearch` is unavailable.
2. This can cause severe performance collapse without obvious operator awareness.

Plan:

1. Add strict mode for eval (`--require-native-ann`), failing if `usearch` cannot initialize.
2. Print explicit backend status in benchmark header and results JSON.

Expected impact:

1. Prevents accidentally benchmarking a pathological slow path.
2. This is a measurement-validity prerequisite and belongs in MVP Phase A.

### R3. Avoid file materialization for corpora where possible (very high impact, medium-high risk)

Observation:

1. Eval currently writes thousands of files (`eval/lib/corpus.js`) and then indexer re-reads/parses them.

Plan:

1. Add an in-memory or packed-corpus ingestion mode for benchmark datasets.
2. Keep current file-based path as compatibility fallback.

Expected impact:

1. Reduces filesystem overhead and improves throughput on large corpora.

### R4. Strengthen local embedding throughput tuning (high impact, medium risk)

Observation:

1. `getEmbeddings()` batches at the JS level, but it is not yet proven whether the underlying ONNX pipeline executes true tensor batching or internal per-item loops.

Plan:

1. First verify actual runtime behavior with instrumentation/profiling.
2. If needed, implement true batch inference for local path.
3. Add benchmark-only ONNX session/thread tuning knobs.
4. Add controlled defaults with per-machine calibration script.

Expected impact:

1. Better CPU utilization and lower embedding wall time.

### R5. Add benchmark-safe SQLite fast-build mode (high impact, low-medium risk for disposable eval indices)

Observation:

1. Eval indices are disposable artifacts; durability can be relaxed for speed.

Plan:

1. Add optional fast-build pragma profile for benchmark indexing only.
2. Gate behind explicit flag and document crash/recovery tradeoff.

Expected impact:

1. Faster DB write-heavy phases.
2. Promote to MVP Phase A for benchmark-only runs.

### R6. Expose benchmark HNSW construction presets (medium impact, low-medium risk)

Observation:

1. HNSW build parameters (`M`, `efConstruction`) directly affect build time.

Plan:

1. Add presets (`fast`, `balanced`, `full`) for indexing-time HNSW settings.
2. Measure metric impact in `full` vs lower-cost profiles.

Expected impact:

1. Additional indexing speedup with controlled retrieval-quality tradeoff.

### R7. Worker-pool parallelism for preprocessing phases (medium impact, medium risk)

Observation:

1. Parse/chunk loops are sequential and can underuse CPU.

Plan:

1. Introduce bounded worker pool for parse/chunk + pre-embedding text preparation.
2. Keep embedding execution bounded to avoid memory pressure.

Expected impact:

1. Better multicore utilization on larger corpora.

### R8. Optional GPU execution provider for local embeddings (high impact on GPU hosts, medium risk)

Observation:

1. Local embedding dominates indexing time on large corpora.
2. ONNX Runtime JS supports GPU execution providers (for compatible environments).

Plan:

1. Add benchmark-only provider selection for local embeddings (CPU default, optional CUDA/TensorRT where supported).
2. Add startup capability check and explicit provider logging in benchmark output.
3. Keep automatic fallback to CPU with clear warning when GPU init fails.

Expected impact:

1. Major embedding throughput improvement on machines with compatible GPUs.
2. No regression risk on CPU-only machines when fallback is robust.

## 11) Updated Priority Order

1. Phase 0 instrumentation (mandatory before optimization decisions)
2. MVP ship: `A1 + A3 + R2 + R5`
3. Measure post-MVP and decide next step from data
4. `R4` (only if embedding remains dominant)
5. `R8` on GPU-capable environments
6. `R6`
7. `R7`
8. `R3` (largest structural change, highest effort)

## 12) Measurement Matrix (A/B)

Run each row against the same benchmark set (`--benchmarks=all --max-queries=200`), recording total wall time, indexing time per dataset, and MRR@10/Recall@20 deltas.

1. Baseline with instrumentation only (no behavior change)
2. MVP: `A1 + A3 + R2 + R5`
3. MVP + `R1` (`--no-artifacts`) where quality policy allows
4. Full-quality control (`--profile=full`, ColBERT on, artifacts on)
5. Optional follow-up: `R4` tuning
6. Optional follow-up: `R8` GPU EP (where available)
7. Optional follow-up: `R6` fast HNSW preset

Acceptance update:

1. Default benchmark profile should achieve major runtime reduction vs baseline.
2. Full-quality profile remains available and reproducible.
3. Backend and profile metadata must be persisted in results JSON for auditability.
4. ONNX-conflict validation must pass before making single-pass indexing the default.

## 13) Research References

1. ONNX Runtime graph optimization and performance tuning docs
2. ONNX Runtime JS session options and execution provider docs
3. Transformers.js Node and pipeline docs (batching and runtime behavior)
4. SQLite pragma docs (`synchronous`, journaling tradeoffs)
5. HNSW parameter guidance (build-time/quality tradeoffs)
6. Node.js worker threads docs
