# Benchmark TODO — Post-MaxSim Reranker Investigation

## Current Best: 84.48% MRR (GenCodeSearchNet, 6000 queries)

3-class CatBoost WASM router (LEXICAL/SEMANTIC/HYBRID) + LateOn-Code MaxSim reranker.
Structural mode is opt-in only via `--structural` flag. No regex auto-detection in router.

### GenCodeSearchNet Results (2026-05-01, 6000 queries, 6 languages, post LI-skip-fix + corpus hash-collision fix)

| Language | MRR@10 | Recall@5 | Recall@20 |
|----------|--------|----------|-----------|
| Python | 97.3% | 99.0% | 99.0% |
| Go | 94.7% | 98.0% | 98.7% |
| Java | 84.5% | 93.9% | 96.5% |
| PHP | 77.7% | 89.6% | 94.2% |
| JS | 77.4% | 86.8% | 89.6% |
| Ruby | 75.3% | 85.4% | 89.6% |
| **Overall** | **84.48%** | **92.12%** | **94.60%** |

### Delta vs Pre-Fix Baseline (2026-04-23, pre LI-fix + pre-R1)

| Language | Apr 23 | May 1 | Δ |
|----------|--------|-------|---|
| Python | 93.13% | 97.34% | +4.21 |
| Go | 94.61% | 94.70% | +0.09 |
| Java | 82.31% | 84.47% | +2.16 |
| Ruby | 74.29% | 75.31% | +1.02 |
| PHP | 78.44% | 77.69% | -0.75 |
| JS | **68.94%** | **77.40%** | **+8.46** |
| **Overall** | **81.95%** | **84.48%** | **+2.53** |

The +2.53 pp combines two fixes: (1) LI skip-policy unification (`933bcf8`, Apr 30) which restored late-interaction reranking for large files, and (2) corpus-prep hash collision fix in `eval/lib/corpus.js` which recovered 218 docs (111 JS, 69 Java, 31 Go, 5 PHP, 2 Python) that were silently overwritten by sequential-doc-id hash prefix collisions.

### Earlier Reference: 2026-03-12 Run (80.8% MRR, before LI fix and corpus fix)

| Language | MRR@10 | NDCG@10 | Recall@5 | Recall@20 | Success@1 |
|----------|--------|---------|----------|-----------|-----------|
| Python | 92.0% | 93.0% | 95.8% | 97.4% | 88.0% |
| Go | 94.2% | 94.8% | 97.7% | 98.8% | 91.4% |
| Java | 80.9% | 83.3% | 88.9% | 93.5% | 74.9% |
| Ruby | 73.7% | 77.0% | 82.8% | 87.8% | 66.5% |
| PHP | 75.9% | 79.6% | 86.6% | 91.5% | 68.0% |
| JS | 67.8% | 70.9% | 75.3% | 81.7% | 60.8% |
| **Overall** | **80.8%** | **83.1%** | **87.9%** | **91.8%** | **75.3%** |

### Delta vs Previous (4-class router, 2026-03-06)

| Language | MRR@10 old | MRR@10 new | Delta |
|----------|-----------|-----------|-------|
| Python | 90.5% | 92.0% | **+1.5** |
| Go | 93.6% | 94.2% | +0.6 |
| Java | 79.1% | 80.9% | **+1.8** |
| Ruby | 73.1% | 73.7% | +0.6 |
| PHP | 76.0% | 75.9% | -0.1 |
| JS | 66.0% | 67.8% | **+1.8** |
| **Overall** | **79.7%** | **80.8%** | **+1.1** |

Root cause of improvement: 87 NL queries were misrouted to structural (graph DB → 0 results).
3-class router eliminates this failure mode entirely.

## What Could Push Past 79.7%

### 1. ~~Confidence-Gated CE Rescue~~ — REMOVED (2026-05, after neutral lift)
- Implemented multi-signal gate + adaptive-K + window-scoped merge
- Fixed critical LI token bug (`Float32Array.flat()`) → MaxSim now works → +1.23pp MRR
- With fixed MaxSim (83.2%), gte-reranker-modernbert-base CE showed **zero lift** on GenCodeSearchNet
- CE reranker has been fully phased out of the pipeline
- See `docs/CE_RESCUE_PLAN.md` for the original benchmark results

