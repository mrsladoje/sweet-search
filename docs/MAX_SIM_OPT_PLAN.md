# MaxSim Optimization Plan

**Date:** 2026-03-23
**Status:** Deferred until profiling proves MaxSim is the bottleneck
**Origin:** Follow-up extracted from the completed rescoring workstream

---

## Goal

Optimize late-interaction MaxSim only if Stage 2 and Stage 2.5 are no longer the dominant cost.

This is not a continuation of the rescoring fix. It is a separate performance workstream.

---

## Trigger

Only start this work if profiling shows `scoreWithLateInteraction()` or `maxSimScore()` is a material share of end-to-end latency.

Do not optimize MaxSim based on intuition alone.

Current repository guidance points the other way:

- `docs/LATE_INTERACTION.md` says PLAID-style acceleration is not needed at our reranking scale.
- `docs/TODO.md` treats MaxSim over the current candidate set as effectively microsecond-level arithmetic.
- The rescoring work already fixed the more likely Stage 2 / Stage 2.5 bottlenecks.

---

## Current Path

The current MaxSim implementation is in:

- `core/late-interaction-index.js`
  - `maxSimScore()`
  - `scoreWithLateInteraction()`

Current behavior is straightforward brute-force late interaction:

1. For each query token
2. Score against every document token
3. Keep the max similarity
4. Average across query tokens

This is simple, exact, and correct for the current reranker role.

---

## Candidate Work

### 1. Candidate Pruning Before MaxSim

Reduce how many candidates reach late interaction at all.

Examples:

- tighter post-expansion caps
- confidence gating before LI
- better filtering for candidates missing meaningful LI signal

Expected benefit:

- Small to moderate end-to-end win if candidate counts drift upward
- Lower risk than changing MaxSim internals

### 2. Query Token Pruning

Drop low-value query tokens before late interaction scoring.

Examples:

- punctuation / syntax-only token filtering
- stop-token pruning
- token budget caps for long natural-language queries

Expected benefit:

- Moderate MaxSim speedup on long queries
- Some quality risk if token importance is estimated poorly

### 3. Document Token Pruning

Reduce document-token work before exact MaxSim.

Examples:

- skip low-value document tokens
- prune by token importance
- store compact summaries for early rejection

Expected benefit:

- Moderate to strong MaxSim-stage win on long documents
- Higher implementation and quality risk than simple candidate-count tuning

### 4. Block-Max MaxSim Early Termination

This is the strongest concrete option already described elsewhere in the repo.

Reference:

- `docs/PROBABILISTIC_PLAN.md` — "Fix 5: Block-Max MaxSim Early Termination"

Approach:

1. Partition document tokens into fixed-size blocks at index time
2. Store per-block upper-bound metadata
3. Score high-potential blocks first at query time
4. Stop once remaining blocks cannot improve the current max

Expected impact from the existing plan:

- roughly `2-5x` speedup on the MaxSim stage for long documents
- zero accuracy loss if the pruning is implemented as a true safe upper-bound

Best fit:

- longer documents
- larger rerank pools
- workloads where LI starts dominating after earlier stages are optimized

### 5. SIMD / WASM MaxSim Kernel

Add a dedicated WASM kernel for MaxSim math instead of the current JS loops.

References already noted in repo planning:

- NumKong
- `maxsim-cpu`

Expected benefit:

- modest win at current reranking scale
- more relevant if candidate counts regularly exceed 100 or if dequantization dominates

### 6. PLAID / EMVB / ColBERT-Style Acceleration

Treat these as strategic options, not immediate work.

Repository guidance already says this is usually the wrong optimization for the current architecture:

- Sweet Search uses late interaction as a reranker, not a full-corpus retriever
- PLAID-scale infrastructure is built for much larger candidate spaces
- at current scale the routing/compression overhead can outweigh the scoring savings

Use this only if one of these becomes true:

- monorepo-scale corpora
- LI promoted to first-stage retrieval
- shared-index interop with ColGrep or another multi-vector system becomes a product goal

---

## Recommended Order

1. Measure MaxSim stage cost directly
2. Tune candidate counts before touching internals
3. Prototype block-max early termination
4. Evaluate a WASM MaxSim kernel only if profiling still justifies it
5. Revisit PLAID-style infrastructure only for much larger scale or architectural change

---

## Benchmark Plan

Before implementation:

- log MaxSim latency per query
- log MaxSim latency per candidate
- break down by candidate count
- break down by query token count
- break down by document token count
- confirm whether dequantization or scoring dominates

During A/B evaluation:

- compare total query latency p50 / p95
- compare isolated MaxSim latency
- compare candidate counts entering LI
- assert ranking parity or bounded quality deltas
- for safe-pruning variants, require exact score equality

---

## Decision Gates

Promote MaxSim optimization only if all are true:

- profiling shows MaxSim is a real bottleneck
- isolated MaxSim speedup is measurable
- end-to-end latency improves materially
- ranking quality is unchanged or explicitly within tolerance
- complexity is justified by the observed win

Do not promote if the result is only a faster micro-benchmark with no real search impact.

---

## Non-Goals

- Do not reopen the completed rescoring workstream
- Do not mix MaxSim optimization with new reranker policy changes
- Do not introduce PLAID-scale infrastructure without clear scale pressure

---

## Practical Recommendation

As of now, the right default is to defer this work.

If profiling later shows MaxSim is the hot stage, start with Block-Max MaxSim early termination. It is the clearest path to a real gain without changing ranking semantics.
