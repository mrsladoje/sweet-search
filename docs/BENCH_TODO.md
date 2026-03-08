# Benchmark TODO — Post-MaxSim Reranker Investigation

## Current Best: Pure MaxSim Reranker (79.7% MRR)

LateOn-Code as a full reranker — no blending, no alpha mixing. This is the correct base architecture. Code not yet pushed.

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

### 3. Larger Retrieval Pool for Weak Languages
- JS at 66% — is the correct answer even in top-100 HNSW candidates?
- Test top-200 or top-300 for languages below 75% MRR
- Determines whether we're **recall-limited** or **precision-limited**

### 4. RRF in Hybrid Fusion Layer
- Separate knob from cascade alpha (already fixed)
- Route-specific, less likely to be as broken
- Smaller expected gain — test after #1 and #3

### 5. Skip for Now
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

### Suspicion
Mix of both: JS/PHP partially **recall-limited** (chunking loses context) AND **reranker-limited** (LateOn-Code trained on CSN-era JS).

---

## Testing Priority (Ordered)

1. **Recall check**: Is ground truth in top-100 HNSW candidates for JS/PHP/Ruby? Yes → reranker problem. No → retrieval problem.
2. **Voyage Code 3 as reranker benchmark**: Use Voyage rerank-2.5 on weak languages, compare to LateOn-Code MaxSim. Isolates whether late interaction model is the bottleneck.
3. **Chunk context bleeding**: Check `embedding_text` for JS chunks — if React component methods chunked without class name or file path prefix, embedding works blind.
4. **2000 char limit for JS**: Check how many JS chunks hit max and get split. If >30%, we're fragmenting context.
5. **Voyage rerank-2.5 as CE rescue for weak languages**: Quick win while chunking story gets sorted.
