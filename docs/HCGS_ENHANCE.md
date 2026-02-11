# HCGS Enhancement Plan: Faster Summaries + Dual-Model Embedding

**Status**: Plan (not yet implemented)
**Date**: 2026-02-11
**Scope**: Two improvements to the HCGS pipeline: (1) Replace GLM-4.6 with a faster/cheaper model for summary generation, (2) Use general-purpose embeddings (Voyage-4 series) for NL summaries instead of code-specific embeddings (voyage-code-3), with implications for indexing, search, and reranking.

---

## 1. Problem Statement

### 1.1 Summary Generation: GLM-4.6 is Overkill

HCGS summaries are 40-250 token natural language descriptions of code entities:
- Method: *"Validates user credentials against the database and returns a boolean"* (~80 tokens)
- Class: *"HTTP request handler for user authentication, manages session lifecycle"* (~150 tokens)
- Package: *"Core authentication module providing OAuth2 + JWT flows"* (~250 tokens)

The current config (`config.js:660`) uses `zai-glm-4.6` on Cerebras at ~1,000 tok/s. This is a **reasoning-class model** being used for a task that requires zero reasoning — just extraction and paraphrasing. The prompt is: *"Generate brief summary. Respond with ONLY the summary."*

**Cost**: GLM-4.6 pricing on Cerebras is $2.25/$2.75 per million input/output tokens (the most expensive model on the platform).

### 1.2 Summary Embeddings: Code Model for Natural Language

HCGS summaries are **natural language text** that describes code. They contain English prose with programming vocabulary ("validates", "credentials", "boolean", "OAuth2"). Currently, these summaries are embedded using whatever `EMBEDDING_CONFIG.provider` is active — which, when Voyage is enabled, means `voyage-code-3`.

`voyage-code-3` is optimized for **raw source code**: identifiers, syntax patterns, control flow. It excels at code-to-code and NL-query-to-code retrieval. But for NL-text-to-NL-text similarity (summary-to-query), a general-purpose model is a better fit.

The Voyage-4 series (released January 2026) offers:
- Better NL retrieval accuracy than voyage-code-3 for natural language text
- **Shared embedding space** across all v4 models (asymmetric retrieval)
- Significantly lower pricing: $0.02-$0.12/M vs $0.18/M for code-3
- `voyage-4-nano`: open-weight, free, local — compatible with all v4 embeddings

---

## 2. Research: Faster Models for Summary Generation

### 2.1 Provider Comparison for Code Summarization

The task is simple: given a code entity (function signature, class body, etc.), produce a 40-250 token English summary. No reasoning, no chain-of-thought, no tool use.

#### Groq

| Model | Speed | Cost (input/output per M) | Quality | Notes |
|-------|-------|---------------------------|---------|-------|
| `llama-3.2-1b-preview` | ~3,100 tok/s | $0.04/$0.04 | Low (MMLU 32.2%) | Too low for code comprehension |
| **`llama-3.2-3b-preview`** | **~2,800 tok/s** | **$0.06/$0.06** | **Acceptable (MMLU 45.7%)** | **Best speed/cost for summarization** |
| `llama-3.1-8b-instant` | ~560 tok/s | $0.05/$0.08 | Good | 4x slower than 3B |
| `gemma2-9b-it` | ~500 tok/s | $0.20/$0.20 | Good | No speed advantage over 8B |

#### Cerebras

| Model | Speed | Cost (input/output per M) | Quality | Notes |
|-------|-------|---------------------------|---------|-------|
| `llama3.1-8b` | ~2,200 tok/s | $0.10/$0.10 | Good | Fastest 8B anywhere |
| `qwen-3-32b` | ~2,600 tok/s | $0.40/$0.80 | Very good | Overkill for summaries |
| `zai-glm-4.6` (current) | ~1,000 tok/s | $2.25/$2.75 | Excellent | **27x more expensive than Groq 3B** |

**No sub-8B models on Cerebras.** The smallest is Llama 3.1 8B.

#### Self-Hosted (for reference)