### 2. Per-Language / Per-Query-Type Routing
- Go is 93.6% — nearly saturated
- JS is 66% — lots of room
- Optimal reranking strategy differs: Go (short, distinctive identifiers) vs JS (generic names, heavy boilerplate)
- Even crude language-aware CE escalation threshold could help weak languages without hurting strong ones

### 3. ~~Larger Retrieval Pool for Weak Languages~~ — TESTED, ANSWERED
- **RESULT**: JS is retrieval-limited, NOT reranking-limited
- Recall@200 = 80.6% (194/1000 misses). Recall plateaus at 100→200 (+0.2pp only)
- Going beyond top-100 candidates won't help — the docs simply aren't in the embedding neighborhood
- See "JS Recall Diagnostic" section below for details

### Skip for Now
- **RRF in hybrid fusion**: CC approach with RRF fallback beat pure RRF in every benchmark — not worth revisiting
- **Meta-ranker / LTR**: Highest ceiling but needs training data + whole new subsystem
- **Universal alpha hunt**: Dead end, proven empirically

---

## JS / PHP / Ruby Weakness Analysis

### Tree-Sitter Chunking: Solid But Not SOTA

| Language | Parser | Strategy | Issues |
|----------|--------|----------|--------|
| JS | Tree-sitter + regex fallback | Brace-based | Template literal complexity, cross-line fragile |
| PHP | Tree-sitter + regex fallback | Brace-based | No cross-line support for multi-line signatures |
| Ruby | Tree-sitter + regex fallback | End-keyword | Block keyword nesting fixed, but `?`/`!` method suffixes basic |

- Max chunk size 2000 chars across all languages — might be too small for JS (React components with JSX)
- Parent metadata (`parent_symbol`, `parent_type`) is populated — but unclear if embedding model sees it in `embedding_text`

### LateOn-Code (MaxSim Model) on Weak Languages
- Claims CSN MRR 90.40% — but CSN JS subset is notoriously noisy (jQuery-era, minified)
- PHP is smallest CSN subset, Ruby is tiny
- Late interaction model likely **weakest on exactly PHP and modern JS patterns** (arrow fns, destructuring, hooks)

### ~~Voyage Code 3: Potentially Stronger for Weak Languages~~ — TESTED, NO IMPROVEMENT (March 2026)
- Benchmarked Voyage Code 3 at both 512d and 1024d HNSW on GenCodeSearchNet
- **Result**: identical MRR (83.5%) and JS recall (84.2%@20) to local CodeRankEmbed
- Also tested 1024d + asymmetric binary quantization — no improvement
- Voyage adds API latency and cost but no quality gain on this benchmark
- See `docs/BENCHMARKING.md` for full experiment matrix

### ~~Suspicion~~ → Confirmed → ~~Retrieval-Limited~~ → PARTIALLY FIXED (March 2026)
JS recall@200 improved from 80.6% → 86.5% (+5.9pp) via HNSW optimization plan.
Plateau broken — recall now keeps climbing from @100 to @200.
Remaining ~13.5% misses are embedding quality / dataset noise, not HNSW.

---

## Testing Priority (Ordered)

1. ~~**Recall check**~~: **DONE** — JS is retrieval-limited. 80.6% recall@200, plateau after top-100.
2. ~~**CE rescue shadow analysis**~~: **DONE** — CE reranker fully phased out (2026-05).
   Shadow analysis showed zero lift from gte-reranker-modernbert-base; rather than swap to
   another CE model, the entire CE rescue path was removed from the pipeline.
3. ~~**Voyage Code 3 as embedding benchmark**~~: **DONE** — no quality improvement over CodeRankEmbed (83.5% vs 83.5% MRR). Tested at 512d and 1024d HNSW. See `docs/BENCHMARKING.md`.
4. **Chunk context bleeding**: Still worth checking for the ~20% of retrievable-but-poorly-ranked JS queries.
5. **2000 char limit for JS**: Still worth checking — could explain some of the 194 misses.
6. **Benchmark quality audit**: Filter GenCodeSearchNet JS noise (copyright queries, non-English, zero-signal). Measure "clean MRR" on the ~850 valid queries.
7. **Try COIR JS subset**: Cleaner benchmark for JS — may give more actionable signal than GenCodeSearchNet.
8. ~~**Benchmark lateon-code-edge as reranker**~~: **DONE 2026-05-03 — DO NOT ADOPT for quality.**
   Native Metal/CoreML/CUDA parity built (multi-stage projection in Rust addon, separate
   `coreml-cascade/li-edge/` cascade dir, edge variants published to HF
   `mrsladoje/sweet-search-coreml-cascade/li-edge/`). Full 6000-query gencodesearchnet:
   MRR@10 = **80.63%** (vs 84.48% standard baseline, **−3.85 pp**). Losses concentrated
   exactly on the weak languages this was supposed to help: JS −7.3 pp, PHP −6.3 pp, Java
   −5.6 pp, Ruby −3.2 pp. The smaller 256d × 7-layer backbone with 48d output is not
   enough capacity for the harder languages. Edge could still make sense for storage-bound
   use cases (~37% the LI token storage, ~10% the FP32 backbone), but standard
   `lateon-code` remains the quality choice. See "lateon-code-edge benchmark" section
   below for full per-language numbers.

