# CE Rescue Plan — Confidence-Gated Cross-Encoder Reranking

## Status: IMPLEMENTED (shadow mode default)

### Implementation Results (March 23, 2026)

All infrastructure implemented and benchmarked. CE rescue is **safe** (zero regression)
but shows **no MRR lift** over MaxSim on GenCodeSearchNet with gte-reranker-modernbert-base.
Defaulted to shadow mode to collect gate decision data.

**Critical bug found during implementation**: `Array.prototype.flat()` does not flatten
`Float32Array` elements in `late-interaction-index.js:add()`. All LI token buffers were
corrupted since initial implementation. Fixed — MaxSim now produces real scores, yielding
+1.23pp MRR (81.9% → 83.2%).

| Config | MRR@10 | Success@1 | p50 (ms) | Notes |
|--------|--------|-----------|----------|-------|
| Old baseline (broken LI) | 81.92% | 76.25% | 1,213 | MaxSim scores were all zeros |
| **Fixed LI baseline** | **83.15%** | **77.78%** | 1,403 | Real MaxSim — new production default |
| CE gated v1 (broken strategy) | 80.19% | 72.88% | 1,631 | adaptive-K=3 + harsh merge = -2.96pp |
| CE gated v2 (fixed strategy) | 83.15% | 77.78% | 1,748 | Safe, no lift, +345ms latency |

**Next steps** (see Codex recommendation):
1. Run shadow mode to collect trigger rate, conditional MRR delta, CE win/loss per query
2. If CE only helps on a subset, tighten the gate to trigger only there
3. If conditional lift is still zero, try a code-specific CE (jina-reranker-v2-base-multilingual)

## Problem Statement

The cascaded scorer (`core/cascaded-scorer.js`) was designed as MaxSim → confidence gate → conditional CE,
but the gate was **disabled** and replaced with pure MaxSim reranking (line 157, `gateReason: 'pure_reranker'`).

### History: Why the Gate Was Disabled

The gate went through three states — this needs to be understood clearly:

1. **Original design**: `isDecisive()` checked MaxSim gap > threshold. If not decisive → CE rescue.
2. **First attempt failed**: CE on a fixed 8 candidates produced -8.6pp MRR regression.
   The exact failure mode is unclear from the code comments, but the likely causes are:
   - `ceTopK=8` was too few — CE saw a narrow window and its reordering displaced correct results
   - The CE-first merge sort (all CE candidates above all MaxSim candidates) amplified errors
   - The gate threshold (0.12) may have been poorly calibrated for MaxSim score distributions
3. **Gate bypassed entirely** (`core/cascaded-scorer.js:156-172`): Rather than debugging the gate,
   the whole CE path was disabled. `stats.gateReason = 'pure_reranker'` on every query.

The current code never calls `isDecisive()` in the normal path. It's only exercised via
`forceFullCrossEncoder: true` (a benchmarking flag).

## Current Architecture

```
Binary HNSW retrieve (top-1000)
  → Int8 rescore (top-100)
  → cascadeDefer() slices to top-50          ← search-semantic.js:22
  → Graph expansion (optional)
  → cascadedScore()                           ← search-postprocess.js:216
    → MaxSim scores all ~50 candidates        ← may be reducible to 30 (see Phase 1)
    → [BYPASSED] isDecisive() gate — always returns 'pure_reranker'
    → [BYPASSED] runCrossEncoder()
    → Pure MaxSim sort → return
```

Key files:
- `core/cascaded-scorer.js` — Gate logic + cascade orchestration
- `core/search-postprocess.js:190-239` — Where cascade is wired into the pipeline
- `core/search-semantic.js:116-118` — Cascade deferred mode (returns broad candidate set)
- `core/local-reranker.js` — CE model (gte-reranker-modernbert-base INT8, 149M, maxLength=512)
- `core/flashrank.js:590-601` — `rerankDirect()` interface (routes to best available CE)
- `core/config.js:965-976` — CASCADE_CONFIG (enabled, gateThreshold, ceTopK, forceFullCE)
- `core/config.js:736-813` — RERANK_CONFIG + LOCAL_RERANKER_CONFIG (CE model tiers)
- `core/sweet-search.js:441-448` — `loadDocumentContent()` (truncates to 1000 chars)
- `tests/cascaded-scorer.test.js` — Unit tests (all assert `pure_reranker` path)

### Current CE Bottlenecks (Must Address)

1. **512-token cap** (`local-reranker.js:46`): The CE model's `maxLength` is 512 tokens.
   `loadDocumentContent()` truncates to 1000 chars (~250 tokens) before that. For code search,
   this means the CE only sees the first ~20-30 lines of a function. The model card supports 8192 tokens.

2. **Sequential scoring** (`local-reranker.js:169`): Each doc is scored one at a time inside
   the ONNX mutex. `rerankBatched()` exists but wraps `Promise.all` which is still sequential
   under the mutex. True batched tokenization (N pairs in one forward pass) would be significantly faster.

