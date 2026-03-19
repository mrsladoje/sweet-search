# Benchmark TODO — Post-MaxSim Reranker Investigation

## Current Best: 3-Class CatBoost Router + LateOnCode Reranker (80.8% MRR)

3-class CatBoost WASM router (LEXICAL/SEMANTIC/HYBRID) + LateOn-Code MaxSim reranker.
Structural mode is opt-in only via `--structural` flag. No regex auto-detection in router.

### GenCodeSearchNet Results (2026-03-12, 6000 queries, 6 languages)

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

### 1. Confidence-Gated CE Rescue (Highest Expected Value)
- CE alone hit 79.3% on 20+ candidates; MaxSim hit 79.7%
- They likely fail on **different queries** — union of both models' strengths
- Gate signal: MaxSim top-1 minus top-2 score gap (simple, natural)
- CE needs proper candidate pool (20-30, not 8)
- **Expected gain: +0.2–0.5pp**

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

### Voyage Code 3: Potentially Stronger for Weak Languages
- 1024d, code-optimized, claims 13-17% over OpenAI/CodeSage
- Trained on **modern code**, not just CSN
- Proper query/document asymmetry (`inputType: 'query'` vs `'document'`)
- Pipeline: Voyage retrieves → LateOn-Code reranks
- If Voyage recall is fine but LateOn-Code MaxSim weak on JS patterns → explains low MRR despite good candidates

### ~~Suspicion~~ → Confirmed: Retrieval-Limited
JS is **retrieval-limited**. 194/1000 ground truth docs not in top-200 HNSW at all.
Reranker is NOT the bottleneck for JS — it can only reorder the ~80% that are already retrieved.

---

## Testing Priority (Ordered)

1. ~~**Recall check**~~: **DONE** — JS is retrieval-limited. 80.6% recall@200, plateau after top-100.
2. **Voyage Code 3 as reranker benchmark**: Lower priority now — reranker isn't the JS bottleneck.
3. **Chunk context bleeding**: Still worth checking for the ~20% of retrievable-but-poorly-ranked JS queries.
4. **2000 char limit for JS**: Still worth checking — could explain some of the 194 misses.
5. **Benchmark quality audit**: Filter GenCodeSearchNet JS noise (copyright queries, non-English, zero-signal). Measure "clean MRR" on the ~850 valid queries.
6. **Try COIR JS subset**: Cleaner benchmark for JS — may give more actionable signal than GenCodeSearchNet.

---

## JS Recall Diagnostic (GenCodeSearchNet, 2026-03-08)

Ran 1000 JS queries with k=200, NO reranking, NO expansion.

```
Recall@10   72.7%  (727/1000)
Recall@20   77.7%  (777/1000)
Recall@50   80.4%  (804/1000)
Recall@100  80.6%  (806/1000)
Recall@200  80.6%  (806/1000)

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

## DONE: Translation Fallback — Benchmarked & Disabled by Default (2026-03-19)

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
   natural language. Translation fallback remains as a safety net for LLM language mismatches,
   but is now **off by default** (`enableTranslationFallback: false`).

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

### To re-enable

Set `enableTranslationFallback: true` in SweetSearch options or `SWEET_SEARCH_TRANSLATE=true` env var.
The fixed gate now correctly uses pre-reranking embedding scores, so translation only fires on
genuinely low-confidence queries.