---

## JS Recall Diagnostic

### After HNSW Optimization (2026-03-23, M=64/efC=800/efS=400, heuristic selection, shuffled insertion)

Ran 1000 JS queries with `scripts/stage1-recall.js`:

```
Recall@10    76.2%
Recall@50    81.2%
Recall@100   83.4%  (+2.8pp vs old)
Recall@200   86.5%  (+5.9pp vs old, plateau broken)
Recall@500   89.6%
Recall@1000  91.9%
ANN fidelity@200: 97.4%

Total misses (not in top-200): ~135/1000 (was 194)
```

### Original Diagnostic (2026-03-08, M=32/efC=400/efS=200, simple closest-M, sequential insertion)

```
Recall@10   72.7%  (727/1000)
Recall@20   77.7%  (777/1000)
Recall@50   80.4%  (804/1000)
Recall@100  80.6%  (806/1000)
Recall@200  80.6%  (806/1000)  ← hard plateau

Total misses (not in top-200): 194/1000
```

### Miss Categories (from 20 samples)

| Category | Examples | Fixable? |
|----------|----------|----------|
| **Garbage queries** | "Copyright IBM Corp. 2016, 2018" → `flatMapAsync.js` | No — dataset noise |
| **Non-English** | "ripristino stato iniziale" → `resetToMove.js` | No — model limitation |
| **Zero semantic signal** | "This is where the action is." → `runmath.js` | No — no system can solve this |
| **Cross-language ambiguity** | "Initializes the plugin" → PHP initializers win | Maybe — language-scoped retrieval |
| **Empty results** | `requireBrocfile`, `isArrayBufferView` → 0 candidates | Maybe — indexing gap |
| **Ultra-vague** | "code for + and -" → matches everything | No — inherently ambiguous |

### Root Cause: CatBoost Router Misclassification (2026-03-09)

The "empty results" misses (`isArrayBufferView`, `processLoadedTexture`, `requireBrocfile`) are NOT indexing gaps.
All three files exist in the HNSW index and are **rank #1 in hybrid mode**.

**The CatBoost WASM query router misclassifies NL queries as `structural`.**
Structural mode does a graph DB entity lookup → returns 0 results for NL queries.

- 87/6000 queries across all languages misrouted to structural (1.4%)
- JS: 24/1000, Java: 24/1000, Python: 17/1000, Ruby: 10/1000, Go: 7/1000, PHP: 5/1000
- All 87 are false positives from CatBoost — the regex structural patterns produced zero false positives
- Trigger words: "instance", "Creates", "Returns", "type", "view" overlap with code vocabulary

**This inflates the recall diagnostic numbers.** 24 of the 194 JS "misses" were queries the system can already answer — they were just routed to the wrong search path.

### Conclusion (revised)

The recall diagnostic numbers are partially contaminated by the routing bug. True retrieval misses are ~170/1000, not 194/1000. The remaining misses are a mix of cross-language ambiguity, weak embeddings for vague queries, and some genuine dataset noise.

---

## DONE: Retrain CatBoost Router (2026-03-09)

Retrained CatBoost from 4-class → 3-class (LEXICAL/SEMANTIC/HYBRID). Structural removed from ML model.
Structural mode is opt-in only via `--structural` flag (MCP `structural: true`).

- **WASM speed**: p50=2.6us, p95=16.9us, p99=22.4us (well under 1ms)
- **JS fallback**: ~50us
- **Model**: 498 trees, depth 4, 196KB WASM binary
- **Router accuracy**: 95.1% utility on 255-query eval set (English)
- **Benchmark impact**: +1.1pp MRR@10 overall on GenCodeSearchNet (80.8%)

---

