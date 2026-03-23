# Rescoring Fix Plan

**Date:** 2026-03-23
**Status:** Planned
**Goal:** Improve Stage 2 and Stage 2.5 latency without hurting retrieval quality, and align the rescoring path with current 2026 production practice.

---

## Executive Summary

The current architecture is directionally correct:

`Binary HNSW -> int8 rescore -> float rescore -> graph expansion -> MaxSim -> gated CE`

The main problem is the implementation of the two middle stages:

- Stage 2 uses per-candidate int8 cosine, not a batched normalized-dot kernel.
- Stage 2.5 loads float vectors from SQLite on the hot path and scores them in JS.
- Both stages use fixed-width pools (`200` / `200`) instead of adaptive oversampling.
- The int8 quantizer is simple max-abs scaling, which is baseline quality, not frontier quality.

This plan fixes the rescoring path in phases. The order matters. Do not jump to quantizer redesign before fixing batching, storage, and scoring kernels.

---

## Current State

### Relevant Code Paths

- `core/search-semantic.js`
  - Stage 2 int8 loop
  - Stage 2.5 float rescore loop
- `core/embedding-service.js`
  - `floatToInt8()`
  - `int8CosineSimilarity()`
- `core/simd-distance.js`
  - `wasmInt8Cosine()`
  - `wasmInt8Dot()`
- `core/sweet-search.js`
  - `cosineSimilarity()`
  - `_loadFloatVectors()`
- `core/config.js`
  - `stage2Candidates`
  - `stage2_5Candidates`

### Existing Helpers To Reuse

- `core/search-semantic.js`
  - existing score-spread / skip-analysis logic should inform adaptive pool sizing
- `core/simd-distance.js`
  - existing SIMD structure for Hamming is the implementation template for int8 dot

### Naming Cleanup Required

- `core/embedding-service.js`
  - `int8CosineSimilarity` is re-exported as `int8DotProduct`
  - this is misleading today and must be fixed as part of Phase 1
  - after Phase 1, `dot` must mean dot, not cosine

### Known Issues

1. Stage 2 is per-candidate:
   - query copied repeatedly into WASM memory
   - document copied repeatedly into WASM memory
   - cosine recomputes norms on every score

2. Stage 2.5 is SQLite-backed:
   - vector payload fetched through SQL
   - vectors materialized row-by-row
   - float cosine executed in JS

3. Candidate pools are fixed:
   - `stage2Candidates = 200`
   - `stage2_5Candidates = 200`
   - this is too blunt for easy queries and may still be too small for hard ones

4. Quantization is simple:
   - `floatToInt8()` uses per-vector max-abs scaling
   - this is easy to implement, but not strong enough to minimize rescoring work

---

## Design Principles

As of March 23, 2026, the production consensus is:

- retrieve on compressed vectors
- oversample
- rescore a smaller pool on higher-fidelity vectors
- batch hot kernels
- use normalized inner product when cosine is intended
- keep original vectors in direct-access storage
- keep expensive rerankers bounded

This plan follows that model.

---

## Non-Goals

- Do not redesign HNSW in this workstream.
- Do not change graph expansion behavior here unless needed for evaluation.
- Do not change MaxSim or CE policy in the first pass.
- Do not introduce native addons in Phase 1 unless WASM SIMD proves insufficient.

---

## Target End State

### Stage 2

- normalized int8 query/document vectors
- dot-product scoring only at search time
- one batched SIMD/WASM call per candidate slab
- adaptive Stage 2 pool size

### Stage 2.5

- original vectors stored in direct-access binary storage
- batched float scoring kernel
- adaptive Stage 2.5 pool size
- SQLite retained only for metadata and compatibility if needed

### Evaluation

- no regression in nDCG@10 / MRR@10 / Success@10
- lower p50 and p95 latency
- lower Stage 2 and Stage 2.5 latency in isolation

---

## Phase 0: Baseline And Instrumentation

**Objective:** Make later changes measurable.

### Tasks

1. Add per-stage counters and histograms:
   - Stage 2 candidate count
   - Stage 2.5 candidate count
   - Stage 2 latency
   - Stage 2.5 latency
   - missing int8 vector count
   - missing float vector count

2. Record score-distribution signals:
   - HNSW top-1/top-2 gap
   - int8 top-1/top-2 gap
   - float top-1/top-2 gap

3. Extend the benchmark harness to emit:
   - p50/p95 stage timings
   - end-to-end latency
   - nDCG@10
   - MRR@10
   - Success@10
   - average Stage 2 candidate count
   - average Stage 2.5 candidate count
   - recall of the Stage 2 pool against the current float-rescore baseline