3. **Naive truncation** (`sweet-search.js:446`): `loadDocumentContent` returns
   `"${file} ${name}\n${content}".slice(0, 1000)`. No awareness of query terms, symbol boundaries,
   or code structure. A function's signature might be at line 1 but its relevant logic at line 50.

---

## CE Model Tiers

### Tier 1 (Default): gte-reranker-modernbert-base INT8 — Local, FREE

- **Model**: `Alibaba-NLP/gte-reranker-modernbert-base`
- **Params**: 149M (INT8 quantized, ~150MB)
- **Architecture**: ModernBERT cross-encoder, purpose-built for reranking
- **Context**: 8192 tokens (currently capped to 512 in code — see Fix 4)
- **Latency**: ~14ms/doc warm, ~300ms for 20 docs on M3 Max CPU
- **BEIR nDCG@10**: 56.19 (matches nemotron-rerank-1b at 8x the size)
- **ONNX**: Native support via `@huggingface/transformers`
- **Preheat**: Yes — loaded at session start when `shouldUseLocalReranker()` is true
- **License**: Apache 2.0
- **Status**: Already implemented in `core/local-reranker.js`

Default CE for gated rescue. Runs on every machine, offline, no API key.
With gated invocation (~30-40% of queries) and adaptive-K (3-20 docs), adds ~50-300ms
only when needed.

### Tier 2 (API): Voyage rerank-2.5 — Highest Quality

- **Model**: `rerank-2.5` (also `rerank-2.5-lite` for latency-sensitive paths)
- **Provider**: Voyage AI API
- **Latency**: ~100-200ms (network-dependent)
- **Context**: 32K tokens
- **Cost**: $0.05 per 1K documents
- **Config**: `VOYAGEAI_API_KEY` env var
- **Status**: Already wired in `core/flashrank.js` as `voyageReranker`

### Tier 3 (API): Jina reranker-v3 — Best Latency/Quality API

- **Model**: `jina-reranker-v3`
- **Provider**: Jina AI API
- **Params**: 0.6B (listwise architecture, scores 64 docs simultaneously)
- **BEIR nDCG@10**: 61.94
- **Context**: 131K tokens
- **Latency**: ~80ms
- **Cost**: $0.02 per 1K documents (free 10M tokens)
- **Config**: `JINA_API_KEY` env var
- **Status**: Already wired in `core/flashrank.js` as `jinaReranker`

### Additional API options to benchmark:

| Model | Latency | Quality | Cost | Notes |
|---|---|---|---|---|
| Voyage rerank-2.5-lite | ~60ms | Good | $0.02/1K | Latency-sensitive alternative to 2.5 |
| Cohere rerank-v4.0-fast | Low | Good | Usage-based | Fast path |
| Cohere rerank-v4.0-pro | Medium | High | Usage-based | +170 ELO over v3.5 |
| Qwen3-Reranker-0.6B (self-hosted) | ~500ms CPU | 81.22 MTEB-Code | FREE | Too slow for CPU CE rescue |

### CE Selection Priority (in `rerankDirect()`)

```
IF LOCAL_RERANKER_CONFIG.useLocalReranker AND model available:
  → gte-reranker-modernbert-base INT8 (default, FREE, ~300ms/20 docs)
ELSE IF JINA_API_KEY set:
  → jina-reranker-v3 (~80ms, $0.02/1K)
ELSE IF VOYAGEAI_API_KEY set:
  → voyage rerank-2.5 (~150ms, $0.05/1K)
ELSE:
  → No CE available / CE call fails → fall back to pure MaxSim (graceful degradation)
```

---

## Proposed Architecture

```
HNSW retrieve (top-1000 binary → top-100 int8 rescore)
  → Graph expansion (optional)
  → MaxSim rerank (all candidates with LI tokens)
  → Uncertainty Gate (multi-signal):
      primary: gap = maxsim[0] - maxsim[1]
      secondary: std(maxsim_top_k), lexical_confident flag
      IF confident → return MaxSim ranking (skip CE)
      IF uncertain → CE Rescue:
        adaptive_k = findNaturalCutoff(maxsim_scores, K_max=20)
        k = clamp(adaptive_k, 3, K_max)
        CE rerank top-k with query-aware snippets → return CE ranking
```

---

## Implementation Plan

### Phase 0: Shadow Mode (Measure Before Changing)

**Do not change production ranking.** Instrument the existing cascade path to log gate
signals and CE outcomes without affecting results.

Add to `cascadedScore()` after MaxSim scoring (before the current `pure_reranker` return):