## DONE: Translation Fallback — Removed (2026-04-07, benchmarked 2026-03-19)

OPUS-MT translation (21 language pairs, int8 quantized MarianMT) was implemented and
benchmarked extensively on GenCodeSearchNet (6000 queries) and M2CRB (2814 multilingual queries).

### Key Findings

1. **CodeRankEmbed is multilingual enough.** French/Portuguese/Spanish queries achieve 86% MRR
   against same-language code without any translation. The embedding model handles Romance
   languages natively.

2. **Translation adds zero quality and significant latency.** M2CRB A/B test:
   translate ON = translate OFF = 56.9% MRR, but ON was 2x slower.

3. **Translation gate had two bugs** (both fixed):
   - Late interaction reranker set `score=0` on all results, making the "good results"
     gate permanently open (translation fired on 100% of queries)
   - `hasValidFile` check missed `metadata.file`/`metadata.name` fields

4. **Right architecture**: Instruct the LLM (via CLAUDE.md) to query in the codebase's
   natural language. Translation fallback has been fully removed — the embedding model handles
   multilingual input natively.

### Benchmark Results (Full Profile, lateon-code)

**GenCodeSearchNet (6000 queries, all English):**
| Metric | Translate ON | Translate OFF |
|--------|-------------|---------------|
| MRR@10 | 81.05% | **81.93%** |
| Total time | 1560s | **552s** |

**M2CRB (2814 queries, FR/PT/ES/DE):**
| Metric | Translate ON | Translate OFF |
|--------|-------------|---------------|
| MRR@10 | 56.90% | 56.90% |
| Total time | 505s | **360s** |

---

## DONE: lateon-code-edge benchmark — initial run (SUPERSEDED, see Phase 3 post-fix)

> **Numbers in this section were measured on a code path that contained a
> file-kind-ranking regression (`f6fcfd1`, fixed in `e6f5bd4`).** They are
> retained for historical context, but the current verdict is in the
> "Phase 3 — Honest sweep before v2.5.0 (post-fix re-run)" section
> further below. Post-fix summary: standard `lateon-code` + LI on remains
> the accuracy default at **85.57% MRR**; edge LI is best deployed as
> "edge index + search rerank OFF" (= **82.91% MRR**, identical to
> standard-no-LI, with 60% less disk + 25% faster indexing) for
> constrained machines that still need read-semantic / ColGrep.

`lateon-code-edge` (256d backbone × 7 layers, 2-stage projection 256→512→48, 48d output)
gained full native acceleration (Metal candle, CoreML cascade, CUDA candle) so the
benchmark could run apples-to-apples with the standard `lateon-code` baseline (768d × 22
layers, 1-stage 768→128, 128d output). Shipping changes (all backward compatible —
standard variant unaffected):

- Rust addon `NativeLateInteractionModel.load()` generalised to `Vec<String>` projection
  paths + `Vec<u32>` projection dims (validated against safetensors shape on load); fold
  applies stages sequentially in `LiEncodeTask::compute`. Backbone dim already came from
  config.json so 256d worked without further changes.
- JS `resolveNativeLiVariant()` reads `LATE_INTERACTION_CONFIG.activeModel` and routes to
  the right registry key (`lateon-code-fp32` vs `lateon-code-edge-fp32`). Per-variant
  cache `Map` replaces module-scope singletons.
- CoreML cascade: third top-level `liEdge` section in `coreml-cascade.json`, separate
  on-disk dir `coreml-cascade/li-edge/`, separate filename prefix `li_modernbert_edge_b…`
  parsed by Rust addon. Six edge variants traced + published to HF
  `mrsladoje/sweet-search-coreml-cascade/li-edge/` (~31 MB each, total ~189 MB; vs ~275
  MB each for standard because edge backbone is way smaller). CoreML parity check passed
  at cosine 0.999601 ≥ 0.998.

### Results (Full Profile, 6000 queries, gencodesearchnet)

| Language | Standard `lateon-code` (May 1) | Edge `lateon-code-edge` (May 3) | Δ |
|----------|--------------------------------|----------------------------------|---|
| Python | 97.3% | 97.2% | -0.1 |
| Go | 94.7% | 94.2% | -0.5 |
| Java | 84.5% | 78.9% | **-5.6** |
| PHP | 77.7% | 71.4% | **-6.3** |
| JS | 77.4% | 70.1% | **-7.3** |
| Ruby | 75.3% | 72.1% | **-3.2** |
| **Overall MRR@10** | **84.48%** | **80.63%** | **-3.85** |
| Recall@5 | 92.12% | 90.62% | -1.50 |
| Recall@20 | 94.60% | 94.55% | -0.05 |
| Total query time | — | 1297s (~216 ms/query) | — |
| Latency p50 | — | 1073 ms | — |
| Latency p95 | — | 2955 ms | — |

