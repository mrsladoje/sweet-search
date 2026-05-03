# Adaptive vs fixed candidate sizing — what's where

(Snapshot 2026-05-02. Source files: `core/search/search-semantic.js`,
`core/search/search-postprocess.js`, `core/ranking/cascaded-scorer.js`,
`core/infrastructure/config/vector-store.js`,
`core/infrastructure/config/ranking.js`.)

| Stage | Path | Sizing today | Where |
|-------|------|--------------|-------|
| 1. Binary HNSW   | `semanticSearch3Stage` | **Fixed** = `stage1Candidates` (default 1000) | `search-semantic.js:179` |
| 2. Int8 rescore  | `semanticSearch3Stage` | **Adaptive** — `adaptiveStage2Pool(k, scoreSpread)`, range `[40 .. 400]`, base `k×10`, score-spread shrinks/widens | `search-semantic.js:92,213` |
| 2.5 Float rescore | `semanticSearch3Stage` | **Adaptive** — `adaptiveStage2_5Pool(k, scoreSpread)`, range `[20 .. 200]`, base `k×5`, decisive shrinks | `search-semantic.js:119,284` |
| 3. CE rerank (3-stage path) | `semanticSearch3Stage` | **Fixed** = `stage3Candidates` (default 20). `scoredCandidates.slice(0, this.stage3Candidates)` | `search-semantic.js:413` |
| 3. Legacy LI rerank (cascade-off, post-expansion) | `applyPostRetrieval` | **Fixed** = `liPoolSize ?? stage3Candidates ?? 20`. Mixed pool of top originals + top expanded. | `search-postprocess.js:271–278` |
| 3. Cascade MaxSim (cascade-on) | `cascadedScore` | **Unbounded** — MaxSim runs over **every** candidate that has LI tokens, no slicing. | `cascaded-scorer.js:218–227` |
| 3. Cascade CE   | `cascadedScore` | **Adaptive** — `computeAdaptiveK(scores, kMax=ceTopK=20, kMin=3)` chooses 3..20 candidates from the ranked pool based on score gap | `cascaded-scorer.js:86–110, 263` |

Defaults live in `core/infrastructure/config/vector-store.js`:

```js
retrieval: {
  stage1Candidates: 1000,   // Stage 1 — fixed
  stage2Candidates: 200,    // legacy fallback (unused under adaptive)
  stage2_5Candidates: 200,  // legacy fallback
  stage3Candidates: 20,     // ← the only stage 3 knob (CE rerank + legacy LI)
  adaptive: {
    minStage2: 40, maxStage2: 400, oversample1: 10,
    minStage2_5: 20, maxStage2_5: 200, oversample2: 5,
  },
},
```

Cascade defaults live in `core/infrastructure/config/ranking.js`:

```js
CASCADE_CONFIG = {
  enabled: false,            // SWEET_SEARCH_CASCADE_ENABLED=true to opt in
  gateThreshold: 0.08,
  ceTopK: 20,                // adaptive K cap for CE rerank
  forceFullCrossEncoder: false,
  shadowMode: false,
}
```

## What `stage3Candidates` actually controls

It's used in **two** places:

1. **3-stage semantic CE rerank pool** — `topCandidates =
   scoredCandidates.slice(0, this.stage3Candidates)` before calling the
   reranker. This is the GCSN-relevant slice when cascade is off
   and a CE is available.
2. **Legacy LI rerank pool** (post-expansion, cascade-off) — through
   `liPoolSize ?? stage3Candidates`. This is the slice the graph-2hop
   sweep tested.

Bumping `stage3Candidates` 20→30 affects both. The graph-2hop sweep
validated path (1) only by proxy (graph queries; the harness uses LI but
no CE on those repos, so behaviour mirrors path (2)). The current
GCSN run validates path (1) — semantic CE rerank — directly.

## What's *not* tunable yet

- The **expansion budget** (`maxExpanded=10`, `hop2TokenBudget=4000`)
  inside `expandResults()`. This is what limits how many expanded
  entries can ever enter the pool, and it's the real bottleneck the
  graph-2hop sweep hit (~6 entries per affected query). Widening it
  is the next experiment to separate adaptive 2-hop from naive / 1-hop.

- The **cascade MaxSim pool**. Cascade scores all candidates with LI
  tokens unbounded; no slicing. The only cap inside cascade is the CE
  candidate count via `computeAdaptiveK`, capped at `ceTopK=20`.

- **Stage 1 candidate count** is fixed 1000. The adaptive sizing only
  applies to Stages 2 and 2.5.

## Implication for the default-change decision

Bumping the legacy rerank window 20→30 is straightforward. Bumping the
3-stage CE rerank pool to 30 is the thing GCSN must validate, because
that's where production cost-per-query lives. The CE typically rises
linearly in candidates: 30 vs 20 = 50 % more rerank cost at the slice
boundary. If MRR/R@10 don't improve on GCSN, the cost isn't worth it.