```javascript
// Shadow logging — compute what the gate WOULD decide, log it, but don't act on it
if (process.env.SWEET_SEARCH_CASCADE_SHADOW === 'true') {
  const maxsimScores = scoredWithTokens.map(c => c.score);
  const gap = maxsimScores.length >= 2 ? maxsimScores[0] - maxsimScores[1] : Infinity;
  const topKStd = stddev(maxsimScores.slice(0, 10));
  const adaptiveK = computeAdaptiveK(maxsimScores, ceTopK);

  // Run CE in shadow (does not affect returned results)
  const ceCandidates = allRanked.slice(0, adaptiveK);
  const shadowCeResult = await runCrossEncoder(query, allRanked, ceCandidates, {...stats}, {
    crossEncoder, ceTopK: adaptiveK, loadDocumentContent, forceFullCrossEncoder: false,
  });

  // Log: did CE change top-1? top-3? What was the gap?
  const ceTop1 = shadowCeResult.results[0]?.id;
  const maxsimTop1 = allRanked[0]?.id;
  console.log(JSON.stringify({
    shadow_cascade: true,
    gap,
    topKStd,
    adaptiveK,
    ceChangedTop1: ceTop1 !== maxsimTop1,
    ceChangedTop3: /* compare top-3 sets */,
    ceLatencyMs: shadowCeResult.stats.ceLatencyMs,
    language: /* from query metadata if available */,
    queryLength: query.length,
  }));
}
// Continue with pure_reranker as before
```

Run GenCodeSearchNet (6000 queries) in shadow mode. This produces the dataset for:
- Gate threshold calibration
- Understanding CE win/loss distribution
- Measuring actual CE latency under adaptive-K
- Per-language analysis

### Fix 1: Re-enable Margin Gate with Uncertainty Signals

Replace the "Step 4: Pure MaxSim reranking" block (`cascaded-scorer.js:156-181`).

The gate should use 2-4 cheap signals, not just the margin. Inspired by TARG (margin gating)
and AcuRank (adaptive compute), but adapted to our MaxSim-specific context:

```javascript
/**
 * Determine whether MaxSim ranking is confident enough to skip CE.
 * Uses multiple cheap signals for better discrimination than margin alone.
 *
 * @param {number[]} scores - Sorted MaxSim scores (descending)
 * @param {number} marginThreshold - Gap threshold for primary signal
 * @param {Object} [context] - Optional context signals
 * @param {boolean} [context.lexicalConfident] - Lexical path was confident
 * @param {number} [context.withTokens] - How many candidates had LI tokens
 * @param {number} [context.totalCandidates] - Total candidate count
 * @returns {{ decisive: boolean, reason: string, signals: Object }}
 */
export function isDecisive(scores, marginThreshold = 0.08, context = {}) {
  if (!scores || scores.length < 2) {
    return { decisive: true, reason: 'single_candidate', signals: {} };
  }

  const sorted = [...scores].sort((a, b) => b - a);
  const gap = sorted[0] - sorted[1];

  // Signal 1: Margin (primary) — large gap = clear winner
  const marginDecisive = gap > marginThreshold;

  // Signal 2: Top-K flatness — low std = model can't discriminate
  const topK = sorted.slice(0, Math.min(10, sorted.length));
  const mean = topK.reduce((a, b) => a + b, 0) / topK.length;
  const std = Math.sqrt(topK.reduce((s, v) => s + (v - mean) ** 2, 0) / topK.length);
  const flat = std < 0.02; // empirically: std < 0.02 means very flat

  // Signal 3: Lexical confidence — if lexical path was already confident, skip CE
  const lexicalConfident = context.lexicalConfident || false;

  // Signal 4: Token coverage — if most candidates lack LI tokens, CE is more valuable
  const lowCoverage = context.withTokens !== undefined
    && context.totalCandidates > 0
    && (context.withTokens / context.totalCandidates) < 0.5;

  const signals = { gap, std, flat, marginDecisive, lexicalConfident, lowCoverage };

  // Decision logic:
  // - Lexical confident → always decisive (skip CE)
  // - Large margin AND not flat → decisive
  // - Flat scores → NOT decisive (CE needed for discrimination)
  // - Low token coverage → NOT decisive (MaxSim had limited signal)
  if (lexicalConfident) {
    return { decisive: true, reason: 'lexical_confident', signals };
  }
  if (lowCoverage) {
    return { decisive: false, reason: `low_coverage`, signals };
  }
  if (marginDecisive && !flat) {
    return { decisive: true, reason: `clear_winner (gap=${gap.toFixed(3)})`, signals };
  }
  if (flat) {
    return { decisive: false, reason: `flat_scores (std=${std.toFixed(4)})`, signals };
  }
  if (!marginDecisive) {
    return { decisive: false, reason: 'ambiguous', signals };
  }

  return { decisive: true, reason: `margin_ok (gap=${gap.toFixed(3)})`, signals };
}
```

Then the main flow becomes:

```javascript
// Step 4: Score assignment + margin gate
for (const c of scoredWithTokens) {
  c.preLateInteractionScore = c.score ?? c.int8Score ?? 0;
  const liScore = c.lateInteractionScore;
  c.score = Number.isFinite(liScore) ? liScore : (c.preLateInteractionScore || 0);
}
scoredWithTokens.sort((a, b) => b.score - a.score);

const maxsimScores = scoredWithTokens.map(c => c.score);
const { decisive, reason, signals } = isDecisive(maxsimScores, gateThreshold, {
  lexicalConfident: options.lexicalConfident,
  withTokens: stats.withTokens,
  totalCandidates: stats.totalCandidates,
});
stats.decisive = decisive;
stats.gateReason = reason;
stats.gateSignals = signals;

const allRanked = [...scoredWithTokens, ...withoutTokens];

if (decisive && !forceFullCrossEncoder) {
  return { results: allRanked, stats };
}

// CE rescue with adaptive-K
const adaptiveK = computeAdaptiveK(maxsimScores, ceTopK);
stats.adaptiveK = adaptiveK;
const ceCandidates = allRanked.slice(0, adaptiveK);
return runCrossEncoder(query, allRanked, ceCandidates, stats, {
  crossEncoder, ceTopK: adaptiveK, loadDocumentContent, forceFullCrossEncoder,
});
```

### Fix 2: Adaptive-K Candidate Selection

```javascript
/**
 * Compute adaptive K for CE candidate selection.
 * Uses the largest score gap in the top-K_max as a natural cutoff.
 * When MaxSim scores are flat (uncertain), sends more candidates.
 * When there's a clear cluster boundary, sends fewer.
 *
 * @param {number[]} scores - Sorted MaxSim scores (descending)
 * @param {number} kMax - Maximum candidates to send (cap)
 * @param {number} kMin - Minimum candidates to send (floor)
 * @returns {number}
 */
export function computeAdaptiveK(scores, kMax = 20, kMin = 3) {
  if (scores.length <= kMin) return scores.length;

  const limit = Math.min(scores.length - 1, kMax);
  let maxGap = -1;
  let cutoff = limit;

  for (let i = 0; i < limit; i++) {
    const gap = scores[i] - scores[i + 1];
    if (gap > maxGap) {
      maxGap = gap;
      cutoff = i + 1; // include items 0..i, send i+1 to CE
    }
  }

  return Math.max(kMin, Math.min(cutoff, kMax));
}
```

### Fix 3: CE Merge (Unchanged — Acceptable as-is)

The current `runCrossEncoder` merge puts CE-scored candidates above MaxSim-scored ones.
This is **correct** when adaptive-K selects the right prefix: the top-K ambiguous candidates
are exactly the ones CE was asked to resolve, so CE ordering should take priority for those.
Non-CE candidates (ranked K+1..N by MaxSim) stay in their MaxSim order below.

No code change needed. The previous -8.6pp regression was caused by poor candidate selection
(fixed by adaptive-K), not by the merge logic itself.

### Fix 4: Increase CE Token Budget + Query-Aware Snippet Packing

**This is likely the single highest-ROI change for CE accuracy.**

The current CE path is:
1. `loadDocumentContent()` → `"${file} ${name}\n${content}".slice(0, 1000)` (naive head truncation)
2. `local-reranker.js` → `text.slice(0, this.maxLength * 4)` then tokenize with `max_length: 512`

The gte-reranker-modernbert-base model supports **8192 tokens**. We're using 512.

**Changes needed:**

**a) Raise `maxLength` from 512 to 2048 in `local-reranker.js`:**

The model supports 8192 but we don't need all of it. 2048 is the sweet spot —
covers most functions fully, keeps latency reasonable (~4x current per-doc cost).
The latency increase is offset by adaptive-K sending fewer docs (3-20 vs the old fixed 8+).

```javascript
this.maxLength = 2048; // was 512, model supports 8192
```

**b) Query-aware snippet packing in `loadDocumentContent()`:**

This requires a small plumbing change: the CE path must pass `query` into
`loadDocumentContent(candidates, query)` instead of only `loadDocumentContent(candidates)`.
Without that, snippet packing cannot use query terms.

Instead of naive head truncation, build a snippet that includes:
1. File path + symbol name (always, for context)
2. Function/method signature (first few lines)
3. Query-relevant window: find the chunk region that best matches query terms

```javascript
async loadDocumentContent(candidates, query = '') {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  return candidates.map(c => {
    const content = c.content || c.text || '';
    const name = c.name || c.metadata?.name || '';
    const file = c.file || c.metadata?.file || '';
    const header = `${file} ${name}\n`;

    if (content.length <= 2000) {
      // Short enough — use everything
      return header + content;
    }

    // Head: signature + first N lines (always include)
    const head = content.slice(0, 800);

    // Query-relevant window: find best-matching region
    if (queryTerms.length > 0) {
      const lines = content.split('\n');
      let bestScore = 0, bestStart = 0;
      for (let i = 0; i < lines.length; i++) {
        const window = lines.slice(i, i + 20).join('\n').toLowerCase();
        const score = queryTerms.filter(t => window.includes(t)).length;
        if (score > bestScore) { bestScore = score; bestStart = i; }
      }
      if (bestScore > 0 && bestStart > 15) {
        const relevantWindow = lines.slice(bestStart, bestStart + 20).join('\n');
        return (header + head + '\n...\n' + relevantWindow).slice(0, 6000);
      }
    }

    // Fallback: head + tail (captures signature + return/closing logic)
    const tail = content.slice(-600);
    return (header + head + '\n...\n' + tail).slice(0, 6000);
  });
}
```