### Verdict

**Do not adopt edge as default.** Edge regresses MRR@10 by 3.85 pp overall, with losses
concentrated exactly on the languages this experiment was supposed to help: JS −7.3 pp,
PHP −6.3 pp, Java −5.6 pp, Ruby −3.2 pp. Python and Go are essentially flat (within
0.5 pp). The smaller backbone (256d vs 768d, 7 layers vs 22, output 48d vs 128d) doesn't
have enough capacity for the harder languages — exactly the failure mode the smaller
parameter count predicts. Recall@20 holds up better (-0.05 pp) so the candidate pool is
fine; the dim collapse loses ranking precision among already-retrieved candidates.

### When edge could still make sense

- Storage-constrained deployments: edge LI tokens are 48d × 4B = 192 B/token vs 128d ×
  4B = 512 B/token (~37%). FP32 backbone is 67 MB vs 596 MB (~11%).
- Mobile / edge devices where the smaller model fits in hot RAM.
- Both paths remain shipped — toggle via
  `SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge` or
  `--late-interaction-model=lateon-code-edge`.

### Reproducibility

```bash
# Edge
SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge \
  node eval/run_benchmark.js --dataset=gencodesearchnet \
  --sqlite-fast --concurrency=12 --late-interaction-model=lateon-code-edge

# A/B with cascade off (verifies CoreML cascade is parity-correct, not lossy)
SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge \
  SWEET_SEARCH_COREML_CASCADE=0 node eval/run_benchmark.js \
  --dataset=gencodesearchnet --sqlite-fast --concurrency=12 \
  --late-interaction-model=lateon-code-edge
```

---

## Phase 3 — Honest sweep before v2.5.0 (2026-05-03, post-fix re-run)

> ## ✅ CLEAN RE-RUN AFTER TWO UPSTREAM FIXES (2026-05-03 evening)
>
> The earlier SUSPECT block in this section reported standard `lateon-code`
> + LI on at 51.60% MRR (vs the historical 85% baseline). That regression was
> root-caused and fixed in two follow-up commits on `main`:
>
> - **`e6f5bd4`** *fix(ranking): make file-kind scoring conservative* —
>   added confident-intent gating, structural skip, and window-bounded
>   re-sort to `core/ranking/file-kind-ranking.js`. The previous full-list
>   re-sort was floating int8-only tail items above the LI-reranked head.
> - **`f55147b`** *fix(embedding): guard query vocabulary cache usage* —
>   added schema-version fingerprint check, `SWEET_SEARCH_VOCAB_USE` kill
>   switch, and `SWEET_SEARCH_VOCAB_MAX_TERMS` cap. Prevents stale cached
>   embeddings (which had drifted enough to shift MRR by ~1 pp) and
>   bench-iteration vocab bloat. Eval harness now defaults vocab OFF for
>   reproducibility.
>
> All Phase 3 numbers below are from a clean re-run with both fixes in
> place, vocab off-by-default, harness defaults (`stage3=15`,
> `graphExpand=none` — these ARE the optimal-for-gencodesearchnet config),
> `--concurrency=12`, fresh standard + fresh edge indexes.
>
### Hardware + harness

- M3 Max (16 cores, 128 GB RAM)
- Native CoreML cascade present for both standard and edge LI (parity ≥ 0.999)
- Edge LI native build verified end-to-end (Metal candle + CoreML cascade route to `coreml-cascade/li-edge/`)
- Phase 2 release smoke green
- Harness defaults (post-`f55147b`): `stage3=15`, `graphExpand=none`,
  `SWEET_SEARCH_VOCAB_USE=0`, `SWEET_SEARCH_VOCAB_AUTO_EXPAND=0`. These
  ARE the gencodesearchnet-tuned defaults — no overrides used.

### Run matrix (gencodesearchnet, 6000 queries, --sqlite-fast --concurrency=12)