| Model | Params | Code Training | Summarization Quality |
|-------|--------|---------------|----------------------|
| Qwen 2.5 Coder 3B | 3B | 5.5T tokens (87% code) | Best code-specific small model |
| DeepSeek-Coder 1.3B | 1.3B | 2T tokens (87% code) | Surprisingly capable but code-gen focused |
| Phi-3.5-mini | 3.8B | Mixed | Beats Llama-3.1-8B on code comprehension |

### 2.2 Research Findings on Quality vs Size

- **3B is the practical floor** for acceptable code summarization. 1B models generate text but struggle with code semantics.
- **Quantization has minimal impact**: 4-bit and 8-bit quantized code models show negligible quality loss (source: [arXiv 2410.14766](https://arxiv.org/html/2410.14766v1)).
- **Qwen Coder models lead** for code summarization specifically, achieving the highest alignment with human-written summaries (source: [Qwen2.5-Coder Technical Report](https://arxiv.org/pdf/2409.12186)).
- For **simple extraction/paraphrasing** (our use case), even general 3B models produce usable output.

### 2.3 Recommendation: Tiered Provider Fallback

Replace the current single-model approach with a tiered fallback optimized for speed and cost:

```
Tier 1: Groq llama-3.2-3b-preview  (~2,800 tok/s, $0.06/M)  — fastest, cheapest
Tier 2: Cerebras llama3.1-8b       (~2,200 tok/s, $0.10/M)  — better quality, still fast
Tier 3: Groq llama-3.1-8b-instant  (~560 tok/s, $0.08/M)    — Groq fallback
Tier 4: Ollama qwen2.5-coder:7b    (local, ~50-100 tok/s)   — offline fallback
Tier 5: Static fallback             (no LLM)                  — existing behavior
```

**vs current**:
```
Tier 1: Cerebras zai-glm-4.6       (~1,000 tok/s, $2.75/M)  — expensive, slow for the task
Tier 2: Ollama qwen2.5-coder:7b    (local)
Tier 3: Transformers.js phi-3-mini  (local CPU, very slow)
Tier 4: Static fallback
```

**Impact**: ~2.8x faster, ~46x cheaper per token for the typical case (Groq 3B vs Cerebras GLM-4.6).

---

## 3. Research: Dual-Model Embedding Strategy

### 3.1 The Case for Separate Embedding Models

Sweet Search indexes two fundamentally different types of content:

| Content Type | Format | What queries look like | Best embedding model |
|-------------|--------|------------------------|---------------------|
| **Source code** (vector chunks) | Raw code: identifiers, syntax, logic | `AuthService`, `function that validates JWT` | **voyage-code-3** (SOTA for code) |
| **HCGS summaries** (NL descriptions) | English prose about code | `how does login work`, `authentication flow` | **voyage-4** (SOTA for NL retrieval) |

Using the same model for both is suboptimal:
- `voyage-code-3` on NL summaries: understands programming vocabulary but not optimized for NL-to-NL similarity
- `voyage-4` on raw code: good general model but misses code-specific patterns (syntax, identifiers, control flow)

### 3.2 Voyage-4 Series: Model Comparison

All v4 models share a **common embedding space** — embeddings are interchangeable.

| Model | Cost/M tokens | Dimensions | Best For |
|-------|--------------|------------|----------|
| `voyage-4-large` | $0.12 | 1024 (default), 256/512/2048 | Index-time embedding (highest accuracy, MoE) |
| `voyage-4` | $0.06 | 1024 (default), 256/512/2048 | Balanced accuracy/cost |
| `voyage-4-lite` | $0.02 | 1024 (default), 256/512/2048 | Query-time embedding (lowest latency) |
| `voyage-4-nano` | Free (open weights) | 1024 (default), 256/512/2048 | Local dev, offline, cost-zero |

**Shared embedding space** enables **asymmetric retrieval**: embed summaries at index time with `voyage-4-large` for maximum quality ($0.12/M, one-time cost), then embed queries at search time with `voyage-4-lite` ($0.02/M) or `voyage-4-nano` (free/local). No re-indexing needed when switching query-time models.

**Performance** (RTEB, 29 datasets):
- `voyage-4-large` beats Gemini Embedding by 3.87%, Cohere Embed v4 by 8.20%, OpenAI v3 Large by 14.05%
- `voyage-code-3` leads in code-specific benchmarks (13.8-16.8% above competitors) but is not ranked on general RTEB

### 3.3 Code-Specific vs General Models for HCGS Summaries

Research findings (source: [Code Embedding Models Comparison](https://modal.com/blog/6-best-code-embedding-models-compared), [Voyage AI FAQ](https://docs.voyageai.com/docs/faq)):

- `voyage-code-3` is recommended for "code-related tasks and programming documentation" — which includes docstrings and comments alongside code
- However, HCGS summaries are **generated English prose**, not docstrings. They read like: *"Core authentication module providing OAuth2 and JWT-based session management with Redis-backed token storage"*
- General models trained on diverse text (including technical writing) handle this well
- OpenAI's general `text-embedding-3-small` "performed excellently" on code-adjacent tasks despite being general-purpose, suggesting well-trained general models bridge the gap for NL text about code

**Verdict**: For NL summaries specifically, `voyage-4` is the pragmatic choice:
- 3x cheaper than `voyage-code-3` ($0.06 vs $0.18/M)
- Better NL-to-NL similarity (general RTEB leader)
- Shared embedding space enables asymmetric retrieval
- For raw code chunks, keep `voyage-code-3` (it's definitively better there)

---

## 4. Proposed Architecture: Dual-Model Pipeline

### 4.1 Indexing Pipeline Changes

Currently, all content is embedded with a single provider. The proposal adds a **content-type-aware routing** layer:

```
Source File → AST Chunker → Code Chunks → embed with EMBEDDING_CONFIG.provider (code model)
                                              ↓
                                        vectors table (codebase.db)

Source File → Graph Extractor → Entities → HCGS Generator → NL Summaries
                                                                  ↓
                                              embed with SUMMARY_EMBEDDING_CONFIG.provider (general model)
                                                                  ↓
                                                          summary_embedding column (code-graph.db)
```

**New config** (`config.js`):

```js
export const SUMMARY_EMBEDDING_CONFIG = {
  // For HCGS summaries (natural language about code)
  // Defaults to active EMBEDDING_CONFIG if no separate config
  provider: process.env.SUMMARY_EMBEDDING_PROVIDER || EMBEDDING_CONFIG.provider,
  model: process.env.SUMMARY_EMBEDDING_MODEL || null,  // null = use provider default
  // When Voyage is available, prefer voyage-4 for summaries
  // When local, use same local model (all-MiniLM-L6-v2 handles NL well)
};
```

**Fallback behavior**: If no `SUMMARY_EMBEDDING_PROVIDER` is set, summaries use the same provider as code chunks. This maintains backward compatibility — the dual-model approach is opt-in.

### 4.2 Search Pipeline Changes

When a user query comes in, the search pipeline currently embeds it once and searches the vector index. With dual models, the query needs to search **both** embedding spaces:

```
User Query → Query Router
                ↓
         ┌──────────────────────────────────────┐
         │  Lexical path (FTS5, unchanged)        │
         ├──────────────────────────────────────┤
         │  Semantic path:                        │
         │    1. Embed query with code model       │  → search vectors table (code chunks)
         │    2. Embed query with summary model    │  → search summary_embedding column
         │    3. Merge results (RRF or interleave) │
         ├──────────────────────────────────────┤
         │  Hybrid fusion (RRF, unchanged)        │
         └──────────────────────────────────────┘
```

**When the same model is used for both** (default/local): Only one embedding call is needed. The query embedding works for both vector spaces since they use the same model.

**When different models are used** (Voyage code-3 + Voyage-4): Two embedding calls are needed. However, the Voyage-4 shared embedding space means the query can be embedded with `voyage-4-lite` ($0.02/M) for minimal cost.

### 4.3 Reranking Implications

The reranking step (FlashRank local, or Voyage rerank-2, or Jina reranker) operates on **text**, not embeddings. It receives `(query, candidate_text)` pairs and scores relevance.

**No changes needed for reranking.** The reranker is already model-agnostic — it works with whatever text the retrieval step returns, whether that text came from code chunks or NL summaries.

The only consideration: if the reranker is Voyage's `rerank-2`, it may perform slightly differently on NL summaries vs raw code. But since `rerank-2` is a cross-encoder (processes query + document jointly), it handles both formats well.

### 4.4 Asymmetric Retrieval Optimization

With Voyage-4's shared embedding space, the optimal cost strategy is:

| Operation | Model | Cost | When |
|-----------|-------|------|------|
| **Index summaries** (one-time) | `voyage-4-large` | $0.12/M | During `/index-codebase` |
| **Search queries** (ongoing) | `voyage-4-lite` | $0.02/M | Every search |
| **Local/offline queries** | `voyage-4-nano` | Free | Offline mode |

This is possible because all v4 models produce compatible embeddings. You don't need to re-index when switching the query model.

For code chunks, `voyage-code-3` does **not** share an embedding space with the v4 family, so the same model must be used for both indexing and querying code chunks.

---

## 5. Implementation Plan

### 5.1 Phase 1: Faster Summary Generation (config change + provider addition)

**Files changed**: `core/config.js`, `core/llm-provider.js`

1. Change `CEREBRAS_CONFIG.defaults.hcgs` from `'zai-glm-4.6'` to `'llama3.1-8b'`
2. Add Groq as a summary generation provider in `llm-provider.js`:
   - Model: `llama-3.2-3b-preview` (or `llama-3.1-8b-instant` as fallback)
   - Endpoint: `https://api.groq.com/openai/v1/chat/completions`
   - Auth: `GROQ_API_KEY` (already used for translation)
3. Update provider priority for HCGS:
   ```
   1. Groq llama-3.2-3b-preview (if GROQ_API_KEY set)
   2. Cerebras llama3.1-8b (if CEREBRAS_API_KEY set)
   3. Ollama local (if running)
   4. Transformers.js local CPU
   5. Static fallback
   ```
4. Add `HCGS_MODEL` env override: `HCGS_MODEL=llama-3.2-3b-preview` for user control

### 5.2 Phase 2: Summary Embedding Config (new config section)

**Files changed**: `core/config.js`

1. Add `SUMMARY_EMBEDDING_CONFIG` section
2. Support `SUMMARY_EMBEDDING_PROVIDER` env variable
3. Default: same as `EMBEDDING_CONFIG.provider` (backward compatible)
4. When Voyage keys are present and `voyage-4` is available: auto-select `voyage-4` for summaries

### 5.3 Phase 3: Dual-Model Embedding in HCGS Generator

**Files changed**: `core/hcgs-generator.js`, `core/embedding-service.js`

1. Add `generateSummaryEmbedding()` function that routes to the summary embedding provider
2. Update `hcgs-generator.js` to use `generateSummaryEmbedding()` instead of `getEmbedding()`
3. When both providers are the same: no change in behavior
4. When different: two separate embedding calls during indexing

### 5.4 Phase 4: Search Pipeline Update

**Files changed**: `core/sweet-search.js`

1. When dual models are active, embed the query with both providers
2. Search both vector spaces
3. Merge results before reranking (existing RRF fusion handles this)
4. When single model: no change in behavior

### 5.5 Phase 5: Asymmetric Retrieval Support (Voyage-4 only)

**Files changed**: `core/config.js`, `core/embedding-service.js`

1. Add `VOYAGE_INDEX_MODEL` / `VOYAGE_QUERY_MODEL` config
2. Default: same model for both (backward compatible)
3. When set: use `voyage-4-large` for indexing, `voyage-4-lite` for queries
4. Track index model in metadata to detect mismatches

---

## 6. Backward Compatibility

- **Default behavior unchanged**: If no `SUMMARY_EMBEDDING_PROVIDER` is set, everything works exactly as today
- **Single-model path preserved**: The dual-model path is opt-in via environment variables
- **Local provider unaffected**: `all-MiniLM-L6-v2` handles both code and NL well enough at 384d — no need for dual models in local mode
- **Existing indexes remain valid**: No schema changes to `code-graph.db` or `codebase.db`
- **GLM-4.6 still available**: Just no longer the default for HCGS; users can set `HCGS_MODEL=zai-glm-4.6` to restore old behavior

---

## 7. Success Metrics

| Metric | Current (GLM-4.6) | Target (Groq 3B) | Target (Cerebras 8B) |
|--------|-------------------|-------------------|----------------------|
| Summary generation speed | ~1,000 tok/s | **~2,800 tok/s** | **~2,200 tok/s** |
| Cost per 1M output tokens | $2.75 | **$0.06** (~46x cheaper) | **$0.10** (~27x cheaper) |
| Summary quality (subjective) | Excellent | Acceptable | Good |
| Summary embedding cost (Voyage) | $0.18/M (code-3) | **$0.06/M** (v4) | **$0.06/M** (v4) |
| Query embedding cost (Voyage) | $0.18/M (code-3) | **$0.02/M** (v4-lite) | **$0.02/M** (v4-lite) |
| NL query → summary retrieval | Baseline | **+5-10%** (better NL model) | **+5-10%** |

---

## 8. Open Questions

1. **Groq 3B quality validation**: The `llama-3.2-3b-preview` model is in "preview" status on Groq. Need to validate summary quality against a test set before making it the default. Fallback to Cerebras 8B if quality is insufficient.

2. **Dual embedding storage**: Should `summary_embedding` in `code-graph.db` store a provider tag? Currently it's just a binary blob. Adding metadata would help detect provider mismatches.

3. **Query-time cost of dual embedding**: When dual models are active, each search requires two embedding calls. For the local provider, this is ~100ms extra. For remote providers, it's ~200-400ms. Is this acceptable, or should we add a "summary-only" search mode?

4. **Voyage-4-nano for local**: `voyage-4-nano` is open-weight and shares the v4 embedding space. Could it replace `all-MiniLM-L6-v2` as the default local model for summary embeddings? Need to benchmark latency and quality.

5. **Batch indexing discount**: Voyage offers 33% off via Batch API. For large codebases, should the HCGS pipeline batch summary embeddings through the Batch API during `/index-codebase`?

---

## 9. Research Sources

### Inference Providers
- [Groq Models Documentation](https://console.groq.com/docs/models)
- [Groq Pricing](https://groq.com/pricing)
- [Cerebras Pricing](https://www.cerebras.ai/pricing)
- [Cerebras Inference](https://www.cerebras.ai/inference)
- [Artificial Analysis - Provider Comparison](https://artificialanalysis.ai/providers)

### Small Model Benchmarks
- [Qwen2.5-Coder Technical Report](https://arxiv.org/pdf/2409.12186)
- [DeepSeek-Coder Paper](https://arxiv.org/abs/2401.14196)
- [Phi-3 Technical Report](https://arxiv.org/pdf/2404.14219)
- [Evaluating Quantized LLMs for Code](https://arxiv.org/html/2410.14766v1)

### Embedding Models
- [Voyage 4 Blog Post](https://blog.voyageai.com/2026/01/15/voyage-4/)
- [Voyage-code-3 Blog Post](https://blog.voyageai.com/2024/12/04/voyage-code-3/)
- [Voyage AI Pricing](https://docs.voyageai.com/docs/pricing)
- [Voyage AI Embeddings Docs](https://docs.voyageai.com/docs/embeddings)
- [6 Best Code Embedding Models](https://modal.com/blog/6-best-code-embedding-models-compared)
- [Code Embedding Deep Dive](https://medium.com/@abhilasha4042/code-isnt-just-text-a-deep-dive-into-code-embedding-models-418cf27ea576)
- [Code-Embed Paper](https://arxiv.org/html/2411.12644v2)
- [Qodo-Embed Code Retrieval](https://www.qodo.ai/blog/qodo-embed-1-code-embedding-code-retrieval/)