### Fix 5: True Batched CE Inference

The current `_doRerank` scores documents one at a time in a loop (`local-reranker.js:169`).
`rerankBatched()` wraps `Promise.all` but the ONNX mutex serializes everything anyway.

True batching tokenizes N query-doc pairs together and runs a single forward pass:

```javascript
async _doRerank(query, documents, topK) {
  const start = Date.now();

  // Prepare all pairs
  const texts = [];
  const pairs = [];
  for (const doc of documents) {
    const text = typeof doc === 'string' ? doc : doc.content || doc.text || '';
    texts.push(text.slice(0, this.maxLength * 4));
  }

  // Batch tokenize all pairs at once
  const queries = Array(texts.length).fill(query);
  const inputs = this.tokenizer(queries, {
    text_pair: texts,
    padding: true,
    truncation: true,
    max_length: this.maxLength,
  });

  // Single forward pass
  const output = await this.model(inputs);

  // Extract scores
  const scores = [];
  for (let i = 0; i < documents.length; i++) {
    const logit = output.logits.data[i];
    scores.push({ index: i, score: sigmoid(logit), original: documents[i] });
  }

  scores.sort((a, b) => b.score - a.score);

  const results = scores.slice(0, topK).map((item, rank) => {
    const base = typeof item.original === 'string'
      ? { content: item.original } : item.original;
    return {
      ...base,
      localRerankerScore: item.score,
      originalIndex: item.index,
      newRank: rank + 1,
      source: 'local-gte-modernbert-int8',
    };
  });

  return { results, latency_ms: Date.now() - start, model: 'gte-reranker-modernbert-base-int8' };
}
```

**Caveat**: Needs testing — `@huggingface/transformers` tokenizer batch support and ONNX
runtime memory with large batches need validation. If true batching doesn't work, fall back
to sequential but with larger `maxLength` (Fix 4a alone is still a big win).

### Fix 6: Update CASCADE_CONFIG Defaults

**File: `core/config.js`**

```javascript
export const CASCADE_CONFIG = {
  enabled: process.env.SWEET_SEARCH_CASCADE_ENABLED !== 'false',
  gateThreshold: parseFloat(process.env.SWEET_SEARCH_CASCADE_GATE_THRESHOLD) || 0.08,  // was 0.12
  ceTopK: parseInt(process.env.SWEET_SEARCH_CASCADE_CE_TOP_K) || 20,  // was 8, now K_max for adaptive
  forceFullCrossEncoder: process.env.SWEET_SEARCH_FORCE_FULL_CE === 'true',
  shadowMode: process.env.SWEET_SEARCH_CASCADE_SHADOW === 'true',
};
```

Changes:
- `gateThreshold`: 0.12 → **0.08** — Starting point. Shadow mode data will determine the right value.
- `ceTopK`: 8 → **20** — Now K_max for adaptive-K, not a fixed count. Actual K will be
  3-20 depending on score distribution.
- `shadowMode`: **NEW** — enables Phase 0 shadow logging without changing production ranking.

### Fix 7: Update Tests

**File: `tests/cascaded-scorer.test.js`**

Current tests all assert `pure_reranker`. Need to update:
1. `computeAdaptiveK` unit tests (pure function, easy to test)
2. `isDecisive` with multi-signal context (lexicalConfident, coverage, flatness)
3. "ambiguous scores → CE rescue" (gap < threshold → CE fires)
4. "tight cluster → CE rescue with high K" (flat scores → adaptive-K sends more)
5. "decisive gap → CE skipped" (clear winner → MaxSim ranking returned)
6. "lexicalConfident bypasses gate"
7. "adaptive-K caps at kMax, floors at kMin"
8. "forceFullCrossEncoder still works"
9. Shadow mode tests (logging without ranking change)

---

## Benchmark Validation

Run GenCodeSearchNet with 4 configurations:

| Configuration | Description | Expected |
|---|---|---|
| `CASCADE_ENABLED=false` | Pure MaxSim (current production) | 80.8% MRR baseline |
| `CASCADE_SHADOW=true` | Shadow mode (log CE decisions, keep MaxSim ranking) | 80.8% MRR + diagnostic data |
| `CASCADE_ENABLED=true` | Margin gate + adaptive CE (gte-modernbert) | 81.0-81.3% MRR |
| `FORCE_FULL_CE=true` | CE on every query (ceiling) | ~81.5% MRR ceiling |