| Run | Index | LI rerank | MRR@10 | NDCG@10 | Recall@5 | Recall@10 | Recall@20 | Errors | p50 | p95 | Index time | Disk |
|-----|-------|-----------|--------|---------|----------|-----------|-----------|--------|-----|-----|-----------|------|
| **A** | standard fresh | on (standard) | **85.57%** | 87.60% | 92.42% | 93.73% | 94.58% | 0 | 227 ms | 256 ms | (--skip-index) | 656 MB |
| **A_v2** (repro) | standard fresh | on (standard) | 85.56% | 87.60% | 92.40% | 93.72% | 94.58% | 0 | 241 ms | 273 ms | 661 s | 656 MB |
| **B** | edge fresh | on (edge) | **80.65%** | 83.81% | 90.63% | 93.48% | 94.58% | 0 | 157 ms | 173 ms | 516 s | 266 MB |
| **D** | edge (re-use B) | **off** | **82.90%** | 85.37% | 90.55% | 92.95% | 94.58% | 0 | 105 ms | 121 ms | (skip-index) | 266 MB |
| **E** | standard (re-use A_v2) | **off** | **82.91%** | 85.38% | 90.57% | 92.97% | 94.58% | 0 | 121 ms | 142 ms | (skip-index) | 656 MB |
| **C** | balanced (no LI built) | **n/a** | _not run — pre-existing indexer hang on no-LI path; D ≈ E proves index choice is irrelevant when LI is off, so C would land at the same ~82.9% MRR_ | | | | | | | | | |

A and A_v2 reproduce within 0.01 pp — numbers are deterministic with the
new vocab guards.

### Per-language MRR@10

| Run | Python | JS | Go | Ruby | Java | PHP | Average |
|-----|--------|-----|-----|------|------|-----|---------|
| **A** (standard + LI on) | 97.1% | 77.0% | 95.0% | 77.3% | 86.1% | 80.9% | **85.57%** |
| **B** (edge + LI on)     | 97.3% | 70.1% | 94.2% | 72.0% | 78.9% | 71.4% | **80.65%** |
| **D** (edge + LI off)    | 93.3% | 74.1% | 94.5% | 74.5% | 83.0% | 78.0% | 82.90% |
| **E** (std + LI off)     | 93.3% | 74.1% | 94.5% | 74.5% | 83.0% | 78.0% | 82.91% |

D and E are bit-identical per-language → confirms architectural property
that search ranking is independent of which LI tokens were stored when
`useLateInteraction=false`.

### Indexing time + disk footprint

| Index | Index time | Total `.sweet-search/` | LI tokens portion |
|-------|------------|------------------------|-------------------|
| Standard (`lateon-code`) | 661 s (~11 min) | 656 MB | ~318 MB |
| Edge (`lateon-code-edge`) | 516 s (~9 min) | 266 MB | ~155 MB |

Edge saves ~2.5 min indexing time and ~390 MB total disk (~163 MB on the
LI portion alone) vs standard.

### Findings

1. **Standard LI rerank is net positive on this benchmark.** A (85.57%) >
   E (82.91%) by **+2.66 pp** MRR. Standard LI rerank is doing useful
   reordering — Recall@5 lifts from 90.57% → 92.42%, Success@1 from
   77.00% → 80.23%.
2. **Edge LI rerank is net negative.** D (82.90%) > B (80.65%) by
   **+2.25 pp** MRR. Even on the same edge-indexed corpus, turning off
   the edge LI rerank IMPROVES results — edge's 48d tokens are too lossy
   for this benchmark's quality bar. Notably edge LI helps Python a bit
   (97.3% vs 93.3% no-LI = +4.0) but loses on JS (-4.0), Java (-4.1),
   Ruby (-2.5), and PHP (-6.6).
3. **Standard beats edge with LI on.** A (85.57%) > B (80.65%) by
   **+4.92 pp** MRR. Per-language: standard wins everywhere except a
   ~tie on Python and Go.
4. **Index choice is irrelevant when LI off.** D ≈ E (within 0.01 pp,
   per-lang exact match). So choosing standard vs edge for the LI INDEX
   is purely about disk + indexing time + read-semantic/ColGrep quality
   (the latter not benchmarked here).
5. **Edge LI rerank should not be exposed as a search-side default.**
   Even on its own index, no-LI beats edge-LI by 2.25 pp. The smaller
   token dim cannot carry enough ranking signal to compete with edge's
   own backbone-only retrieval signal.

### Product recommendation (v2.5.0 init)