4. Capture benchmark slices, not just one aggregate:
   - easy queries
   - ambiguous / flat-score queries
   - short queries
   - longer natural-language queries
   - with and without graph expansion

5. Establish release-gate comparisons:
   - baseline current branch
   - Phase 1 flag OFF
   - Phase 1 flag ON
   - Phase 2 direct-access path ON
   - Phase 3 adaptive oversampling ON

### Files

- `core/search-semantic.js`
- `eval/run_benchmark.js`
- `eval/retrieval-harness.js`
- any stage-timing helper already used elsewhere

### Exit Criteria

- A reproducible baseline exists for current `200/200` behavior.
- Benchmark output separates Stage 2, Stage 2.5, MaxSim, and CE.
- Benchmark runs are comparable across branches and flags.

### Benchmark Constraints

Every phase must be judged against the same benchmark contract:

- Quality must not regress beyond a small tolerance.
- Latency wins must be visible both per-stage and end-to-end.
- Candidate-pool reductions only count as wins if quality is preserved.

Initial go/no-go thresholds:

- `nDCG@10`: no worse than `-0.25pp`
- `MRR@10`: no worse than `-0.25pp`
- `Success@10`: no worse than `-0.25pp`
- Stage 2 latency: target `>= 2x` improvement in isolation for Phase 1
- Stage 2.5 latency: target `>= 2x` improvement in isolation for Phase 2
- End-to-end p50: target measurable improvement, no p95 regression larger than noise band

If quality regresses past tolerance, do not promote the phase by default.

---

## Phase 1: Fix Stage 2 Scoring

**Objective:** Replace per-candidate int8 cosine with normalized, batched dot rescoring.

### Tasks

1. Normalize the int8 representation at index time.
   - Preferred path: normalize the float vector first, then quantize to int8
   - This makes the int8 vector a quantized unit vector
   - Search-time dot product then approximates cosine directly
   - Avoid introducing scale metadata unless benchmark data proves it is needed

2. Replace `int8CosineSimilarity()` on the hot path with normalized dot scoring.

3. Add a batched WASM API:
   - copy query once
   - copy candidate slab once
   - score all candidates in one call
   - write scores into an output buffer

4. Add SIMD to the int8 dot path.
   - Reuse the existing SIMD structure from the Hamming implementation
   - This is an implementation adaptation, not a new algorithm design problem
   - Favor the existing `i8x16 -> i16x8 -> i32x4` accumulation pattern

5. Keep the old per-candidate path as a fallback behind a flag until validated.

6. Clean up naming:
   - stop exporting cosine under a dot-product name
   - introduce a real dot-product API
   - update callers so the semantic meaning is unambiguous

### Files

- `core/embedding-service.js`
- `core/simd-distance.js`
- wasm build source for SIMD int8 dot
- `core/search-semantic.js`
- `core/binary-hnsw-index.js` if vector layout metadata changes

### Notes

- Do not keep search-time norm computation in the hot loop.
- If normalization changes index encoding, reindexing will be required.
- Confirm the Stage 2 change does not interfere with existing asymmetric HNSW traversal behavior.

### Exit Criteria

- Stage 2 scores are numerically close to the validated baseline.
- Stage 2 latency improves materially.
- End-to-end ranking quality does not regress.

---

## Phase 2: Fix Stage 2.5 Storage And Float Scoring

**Objective:** Remove SQLite from the float-rescore hot path.

### Tasks

1. Introduce direct-access float vector storage:
   - flat binary file or mmap-friendly blob
   - offset table keyed by chunk id
   - read-only load path at startup
   - default to preloaded contiguous buffers in memory on developer and benchmark machines
   - treat mmap as optional follow-up, not the default implementation path

2. Keep SQLite temporarily for compatibility:
   - metadata lookup only
   - optional fallback if direct-access store missing

3. Replace JS float cosine with a batched float kernel:
   - SIMD if done in WASM
   - query copied once
   - candidate slab scored in one call

4. Ensure vector layout is contiguous and cache-friendly.

### Files

- `core/sweet-search.js`
- index build / persistence code that writes float vectors
- `core/simd-distance.js` or new float scoring helper
- any vector storage abstraction that makes fallback handling clean

### Notes

- The direct-access store should be append-friendly and read-only at query time.
- Preloaded contiguous buffers are the preferred first implementation.
- mmap is optional only if it provides a measurable operational advantage later.

### Exit Criteria

- Stage 2.5 no longer depends on SQL for vector payload access in the normal path.
- Float rescoring latency drops materially.
- Ranking quality is unchanged or better.

---

## Phase 3: Replace Fixed Pools With Adaptive Oversampling

**Objective:** Stop paying for `200/200` on every query.

### Tasks