---

## Threshold Tuning Recipe

After shadow mode produces diagnostic data:

1. From shadow logs, extract per-query: MaxSim gap, top-K std, adaptive-K, CE changed top-1,
   CE changed top-3, CE latency, language, query length.

2. Plot gap distribution for:
   - Queries where CE improved rank (green)
   - Queries where CE made no difference (gray)
   - Queries where CE hurt rank (red)

3. Find τ where:
   - Most green queries have gap < τ (CE correctly triggered)
   - Most gray/red queries have gap ≥ τ (CE correctly skipped)
   - Target: ~30-40% CE invocation rate

4. Evaluate multi-signal gate vs single-margin gate on the shadow data.
   If the extra signals (flatness, coverage) don't measurably improve discrimination,
   drop them and keep the gate simple.

5. Optional: per-language τ (JS gets lower threshold → more CE, Go gets higher → less CE).

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CE rescue adds latency on confident queries | Low | High | Gate ensures CE only fires on uncertain queries |
| Gate threshold too low → CE fires too often | Medium | Medium | Shadow mode measures before enabling; expose as env var |
| Gate threshold too high → CE never fires | Medium | Low | Same as current pure_reranker (no regression) |
| CE model disagrees with MaxSim on correct results | Low | Medium | Adaptive-K limits blast radius |
| ONNX mutex contention (CE + MaxSim use same runtime) | Medium | Medium | Sequential within cascade, mutex already exists |
| Increased `maxLength` causes OOM on low-memory machines | Low | Medium | Start at 2048 not 8192; env var override |

**Worst case**: Gate threshold too high → pure_reranker behavior (no regression from baseline).
**Best case**: +0.2-0.5pp MRR with ~50-100ms average latency overhead.

---

## Implementation Order

Every step that touches ranking or latency must be benchmarked on GenCodeSearchNet
(6000 queries, 6 languages). Some intermediate steps may regress one metric (e.g., latency)
while being a precursor to a subsequent step that improves it — that's expected. What matters
is that we **measure** so we can separate "precursor regression" from "this didn't work."

### Benchmark Protocol

All benchmarks use the same command template for consistency:

```bash
# Standard benchmark (reuses existing index)
node --max-old-space-size=16384 eval/run_benchmark.js \
  --dataset=gencodesearchnet \
  --skip-index \
  --profile=full \
  --sqlite-fast \
  --concurrency=12
```

**Rules:**
- **Profile**: Always `full` (late interaction ON). This is the production config.
- **Concurrency**: 12 (M3 Max).
- **`--skip-index`**: Reuse the same corpus index across all runs. Re-indexing between
  benchmark runs introduces variance and wastes time.
- **Warmup**: Before timing queries, the benchmark harness must load and warm all models
  (embedding, late interaction ONNX, local reranker if used). The eval harness already
  calls `SweetSearch.init()` which preheats these. Verify first-query latency is not
  an outlier; discard or flag if it is.
- **Metrics to record per run**: MRR@10, NDCG@10, Recall@5, Recall@20, Success@1,
  latency mean, latency p50, latency p95, per-language MRR@10 breakdown.
- **Checkpoints**: Save results to `eval/results/` with descriptive filenames (see below).
  Compare runs numerically, not by memory.

### Current Baseline (March 22, 2026 — post Lexical Fix Plan)

```
Profile: full, M3 Max 128GB, concurrency 12
MRR@10:      81.9%    Recall@5:  89.2%    Recall@20: 92.8%
Success@1:   76.3%    Latency p50: 1213ms
Per-language: Py 93.3%, Go 94.2%, Java 82.1%, JS 69.0%, PHP 78.7%, Ruby 74.1%
```

---

### Phase 0: Shadow Mode (no production change)

**Goal**: Collect gate decision data without changing any ranking.

1. Add `computeAdaptiveK()` and updated `isDecisive()` to `cascaded-scorer.js`.
   Unit-test only — no ranking change.

2. Add shadow mode: when `CASCADE_CONFIG.shadowMode` is true, compute gate signals and
   run CE in shadow, log results, but return the unchanged pure-MaxSim ranking.