| Choice | Default? | Description |
|--------|----------|-------------|
| **Standard `lateon-code` LI + search rerank ON** | Yes (capable machines) | Accuracy default at **85.57% MRR**. Larger backbone (596 MB FP32 model), 656 MB on-disk index, ~11 min to index. Read-semantic + ColGrep both supported with full LI quality. |
| **Edge `lateon-code-edge` LI + search rerank OFF** | Yes (constrained machines) | Best constrained-machine package: search ranking falls to **82.91% MRR** (the no-LI floor, identical to standard-no-LI), but disk is 266 MB (vs 656 MB) and indexing 9 min (vs 11 min). Edge LI tokens are still built, so read-semantic + ColGrep work. **Recommended over edge-with-LI-rerank** because turning edge LI rerank ON costs another 2.25 pp without disk/time benefit. |
| **Edge `lateon-code-edge` LI + search rerank ON** | No (NOT recommended) | 80.65% MRR — worse than the no-LI floor on the same index. Edge's 48d tokens are too lossy for search rerank on this benchmark. Keep available behind explicit user choice (some queries may benefit; not the default). |
| **No LI built at all** | No (escape hatch only) | Smallest disk (~111 MB est.), fastest indexing. Breaks read-semantic + ColGrep. Document loudly. The no-LI indexer also currently hangs on `--profile=balanced` (pre-existing bug, see below). |

### Reproducibility

```bash
# A — standard fresh re-index + LI on (canonical baseline)
SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code \
  node eval/run_benchmark.js --dataset=gencodesearchnet \
  --sqlite-fast --concurrency=12 --late-interaction-model=lateon-code

# B — edge fresh re-index + LI on (mv .sweet-search aside first)
SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge \
  node eval/run_benchmark.js --dataset=gencodesearchnet \
  --sqlite-fast --concurrency=12 --late-interaction-model=lateon-code-edge

# D — same edge index, LI rerank off
SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge \
  node eval/run_benchmark.js --dataset=gencodesearchnet \
  --sqlite-fast --concurrency=12 --late-interaction-model=lateon-code-edge \
  --skip-index --use-late-interaction=false

# E — same standard index, LI rerank off
SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code \
  node eval/run_benchmark.js --dataset=gencodesearchnet \
  --sqlite-fast --concurrency=12 --late-interaction-model=lateon-code \
  --skip-index --use-late-interaction=false
```

The harness defaults `SWEET_SEARCH_VOCAB_USE=0` and
`SWEET_SEARCH_VOCAB_AUTO_EXPAND=0` (per `f55147b`) so vocabulary cache
state cannot pollute results across iterations.

### Open / blockers / follow-ups for v2.5.0

- **Indexer hang on no-LI path.** `--profile=balanced` (and equivalent
  `--build-late-interaction=false --use-late-interaction=false`) blocks
  in the indexer with worker threads stuck on `uv_cond_wait`, no disk
  progress past the initial 12 MB graph DB. Pre-existing bug, not edge
  related, but blocks any future "no LI built at all" deployment path.
  Worth a separate issue.
- **`prepareCorpus` wipes `.sweet-search.*` siblings.** The harness's
  corpus prep step deletes adjacent dotfile-prefixed dirs (cost me two
  rounds of standard re-indexing during this sweep when I had backed up
  indexes aside). Should leave dotfile siblings alone. Worth a separate
  issue.
- **stage3=15+graphExpand=none vs production stage3=30+graphExpand=auto.**
  All Phase 3 numbers are at the harness defaults, which the upstream
  diagnostic confirms ARE the gencodesearchnet-optimal config. Production
  defaults remain `stage3=30 + graphExpand=auto` for real codebases —
  this is intentional, the harness diverges to measure dense MRR
  cleanly. No re-run with production defaults needed for the
  edge-vs-standard decision; the harness defaults are the fair test.
- **Read-tool ranking quality not benchmarked here.** This sweep measures
  search ranking only. Edge's read-semantic + ColGrep functional
  correctness is proven by the Phase 2 release smoke
  (`tests/release/lateon-code-edge-e2e.test.js`) but not measured for
  ranking quality on a real corpus. If we want a quality number for
  read-tools, a separate harness run on read-semantic + ColGrep is
  needed. The architectural finding (D = E) suggests read-tool quality
  with edge LI tokens should be similar to standard LI tokens for the
  same downstream consumers, modulo the 48d vs 128d expressiveness
  difference, which is itself the same trade-off measured on search.

