# LI Benchmark + Batching Plan

## Goal

Speed up late interaction (LI) indexing in a controlled way by:

1. Implementing true LI inference batching rather than the current outer-loop pseudo-batching
2. Benchmarking the change on this machine and on a weaker machine
3. Defining platform-aware defaults from measured results, similar to embedding indexing
4. Preserving correctness, bounded memory use, and safe fallback behavior

## Current Diagnosis

The current LI path is not truly batched.

- `core/indexer-ann.js` groups chunks in batches of 16, but that only batches the outer loop
- `core/late-interaction-model.js` still tokenizes and runs ONNX once per document inside `encodeDocuments()`
- Effective LI model batch size is therefore `1`
- LI also has heavier per-document work than embedding:
  - max document length is `2048`
  - per-token outputs must be projected, normalized, skiplist-filtered, and optionally pooled
- When LI runs in parallel with embeddings, both sessions compete for CPU threads, making the imbalance worse

## Constraints

- Do not regress correctness of LI token vectors or document metadata
- Do not make weak machines unstable
- Keep a hard sequential fallback
- Keep manual env overrides available
- Avoid tuning from theory alone; defaults must be benchmark-backed

## Non-Goals

- Replacing the LI model
- GPU/CoreML migration
- Rewriting the LI index format
- Removing the existing sequential path

## Deliverables

1. True batched LI encode path
2. LI benchmark harness and reporting script
3. Benchmark results from:
   - this machine
   - your weaker machine
4. Platform/profile heuristic for LI batching defaults
5. Tests covering batched correctness and profile selection
6. Short operator docs for env overrides and benchmark usage

## Workstream 1: Instrumentation

Add lightweight measurement around the LI path before changing behavior.

### Metrics to capture

- wall-clock time
- chunks/sec
- docs/sec
- tokens/sec
- average tokens/doc after tokenization
- effective padded tokens per batch
- peak RSS
- model load time
- time spent in:
  - tokenization
  - ONNX inference
  - projection + normalization
  - skiplist filtering
  - pooling
  - index insertion

### Output format

- human-readable console summary
- machine-readable JSON artifact under `eval/` or `docs/benchmarks/`

### Why this comes first

We need to separate:

- model compute bottlenecks
- padding waste
- post-processing overhead
- contention from parallel embedding + LI execution

## Workstream 2: True LI Batching

Refactor LI document encoding so batching is real.

### Required changes

1. Tokenize `string[]` as a batch, not one string at a time
2. Run ONNX once per batch
3. Update post-processing to preserve per-document outputs from `[batch, seq, hidden]`
4. Apply skiplist filtering and pooling per document after the batched inference
5. Return `Float32Array[][]` with one token-vector array per input document

### Critical implementation detail

`projectAndNormalize()` currently behaves like batch size is `1`.

Before batching defaults can ship, the code must explicitly handle:

- `batch > 1`
- different effective token counts per document
- padded tokens vs real tokens
- per-document splitting after projection/normalization

### Expected upside

- fewer ONNX invocations
- better CPU utilization
- less JS overhead per document
- much better throughput on larger Apple Silicon machines

## Workstream 3: Length-Aware Batching

Naive batching may waste compute because LI allows up to `2048` tokens.

### Add a second-stage experiment

Test both:

- fixed-order batching
- length-bucketed batching

### Candidate strategy

1. Tokenize lengths cheaply first or estimate from tokenizer output
2. Bucket documents by token length bands
3. Build batches from nearby lengths to reduce padding waste

### Why this matters

If one very long document pads a batch of short ones, batching gains can collapse.

## Workstream 4: Benchmark Matrix

Benchmark LI in isolation and in the real indexing flow.

### Machine A: This machine

Treat as the high-end profile:

- Apple Silicon
- high memory
- high core count

### Machine B: Weaker machine

Treat as the lower-tier profile:

- lower RAM
- fewer cores
- likely more sensitive to padding waste and thread contention

### Benchmark scenarios

1. LI only, sequential
2. LI only, batched
3. LI only, batched + length bucketing
4. Full indexing with embeddings sequential to LI
5. Full indexing with embeddings parallel to LI
6. Full indexing with embeddings parallel to LI, with reduced LI threads

### Batch sizes to test

- `1`
- `2`
- `4`
- `8`
- `16`
- `24`
- `32`

### Thread settings to test

Because embeddings and LI can now run together, benchmark:

- current `bestIntraOpThreads()`
- reduced LI intra-op threads during parallel runs
- optionally reduced embedding threads during parallel runs

### Pooling/skiplist settings

Hold these constant for the main comparison unless a secondary test shows they materially change the best batch size.

## Workstream 5: Benchmark Procedure

Run the same protocol on both machines.

### Per-run checklist

1. warm up model load once
2. run each configuration at least 3 times
3. record median and p95 wall time
4. record peak RSS
5. record LI throughput and end-to-end indexing time
6. note any signs of:
   - swap pressure
   - runaway RSS
   - thermal throttling
   - UI lag / machine instability

### Dataset strategy

Use the same codebase and, if needed, a fixed representative subset so both machines can be compared apples-to-apples.

### Acceptance thresholds

- meaningful throughput gain over current LI path
- no correctness drift in produced LI token vectors/index counts
- no crash or severe swap behavior on the weaker machine
- no regression that makes parallel indexing worse than sequential indexing

## Workstream 6: Correctness Validation

Performance work here is easy to get wrong silently. Add correctness checks before tuning defaults.

### Required tests

- batched LI output shape matches input order
- batch size `1` and batched mode produce equivalent outputs within tolerance
- skiplist behavior is preserved
- pooling behavior is preserved
- padded tokens do not leak into stored vectors
- long + short documents in one batch preserve correct boundaries

### Integration tests

- index build succeeds with LI batch sizes > 1
- removal-only LI update still works
- parallel LI + embeddings still preserves staging/promotion guarantees

## Workstream 7: Auto Detection Design

After benchmarks, add a profile detector for LI batching defaults modeled after embedding indexing.

### Design target

Centralize detection in config, not ad hoc in the model code.

### Likely outputs

Extend the existing indexer profile with LI-specific fields such as:

- `liBatchSize`
- `liUseLengthBucketing`
- `liParallelIntraOpThreads`
- `liSequentialIntraOpThreads`

### Likely inputs

- platform
- architecture
- total memory
- CPU count
- maybe an explicit weaker-machine override via env var

### Defaulting approach

Start conservative:

- high-end Apple Silicon: enable real LI batching with higher defaults
- mid-tier Apple Silicon: moderate batch size
- weaker machines: smaller batch size, possibly no bucketing by default if overhead is not worth it
- keep env overrides for forcing specific values

### Proposed env overrides

- `SWEET_SEARCH_LI_BATCH_SIZE`
- `SWEET_SEARCH_LI_LENGTH_BUCKETING=0|1`
- `SWEET_SEARCH_LI_THREADS`

## Workstream 8: Rollout Plan

### Phase 1

Land instrumentation and benchmark harness only.

### Phase 2

Implement true LI batching behind env overrides, default off.

### Phase 3

Run benchmark matrix on both machines and record results.

### Phase 4

Set profile-based defaults from measured results.

### Phase 5

Run full regression suite and a real full index on both machines.

## Decision Criteria

Ship profile-based LI batching defaults only if all are true:

- batched LI is measurably faster on this machine
- weaker machine remains stable
- correctness checks pass
- parallel LI + embeddings improves real end-to-end time rather than only LI microbenchmarks
- chosen defaults are backed by benchmark artifacts, not intuition

## Suggested Implementation Order

1. Add LI timing/memory instrumentation
2. Add a dedicated LI benchmark script
3. Refactor `encodeDocuments()` for true batched inference
4. Add correctness tests for batched LI
5. Benchmark on this machine
6. Add length-bucketing experiment
7. Benchmark on weaker machine
8. Derive profile defaults
9. Add config/env plumbing
10. Validate end-to-end indexing in sequential and parallel modes

## Open Questions To Resolve During Benchmarking

- Is LI bottlenecked more by ONNX compute, tokenization, or JS-side post-processing?
- Does length bucketing materially outperform simple batching on real code chunks?
- What LI batch size is best when LI runs alone?
- What LI batch size is best when embeddings run in parallel?
- Should LI and embedding use different thread caps during parallel indexing?
- Does the weaker machine want batching enabled by default, or only via opt-in?

## Final Output Expected From This Plan

At the end of this work we should have:

- a benchmark report for both machines
- a real LI batching implementation
- conservative machine-aware defaults
- override knobs for manual tuning
- confidence that LI is fast on strong hardware without making weaker hardware miserable