3. **Benchmark (shadow)**:
   ```bash
   SWEET_SEARCH_CASCADE_SHADOW=true \
   node --max-old-space-size=16384 eval/run_benchmark.js \
     --dataset=gencodesearchnet --skip-index --profile=full \
     --sqlite-fast --concurrency=12
   ```
   → **Checkpoint: `ce-rescue-shadow.json` + `shadow-data.jsonl`**
   - MRR should match baseline exactly (shadow doesn't change ranking).
   - End-to-end latency will be higher than baseline because CE still runs in shadow.
     That's expected; use `shadow-data.jsonl` to measure CE cost, not to judge production latency.
   - `shadow-data.jsonl` captures per-query: gap, top-K std, adaptiveK, CE changed top-1/3,
     CE latency, language, query length, token counts.

4. Analyze shadow data: CE win/loss rate by gap bucket, optimal threshold candidates,
   per-language patterns, latency distribution.

### Phase 1: MaxSim Candidate Reduction (latency investigation)

**Goal**: Determine if MaxSim can score fewer than 50 candidates without quality loss.

`cascadeDefer()` currently passes top-50 to MaxSim. Reducing to 30 would cut ~40% of
MaxSim compute time. But this must be proven, not assumed.

5. **Benchmark sweep** — run 4 times with different `cascadeK` values:
   ```bash
   # cascadeK=50 (current default — should match baseline)
   SWEET_SEARCH_CASCADE_K=50 \
   node --max-old-space-size=16384 eval/run_benchmark.js \
     --dataset=gencodesearchnet --skip-index --profile=full \
     --sqlite-fast --concurrency=12

   # Repeat with CASCADE_K=40, 30, 20
   ```
   → **Checkpoint: `maxsim-sweep-{50,40,30,20}.json`**
   - Record: MRR@10 delta from K=50, per-language deltas, latency mean delta.
   - **Acceptance**: K=N is acceptable if MRR@10 delta ≤ 0.1pp vs K=50.

6. If a lower K is confirmed: update `cascadeDefer` default and add
   `CASCADE_CONFIG.maxSimCandidates` as env-var-configurable.

### Phase 2: CE Serving Improvements (independent of gate)

**Goal**: Raise the CE quality ceiling and reduce per-doc CE latency.
These changes improve what CE can do when it fires, before we decide when to fire it.

**Note on intermediate regressions**: Step 7 (raising maxLength) will increase CE latency
per doc. That's expected — it's a precursor to step 8 (batching) which recovers it.
We benchmark each step to quantify the tradeoff, not to gate on "no regression."

7. **Raise `maxLength`**: 512 → 2048 in `local-reranker.js`.
   ```bash
   SWEET_SEARCH_FORCE_FULL_CE=true \
   node --max-old-space-size=16384 eval/run_benchmark.js \
     --dataset=gencodesearchnet --skip-index --profile=full \
     --sqlite-fast --concurrency=12
   ```
   → **Checkpoint: `ce-maxlen2048-ceiling.json`**
   - **Expect**: MRR improvement (CE sees more code), latency increase (~4x per doc).
   - This measures the CE ceiling with better token budget.

8. **Query-aware snippet packing** in `loadDocumentContent()`.
   Same benchmark command as step 7 (FORCE_FULL_CE=true).
   → **Checkpoint: `ce-snippet-ceiling.json`**
   - **Expect**: MRR improvement over step 7 (better content selection), possibly lower
     latency (shorter effective inputs when code is focused).

9. **True batched CE inference** — single forward pass for N pairs.
   Same benchmark command as step 8.
   → **Checkpoint: `ce-batched-ceiling.json`**
   - **Expect**: Same MRR as step 8, significantly lower latency.
   - If batching doesn't work with `@huggingface/transformers` ONNX, skip this step.
     Steps 7-8 still stand on their own.

### Phase 3: Enable Gate

**Goal**: Turn on confidence-gated CE rescue in production.

10. Re-enable margin gate in `cascadedScore()` with threshold calibrated from Phase 0 data.
11. Update CASCADE_CONFIG defaults (gateThreshold, ceTopK=K_max for adaptive).
12. Update tests (see Fix 7 section above).

13. **Benchmark (gate enabled)**:
    ```bash
    node --max-old-space-size=16384 eval/run_benchmark.js \
      --dataset=gencodesearchnet --skip-index --profile=full \
      --sqlite-fast --concurrency=12
    ```
    → **Checkpoint: `ce-rescue-gated.json`**
    - Compare to:
      - **Baseline** (step 0): MRR must be ≥ baseline. Any regression = stop and investigate.
      - **CE ceiling** (step 8 or 9): gap shows headroom remaining.
    - Record: CE invocation rate (target: 30-40%), latency mean/p50/p95 vs baseline,
      per-language MRR deltas.

14. If MRR < baseline: inspect per-query regressions from shadow data. Adjust threshold
    or gate signals. Re-benchmark. Do not ship a regression.

### Phase 4: Optional Upgrades

15. Benchmark Voyage rerank-2.5-lite and Cohere rerank-v4.0-fast for latency-sensitive API paths.
16. Benchmark Voyage rerank-2.5 and Cohere rerank-v4.0-pro as quality ceilings.
17. Evaluate per-language thresholds (if shadow data shows language-specific patterns).

Each API benchmark uses the same protocol but with the API reranker enabled:
```bash
VOYAGEAI_API_KEY=... LOCAL_RERANKER_ENABLED=false \
node --max-old-space-size=16384 eval/run_benchmark.js \
  --dataset=gencodesearchnet --skip-index --profile=full \
  --sqlite-fast --concurrency=12
```

---

## Research Context (March 2026)

The following papers and techniques informed this plan. They are cited as **inspiration**,
not as direct proof that specific constants will work in our MaxSim → CE pipeline.
Our score distributions, model stack, and query patterns are specific to code search.

### Margin Gating
- **TARG** (arXiv:2511.09803, Nov 2025): Training-free adaptive retrieval gating using
  logit-margin uncertainty. Confirms that margin-based gating achieves strong accuracy-efficiency
  tradeoffs with essentially zero overhead. Note: TARG gates retrieval augmentation from
  model-logit uncertainty, not MaxSim-gap gating specifically — our adaptation uses the same
  principle (margin as confidence proxy) but on different scores.

### Adaptive Compute for Reranking
- **AcuRank** (NeurIPS 2025, arXiv:2505.18512): Bayesian TrueSkill model for selective
  reranking. Supports the principle that adaptive compute (rerank only uncertain candidates)
  outperforms fixed-computation approaches. More complex than needed for our system.
- **DynamicRAG** (NeurIPS 2025, arXiv:2505.07233): RL agent that dynamically adjusts
  document count per query. Confirms adaptive-K > fixed-K.

### Progressive / Efficient CE
- **E2Rank** (Pinecone, ECIR 2025): Layer-wise progressive reranking — 8 layers to prune,
  16 to refine, 24 for final. Pareto-optimal efficiency-effectiveness. Could apply to
  gte-modernbert if per-doc latency becomes a bottleneck.
- **SEE** (SIGIR 2025): Selective Early Exit for cross-encoders. Filter before transformer
  blocks with asymmetric thresholds.

### Late-Interaction Acceleration
These could reduce MaxSim latency and improve first-stage quality, reducing CE pressure:
- **Col-Bandit** (arXiv:2602.02827): Query-time pruning for late interaction, up to 5x
  MaxSim FLOP reduction.
- **WARP** (arXiv:2501.17788): Faster multi-vector retrieval engine.
- **ColBERT-Zero** (arXiv:2602.16609): Stronger pretrained multi-vector models.

### Cascade Architectures
- **OG-Rank** (Oct 2025, arXiv:2510.17614): "Rank fast by default, explain when it helps."
  45% gate activation → +24% Recall@1.
- **LCRON** (ICML 2025, arXiv:2503.09492): Joint end-to-end cascade training.
- **GroupRank** (Nov 2025, arXiv:2511.11653): GRPO with heterogeneous reward.

### Candidate Pool Size
- "Drowning in Documents" (2024): >200 CE candidates can decrease Recall@10 (phantom hits).
- EECATS (ECIR 2025): ColBERT → CE(top-100) is 6.6x faster than CE-only.
  Our pipeline has MaxSim first, so CE pool should be smaller (10-20).

### Score Calibration
- Standard practice: CE overrides MaxSim ordering for scored candidates, not score blending.
  Avoids calibration complexity (Platt scaling, isotonic regression).

### CE Model Landscape (March 2026)

| Model | Params | BEIR nDCG@10 | Code Score | Local ONNX | Notes |
|---|---|---|---|---|---|
| **gte-reranker-modernbert-base** (ours) | 149M | 56.19 | COIR eval | Yes | Default local CE |
| jina-reranker-v2-base-multilingual | 278M | ~57 | 71.36 CSN MRR | Partial (ONNX tricky) | Code-optimized, FA2 |
| mxbai-rerank-base-v2 | 500M | 55.57 | 31.73 code NDCG | Yes (export script) | GRPO, Qwen-2.5 base |
| jina-reranker-v3 (API) | 0.6B | 61.94 | 63-71 CoIR | API only | Listwise, 131K ctx |
| Qwen3-Reranker-0.6B | 0.6B | — | 81.22 MTEB-Code | Community ONNX | LLM-based, slow CPU |
| Qwen3-Reranker-4B | 4B | — | Strong | No | Mid-tier quality/speed |
| Qwen3-Reranker-8B | 8B | 69.02 | 81.22 MTEB-Code | No | SOTA code, too large |
| Voyage rerank-2.5 (API) | ? | SOTA | SOTA code | API only | Highest quality |
| Voyage rerank-2.5-lite (API) | ? | Good | Good | API only | ~60ms, quality/latency |
| Cohere rerank-v4.0-pro (API) | ? | — | — | API only | +170 ELO over v3.5 |
| Cohere rerank-v4.0-fast (API) | ? | — | — | API only | Latency-optimized |
| zerank-1 (API) | 4B | — | Strong | API only | 14x faster than Jina |

### Retrieval-Side Opportunities
If retrieval recall improves, CE pressure drops (fewer ambiguous queries):
- **Voyage voyage-code-3**: Supports smaller dims + binary/int8 quantization, fits our
  binary+int8 HNSW pipeline. Could improve retrieval recall for weak languages (JS/PHP/Ruby).
- Better retrieval sets the ceiling; CE optimizes within it.