1. Replace fixed pool sizes with adaptive rules:
   - Stage 2 pool derived from requested `k`
   - Stage 2.5 pool smaller than Stage 2 by default
   - widen pools on ambiguous score spreads
   - shrink pools on decisive score spreads
   - reuse existing score-spread / skip-analysis signals where possible instead of inventing a parallel heuristic stack

2. Keep hard minimums and maximums:
   - avoid starving hard queries
   - avoid pathological overscoring

3. Make adaptation visible in logs and benchmarks.

### Suggested Starting Shape

- Stage 2:
  - `max(minStage2, k * oversample1)`
- Stage 2.5:
  - `max(minStage2_5, k * oversample2)`
- widen when the top-score margin is flat
- shrink when the top-score margin is clean

These exact formulas are tuning inputs, not fixed truth.

Preferred signal sources:

- top-1 vs top-2 gap
- top-k standard deviation
- existing clear-winner / tight-cluster logic already present in semantic search

### Files

- `core/config.js`
- `core/search-semantic.js`
- benchmark harness

### Exit Criteria

- Easy queries score fewer candidates than today.
- Hard queries preserve or improve recall.
- End-to-end metrics hold up under benchmark.

---

## Phase 4: Quantizer Upgrade Experiment

**Objective:** Reduce how much float rescoring is required at all.

### Tasks

1. Benchmark the current max-abs int8 quantizer against stronger alternatives:
   - rotational quantization
   - anisotropic quantization
   - product or residual-style quantization if practical

2. Measure:
   - candidate recall after Stage 2
   - nDCG@10 / MRR@10
   - Stage 2.5 pool size needed to match baseline quality

3. Adopt a stronger quantizer only if it reduces rescoring cost without adding excessive complexity.

### Files

- `core/embedding-service.js`
- index-time vector build path
- offline evaluation scripts

### Notes

- This is an experiment phase, not the first implementation target.
- Do not merge a quantizer rewrite without evaluation data.

### Exit Criteria

- Either:
  - a stronger quantizer is proven better and adopted
- Or:
  - the current quantizer is retained with explicit evidence

---

## Phase 5: Optional Follow-Up If MaxSim Becomes The Bottleneck

**Objective:** Avoid optimizing the wrong stage after rescoring is fixed.

### Trigger

Only do this if Stage 2 and Stage 2.5 are no longer the dominant cost.

### Possible Work

- candidate pruning before MaxSim
- query token pruning
- document token pruning
- PLAID / EMVB / ColBERT-style late interaction acceleration ideas

This is a separate workstream. Do not mix it into the first rescoring PR.

---

## Implementation Order

1. Phase 0 baseline and measurement
2. Phase 1 Stage 2 batching and normalized-dot scoring
3. Phase 2 Stage 2.5 storage refactor and batched float scoring
4. Phase 3 adaptive oversampling
5. Phase 4 quantizer experiments
6. Phase 5 only if needed

---

## Suggested Session Plan For The Next Engineer

### Session 1

- add instrumentation
- capture baseline
- implement batched Stage 2 path behind a flag
- compare outputs against current Stage 2

### Session 2

- switch Stage 2 default if validated
- implement direct-access float storage
- add batched float scoring

### Session 3

- add adaptive oversampling
- tune on eval benchmarks
- decide whether quantizer work is justified

---

## Acceptance Criteria

- No meaningful regression in nDCG@10, MRR@10, or Success@10 on the standard benchmark set.
- Lower p50 and p95 end-to-end latency.
- Lower isolated Stage 2 latency.
- Lower isolated Stage 2.5 latency.
- Reduced average number of Stage 2.5 rescored candidates.
- Clean fallback behavior if new storage or SIMD paths are unavailable.
- Benchmark output shows which phase created the improvement.

---

## Risks

- Reindex may be required if int8 normalization changes representation.
- New vector storage can introduce compatibility issues with old indexes.
- Adaptive oversampling can hurt recall if minimums are too low.
- SIMD/WASM changes can create platform-specific bugs.

Mitigation:

- keep old paths behind flags during rollout
- validate numerics against golden queries
- benchmark every phase independently

---

## Open Questions

1. Should direct-access float storage be preloaded into memory or memory-mapped lazily?
2. Is reindexing acceptable for normalized int8 vectors?
3. Should Stage 2.5 use float32 only, or should float16 be evaluated as an optional compromise?
4. What benchmark set is the release gate: GenCodeSearchNet only, or a broader suite?

---

## Definition Of Done

This work is done when:

- Stage 2 is batched and no longer computes cosine norms in the search hot path.
- Stage 2.5 no longer fetches vector payloads from SQLite in the normal path.
- Pool sizes are adaptive instead of fixed at `200/200`.
- Benchmarks show equal-or-better quality and better latency.
