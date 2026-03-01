# Late Interaction: LateOn-Code Migration Plan

Extracted from `docs/TODO.md` Sections 0, 8, and 26. Updated 2026-02-28.
SOTA review applied 2026-02-28 — see "SOTA Landscape" section.

## Critical Finding: Current "ColBERT" Is a Pseudo-Approximation

**The existing ColBERT implementation is NOT real late interaction.** Reading the
actual code reveals:

1. **No ColBERT model is ever loaded.** `COLBERT_CONFIG.model` in `config.js:817`
   (`jinaai/jina-colbert-v2`) is never referenced by any runtime code.

2. **Indexing uses the dense embedder (CodeRankEmbed)**, not a ColBERT model.
   `indexer-ann.js:253` calls `getEmbeddings()` on per-line text, producing
   CodeRankEmbed 768d vectors truncated to 64d. These are stored as
   "pseudo-tokens" — they are NOT ColBERT token embeddings.

3. **Query scoring uses the sentence-level embedding, not per-token.**
   `sweet-search.js:343` (`approximateColBERTScore`) computes cosine similarity
   between the single query vector and each stored "token" (line embedding).
   Real ColBERT tokenizes the query into per-token vectors and computes MaxSim
   across all query x doc token pairs.

4. **The MaxSim implementation in `colbert-index.js:189` is correct** — it does
   compute proper MaxSim. But `semanticSearch3Stage` at line 154 calls
   `approximateColBERTScore` instead of `colbertIndex.scoreWithColBERT`.

**Consequence:** Enabling ColBERT today gives a weak approximation, not the
cross-encoder-quality scoring that real ColBERT provides.

---

## Model Facts (verified from HuggingFace, 2026-02-28)

### LateOn-Code (full, 149M)

- HuggingFace: `lightonai/LateOn-Code`
- Architecture: ModernBERT (22 layers, hidden_size=768)
- Token output: 768 → **128d** per token (linear projection, `1_Dense/`, no bias, no activation)
- Query prefix: `[Q] `, Document prefix: `[D] `
- Query max length: 256 tokens, Document max length: 2048 tokens
- Tokenizer: included (`tokenizer.json`, vocab 50370)
- **ONNX already exported on HuggingFace:**
  - `model.onnx` — 597 MB (FP32)
  - `model_int8.onnx` — 150 MB (INT8 quantized)
- MTEB Code v1 avg: **74.12**, CSN MRR: **90.40%**
- Skiplist: 32 punctuation chars (filtered from MaxSim)

### LateOn-Code-edge (17M)

- HuggingFace: `lightonai/LateOn-Code-edge`
- Architecture: ModernBERT (7 layers, hidden_size=256)
- **⚠️ Token output: TWO-STAGE projection** — 256 → 512 → **48d** per token
  (NOT a single 256→48 projection. The HuggingFace model card shows two Dense
  layers: `Dense(256→512)` then `Dense(512→48)`, both no bias, identity
  activation. Manual projection code MUST apply both multiplies sequentially.)
- Same prefixes, max lengths, tokenizer, skiplist
- **ONNX already exported on HuggingFace:**
  - `model.onnx` — 68 MB
  - (no INT8 variant yet — could quantize ourselves, target ~20MB)
- MTEB Code v1 avg: **66.64**

Full HuggingFace architecture string:
```
ColBERT(
  (0): Transformer({'max_seq_length': 2047, 'do_lower_case': True, 'architecture': 'ModernBertModel'})
  (1): Dense({'in_features': 256, 'out_features': 512, 'bias': False, 'activation_function': 'torch.nn.modules.linear.Identity'})
  (2): Dense({'in_features': 512, 'out_features': 48, 'bias': False, 'activation_function': 'torch.nn.modules.linear.Identity'})
)
```

### Cross-compatibility

**Embedding spaces are NOT compatible.** Full model outputs 128d tokens, edge
outputs 48d tokens. An index built with one model cannot be queried with the
other. The model ID must be stored in the index and checked at query time.

### Pipeline structure

```
Full model (lateon-code):
  Input text
    → Tokenizer (shared vocab, 50370 tokens)
    → ModernBERT backbone (22 layers, per-token hidden states, 768d)
    → Dense projection: 768 → 128 (single layer, no bias)
    → L2 normalize per token
    → [Documents only] Skiplist filter (remove punctuation tokens)
    → Output: number[][] (variable-length array of 128d token vectors)

Edge model (lateon-code-edge):
  Input text
    → Tokenizer (shared vocab, 50370 tokens)
    → ModernBERT backbone (7 layers, per-token hidden states, 256d)
    → Dense projection 1: 256 → 512 (no bias)
    → Dense projection 2: 512 → 48 (no bias)
    → L2 normalize per token
    → [Documents only] Skiplist filter (remove punctuation tokens)
    → Output: number[][] (variable-length array of 48d token vectors)
```

This is different from a dense embedding call. The output is **multiple vectors
per input**, not one.

### Query encoding — NO [MASK] padding

**Verified from the actual LateOn-Code `config_sentence_transformers.json`
on HuggingFace (fetched 2026-02-28):**

```json
{
  "query_prefix": "[Q] ",
  "document_prefix": "[D] ",
  "query_length": 256,
  "document_length": 2048,
  "do_query_expansion": false,
  "attend_to_expansion_tokens": false,
  "skiplist_words": ["!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/", ":", ";", "<", "=", ">", "?", "@", "[", "\\", "]", "^", "_", "`", "{", "|", "}", "~"]
}
```

**Key facts:**
- `do_query_expansion = false` — LateOn-Code was NOT trained with [MASK]
  query expansion. Do NOT pad queries with [MASK] tokens.
- `query_length = 256` — max query token length is 256 (NOT 32).
- `attend_to_expansion_tokens = false` — expansion tokens are not used.

**⚠️ Note:** PyLate's library defaults are `do_query_expansion=True` and
`query_length=32`, but the model's saved config overrides these defaults.
The LateOn-Code authors explicitly disabled query expansion. Respect the
model's config, not the library defaults.

When encoding queries:
1. Prepend `[Q] ` prefix to the text
2. Tokenize (up to `query_length` = 256 tokens)
3. Forward through the model
4. Project (768→128 or 256→512→48)
5. L2 normalize per token
6. Keep ALL token embeddings — **no skiplist filtering on queries**

When encoding documents:
1. Prepend `[D] ` prefix to the text
2. Tokenize (up to `document_length` = 2048 tokens)
3. Forward through the model
4. Project (768→128 or 256→512→48)
5. L2 normalize per token
6. Apply skiplist filtering (remove punctuation token embeddings)

**Critical asymmetry:** Queries keep ALL tokens. Documents filter skiplist.
This asymmetry comes from PyLate's encoding logic and is confirmed by the
skiplist_words config. Since we load via ONNX (not PyLate), `encodeQuery()`
and `encodeDocuments()` MUST replicate this asymmetry correctly.

---

## SOTA Landscape (February 2026)

### Why LateOn-Code is the right model

LateOn-Code is the current SOTA for late interaction code retrieval. No
competing multi-vector model targets code specifically. Context:

- Built by LightOn (Antoine Chaffin, Raphael Sourty) — the same team behind
  PyLate, GTE-ModernColBERT, ModernBERT, and the PyLate training library.
- Base LateOn model crosses 57 on BEIR — SOTA by 2.5 points for late interaction.
- Fine-tuned on CoIR training sets with nv-retriever hard negative mining.
- On MTEB Code v1: 74.12 avg (full), 66.64 avg (edge). The edge model (17M)
  matches embeddinggemma-300M performance; the full model (149M) matches
  Qwen3-embedding-0.6B — models 2-4x larger.
- Apache 2.0 license.

The dense model CoIR leaderboard top is SFR-Embedding-Code-2B (2B params,
67.41 avg). LateOn-Code achieves 74.12 at 149M params — the multi-vector
architecture provides a fundamental quality advantage for code retrieval.

### Ecosystem advances we must not ignore

The late interaction field has advanced significantly since ColBERT v1 (2020).
Our integration plan must incorporate these, not just the model swap:

**1. FastPLAID / NextPLAID (LightOn, Feb 2026)**

LightOn ships two purpose-built multi-vector indexes:
- **FastPLAID**: Offline bulk indexing with centroid-based compression.
- **NextPLAID**: Streaming multi-vector database server for serving.

These implement PLAID (CIKM 2022): centroid pruning + residual compression.
PLAID reduces CPU latency ~45x vs brute-force MaxSim for **full-corpus
retrieval** (millions of passages).

**Scale check:** Sweet Search uses ColBERT as a **reranker over ~20 candidates**
(config: `stage3Candidates: 20`), not a first-stage retriever. MaxSim over 20
documents × ~100 tokens each takes microseconds on CPU. PLAID-style centroid
pruning is designed for scoring millions of passages — it's irrelevant at our
reranking scale. Even after Phase 6 increases the candidate set to 50-100
(post graph expansion), brute-force MaxSim remains fast.

**Decision**: PLAID/centroid pruning is NOT needed for our architecture. If we
ever promote ColBERT to a first-stage retriever (replacing the binary→int8 ANN
pipeline), revisit this. For now, brute-force MaxSim on the candidate set is
the correct approach.

However, NextPLAID/FastPLAID IS relevant for **index storage compression** —
PLAID's residual compression reduces on-disk token storage ~10x. See Phase 7.

**2. MUVERA (Google, NeurIPS 2024)**

Converts multi-vector retrieval to single-vector MIPS via Fixed Dimensional
Encodings (FDEs). Already integrated in Weaviate 1.31 and Qdrant 0.7.2+.

**Scale check:** Same as PLAID — MUVERA is for full-corpus first-stage
retrieval. Since we use ColBERT as a reranker, MUVERA is not applicable to our
current architecture. Noted for awareness only.

**3. Token pruning and storage reduction (ECIR 2025)**

Multiple techniques reduce ColBERT index storage:
- **Static pruning**: Remove low-impact token embeddings. 50% reduction, ~3%
  quality loss on NL benchmarks. **⚠️ Code caveat**: IDF-based pruning is
  riskier for code than for natural language. Common code tokens like `return`,
  `function`, `class`, `async` carry structural meaning. The skiplist already
  handles punctuation (`{`, `}`, `(`, `)`, etc.). Additional pruning beyond
  the skiplist needs code-specific validation.
- **ConstBERT** (Pinecone): Requires retraining a new model architecture.
  NOT applicable to pre-trained LateOn-Code.
- **LeapMV**: Requires training a neural pruning classifier. NOT applicable
  to pre-trained LateOn-Code.
- **PyLate native token pooling**: Library feature that aggregates nearby
  token embeddings. Supported by PyLate at encode time (`pool_factor`
  parameter). Could be applied during indexing without retraining.

**Decision**: Phase 3 stores all tokens (correctness first). Phase 7 explores
PyLate's `pool_factor` (document-only, no retraining needed) and skiplist-based
pruning as opt-in storage reduction. IDF-based pruning deferred until
code-specific validation shows it's safe. See Phase 7 below.

**4. ColGrep (LightOn, Feb 2026)**

Rust-based search tool for coding agents, using LateOn-Code + NextPLAID.
Benchmarked against Claude Code's grep: 70% win rate, 56% fewer search ops,
60K fewer tokens per complex query. This is the **reference implementation**
for LateOn-Code in a code search context.

**Decision**: Study ColGrep's query processing pipeline in Phase 1 to validate
our own `encodeQuery()` / `encodeDocuments()` implementation — especially
prefix handling, skiplist token IDs, and encoding asymmetry (no skiplist on
queries, skiplist on documents).

**5. pylate-rs (LightOn, Feb 2026)**

Rust/Candle-based ColBERT inference without PyTorch/Transformers dependencies.
Model spawning in milliseconds. Could serve as an alternative inference backend
to ONNX Runtime for Node.js (via N-API bindings or subprocess).

**Decision**: ONNX Runtime is our primary path (proven, existing pattern).
Note pylate-rs as Fallback C in Phase 1 if both transformers.js and direct
ORT paths have issues.

**6. Reason-ModernColBERT (LightOn, 2026)**

150M model outperforming 7B models on BRIGHT (reasoning-intensive retrieval).
Not code-specific, but demonstrates late interaction's strength on complex
queries. Potential future model candidate if reasoning-heavy code queries
(e.g., "find the function that handles race conditions in the connection pool")
prove to be a bottleneck.

**7. Transformers.js v4 (released Feb 9, 2026)**

Better ONNX support, WebGPU acceleration. Phase 1 validation script MUST
test with v4 specifically (not v3). Check `@huggingface/transformers` version
in package.json.

---

## Expected MRR Impact (with `lateon-code` 128d)

| Benchmark | Current MRR | Expected | Delta | Confidence |
|-----------|-------------|----------|-------|------------|
| Java (CSN) | 34.8% | 50-60% | +15-25 | HIGH |
| JavaScript (CSN) | 51.7% | 60-68% | +8-16 | MEDIUM |
| JavaScript (GCSN) | 65.5% | 72-78% | +7-13 | MEDIUM |
| CodeSearchNet avg | 66.4% | 72-78% | +6-12 | MEDIUM |
| CrossCodeEval | 12.0% | 15-20% | +3-8 | LOW |
| AdvTest | 91.5% | 92-94% | +0.5-2.5 | LOW |

---

## Configuration Design

### Current state (what exists)

```js
// core/config.js:815 — global, partially dead
export const COLBERT_CONFIG = {
  enabled: true,
  model: 'jinaai/jina-colbert-v2',   // DEAD — never loaded at runtime
  tokenDimension: 128,
  compressedDimension: 64,
  maxTokensPerDoc: 512,
  quantization: 'int8',
  useLocal: true,
  blendWeight: 0.3,
};

// core/colbert-index.js:24 — local, SEPARATE, controls actual storage
const COLBERT_CONFIG = {
  tokenDim: 64,
  maxTokensPerDoc: 256,
  useInt8: true,
  indexPath: DB_PATHS.colbert || '...',
};
```

CLI: `--colbert` / `--no-colbert` (search-cli.js), `--no-colbert` (indexer)

### Target config

```js
// core/config.js — new COLBERT_CONFIG
export const COLBERT_CONFIG = {
  // false = disabled, 'lateon-code' = full 149M, 'lateon-code-edge' = 17M
  model: process.env.SWEET_SEARCH_COLBERT_MODEL || 'lateon-code',

  get enabled() {
    return !!this.model && this.model !== 'false';
  },

  models: {
    'lateon-code': {
      hfId: 'lightonai/LateOn-Code',
      onnxFile: 'model_int8.onnx',          // 150 MB INT8
      tokenDimension: 128,                   // output of 1_Dense projection
      projectionLayers: 1,                   // 768→128 (single stage)
      maxQueryLength: 256,
      maxDocLength: 2048,
      queryPrefix: '[Q] ',
      docPrefix: '[D] ',
      diskSize: '~150 MB',
    },
    'lateon-code-edge': {
      hfId: 'lightonai/LateOn-Code-edge',
      onnxFile: 'model.onnx',               // 68 MB FP32 (no INT8 yet)
      tokenDimension: 48,                    // final output after TWO projections
      projectionLayers: 2,                   // 256→512→48 (not single-stage!)
      maxQueryLength: 256,
      maxDocLength: 2048,
      queryPrefix: '[Q] ',
      docPrefix: '[D] ',
      diskSize: '~68 MB',
    },
  },

  get activeModel() { return this.models[this.model] || null; },
  get tokenDimension() { return this.activeModel?.tokenDimension || 128; },
  get hfModelId() { return this.activeModel?.hfId || null; },

  // Storage: always int8-quantize the token vectors for the index
  quantization: 'int8',
  blendWeight: 0.3,     // tune per-model in Phase 5
};
```

Delete the local `COLBERT_CONFIG` in `colbert-index.js:24` — import global.

### Configuration layers (precedence high to low)

| Layer | How | Example |
|-------|-----|---------|
| JS API | `new SweetSearch({ colbertModel: 'lateon-code-edge' })` | Programmatic |
| Env var | `SWEET_SEARCH_COLBERT_MODEL=lateon-code-edge` | CI/CD, Docker |
| Per-project | `"colbertModel": "lateon-code-edge"` in `.sweet-search.config.json` | Per-repo |
| Default | `'lateon-code'` in config.js | Best quality |

Disable at any layer: set to `false` or `"false"`.

### `loadProjectConfig` wiring

`loadProjectConfig()` currently returns `{ include, exclude, maxFileSize, ... }`.
Add `colbertModel` to the known keys (config.js:1315) and the return object.

The caller (`index-codebase-v21.js` and `sweet-search.js`) reads the returned
value and sets `COLBERT_CONFIG.model` before any ColBERT code runs:

```js
const projectConfig = loadProjectConfig(projectRoot);
if (projectConfig.colbertModel !== undefined) {
  COLBERT_CONFIG.model = projectConfig.colbertModel;
}
```

This happens once at startup, before indexing or search begins.

### CLI surface

```
Indexer:
  --no-colbert                      skip ColBERT index entirely (existing)
  --colbert-model=lateon-code-edge  index with edge model (NEW)

Search CLI:
  --colbert                         use ColBERT with default model (existing)
  --no-colbert                      skip ColBERT scoring (existing)
  --colbert-model=lateon-code-edge  use edge model for this query (NEW)

Eval:
  --use-colbert=true/false          existing
  --colbert-model=lateon-code-edge  NEW
```

### Index/query model consistency

Store `modelId` in the serialized ColBERT index header. On load, compare with
active config. If they differ, log a warning and skip ColBERT scoring (don't
crash). Example:

```
[ColBERT] Index built with lateon-code (128d) but config says lateon-code-edge (48d).
          Skipping ColBERT scoring. Re-index to use the new model.
```

### Model download and caching

Both ONNX files are downloaded via `@huggingface/transformers` (same as
CodeRankEmbed). Default cache: `~/.cache/huggingface/hub/`. First-run cost:
- `lateon-code`: ~150 MB download (INT8)
- `lateon-code-edge`: ~68 MB download

No additional setup required. `@huggingface/transformers` handles download,
caching, and ONNX Runtime session creation.

---

## Phase 1: Validate ONNX Loading (concrete steps, no production code yet)

### 1.1 Verify ONNX models load in Node.js

**Prerequisite:** Ensure `@huggingface/transformers` is v4+ (released Feb 9,
2026). Check `package.json` — if v3, upgrade first.

Write a throwaway script `scripts/test-lateon-onnx.mjs`:

```js
import { AutoTokenizer, AutoModel } from '@huggingface/transformers';

// Test full model (INT8, 150MB)
const tokenizer = await AutoTokenizer.from_pretrained('lightonai/LateOn-Code');
const model = await AutoModel.from_pretrained('lightonai/LateOn-Code', {
  quantized: true,   // loads model_int8.onnx
});

const inputs = tokenizer('[Q] getUserById', { padding: true, truncation: true, max_length: 256 });
const outputs = await model(inputs);
console.log('Output shape:', outputs.last_hidden_state.dims);
// Expected: [1, seq_len, 768] — then we need to apply the 1_Dense projection

// Check if transformers.js handles the 1_Dense projection automatically
// or if we need to load it separately
```

Key questions this script answers:
- Does `@huggingface/transformers` v4 load PyLate ONNX models?
- Does it auto-apply the `1_Dense` linear projection, or do we get raw 768d?
- If raw 768d: we need to load `1_Dense/model.safetensors` (393KB) and apply
  the 768→128 projection manually (single matrix multiply, no bias).
- What is the actual inference latency on CPU?

### 1.2 Test edge model — TWO-STAGE PROJECTION

Same script with `lightonai/LateOn-Code-edge`. **Critical**: the edge model
has TWO Dense layers (256→512→48), not one. Verify:
- Raw backbone output is 256d
- After projection 1: 512d
- After projection 2: 48d
- If projections are manual, load BOTH weight matrices from `1_Dense/` and
  `2_Dense/` (or however the ONNX export names them — inspect the model files)

```js
// Edge model: two sequential projections
function projectEdge(hiddenState, weight1, weight2) {
  // Step 1: 256d → 512d
  const intermediate = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    let sum = 0;
    for (let j = 0; j < 256; j++) {
      sum += weight1[i * 256 + j] * hiddenState[j];
    }
    intermediate[i] = sum;
  }
  // Step 2: 512d → 48d
  const result = new Float32Array(48);
  for (let i = 0; i < 48; i++) {
    let sum = 0;
    for (let j = 0; j < 512; j++) {
      sum += weight2[i * 512 + j] * intermediate[j];
    }
    result[i] = sum;
  }
  return result;
}
```

### 1.3 Validate query/document encoding asymmetry

**Confirmed from LateOn-Code config:** `do_query_expansion=false`,
`query_length=256`. No [MASK] padding is used.

Validate the encoding pipeline:
```js
// Query encoding:
// 1. Prepend "[Q] " prefix to text
// 2. Tokenize (max_length=256, truncation=true, padding=true)
// 3. Forward through model
// 4. Project (768→128 or 256→512→48)
// 5. L2 normalize per token
// 6. Keep ALL tokens — NO skiplist filtering

// Document encoding:
// 1. Prepend "[D] " prefix to text
// 2. Tokenize (max_length=2048, truncation=true, padding=true)
// 3. Forward through model
// 4. Project (768→128 or 256→512→48)
// 5. L2 normalize per token
// 6. Apply skiplist: remove embeddings for punctuation tokens
```

Validate by checking:
- Query output retains all token embeddings (no filtering)
- Document output has fewer tokens than input (skiplist removes punctuation)
- Skiplist token IDs match the 32 punctuation chars from the model config

### 1.4 Study ColGrep reference implementation

Before writing production code, study ColGrep's query/document processing
pipeline as a reference for correctness:
- How does ColGrep handle `[Q] `/`[D] ` prefixes?
- Does ColGrep apply skiplist only to documents (not queries)?
- What skiplist token IDs does ColGrep filter? Match our 32-char list.
- How does ColGrep handle the edge model's two-stage projection?
- Does ColGrep use `query_length=256` (matching LateOn-Code config)?

ColGrep source: `github.com/lightonai/next-plaid` (includes ColGrep).
Also check `pylate/models/colbert.py` for the Python reference.

### 1.5 Measure latency

Run 100 queries through each model, measure:
- Full model (INT8): expected ~15-30ms per query on CPU
- Edge model (FP32): expected ~1-5ms per query on CPU
- Both: tokenization time separately from inference time
- Latency vs query length (short queries vs near-256-token queries)

### 1.6 Gate

Phase 1 is complete when:
- Both ONNX models load and produce per-token vectors in Node.js
- We know whether projection layers are automatic or manual
- Edge model's two-stage projection (256→512→48) is confirmed working
- Query encoding confirmed: no [MASK] padding, max 256 tokens, no skiplist
- Document encoding confirmed: skiplist filtering applied, max 2048 tokens
- ColGrep's processing pipeline is reviewed for correctness validation
- Latency is measured for both models
- We have confirmed the output dimensions (128d full, 48d edge)

If `@huggingface/transformers` v4 does NOT support PyLate models:
- Fallback A: load the ONNX model directly via `onnxruntime-node` (same as
  CodeRankEmbed's direct ORT path in `embedding-local-model.js`)
- Fallback B: use the `pylate-onnx-export` tool to produce a self-contained
  ONNX that includes the projection layer(s)
- Fallback C: use `pylate-rs` (Rust/Candle inference) as a subprocess or
  N-API native addon — zero PyTorch dependency, millisecond model spawning

---

## Phase 2: Config + Model Loader (new code, no changes to pipeline)

### 2.1 Implement new `COLBERT_CONFIG`

Replace the dead config in `config.js:815` with the target config (see
Configuration Design section). Add `SWEET_SEARCH_COLBERT_MODEL` env var.
Add `colbertModel` to `loadProjectConfig` known keys and return value.

### 2.2 Create `core/colbert-model.js` (model singleton)

Module-level singleton (same pattern as `embedding-local-model.js:289`):

```js
let colbertPipeline = null;
let loadPromise = null;

export async function getColbertPipeline() {
  if (colbertPipeline) return colbertPipeline;
  if (loadPromise) return loadPromise;
  loadPromise = loadModel();
  colbertPipeline = await loadPromise;
  return colbertPipeline;
}
```

Exposed API:
- `getColbertPipeline()` — lazy singleton, returns null if disabled
- `encodeQuery(text) → Float32Array[]` — tokenize with `[Q] ` prefix
  (max 256 tokens), forward, project, L2 normalize. **NO skiplist
  filtering on queries** — keep ALL token embeddings. No [MASK] padding
  (LateOn-Code config: `do_query_expansion=false`).
- `encodeDocuments(texts) → Float32Array[][]` — batch, `[D] ` prefix
  (max 2048 tokens), forward, project, L2 normalize, **then apply skiplist
  filtering** (remove punctuation token embeddings). Returns array of
  (array of token vectors) per document.
- `unloadColbertModel()` — release memory (mirrors `unloadLocalModel()`)
- `isColbertModelLoaded()` — status check

The projection step may need to be applied manually if `@huggingface/transformers`
doesn't handle it. **The two models have different projection architectures:**

```js
// Full model: SINGLE projection (768 → 128)
// weight: Float32Array of shape [128, 768] from 1_Dense/model.safetensors
function projectFull(hiddenState, weight) {
  const result = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    let sum = 0;
    for (let j = 0; j < 768; j++) {
      sum += weight[i * 768 + j] * hiddenState[j];
    }
    result[i] = sum;
  }
  return result;
}

// Edge model: TWO projections (256 → 512 → 48)
// weight1: Float32Array [512, 256], weight2: Float32Array [48, 512]
function projectEdge(hiddenState, weight1, weight2) {
  const intermediate = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    let sum = 0;
    for (let j = 0; j < 256; j++) {
      sum += weight1[i * 256 + j] * hiddenState[j];
    }
    intermediate[i] = sum;
  }
  const result = new Float32Array(48);
  for (let i = 0; i < 48; i++) {
    let sum = 0;
    for (let j = 0; j < 512; j++) {
      sum += weight2[i * 512 + j] * intermediate[j];
    }
    result[i] = sum;
  }
  return result;
}
```

Generalize with a `projectTokens(hiddenStates, projectionLayers)` function
that applies N sequential matrix multiplies. The model config's
`projectionLayers` count (1 for full, 2 for edge) drives this.

Both indexing (`indexer-ann.js`) and querying (`search-semantic.js`) import from
`colbert-model.js`. The singleton ensures the model is loaded once and shared.

### 2.3 Wire into `ColBERTIndex`

- Delete local `COLBERT_CONFIG` in `colbert-index.js:24`, import global
- `tokenDim` reads from `COLBERT_CONFIG.tokenDimension`
- Add `async encodeQuery(text)` that delegates to `colbert-model.js`
- Store `modelId` in serialized index header (for consistency check on load)
- No changes to `add()`, `getTokens()`, `maxSimScore()`, `scoreWithColBERT()`

### 2.4 Tests

- `tests/colbert-model.test.js`: model loading (mock ONNX), query encoding
  shape validation (max 256 tokens), document encoding (max 2048 tokens),
  prefix insertion (`[Q] ` / `[D] `), **no [MASK] padding on queries**
  (verify `do_query_expansion=false` is respected), **skiplist asymmetry**
  (verify queries keep ALL tokens, documents filter punctuation),
  **edge model two-stage projection** (verify 256→512→48 produces different
  results than a hypothetical single 256→48)
- `tests/colbert-config.test.js`: config from env, from project config, from
  default. `enabled` getter. Model registry lookup. Unknown model ID → null.
  `false` / `"false"` disables. **`projectionLayers` count per model.**

### 2.5 Gate

- Config resolves model correctly from all layers
- `colbert-model.js` encodes queries (128d) and documents (128d) with full model
- `colbert-model.js` encodes queries (48d) and documents (48d) with edge model
- `ColBERTIndex.scoreWithColBERT()` produces correct MaxSim with real tokens
- Unit tests pass

---

## Phase 3: Indexing Pipeline (replace pseudo-tokens with real ColBERT tokens)

### 3.1 Update `buildColBERTIndex` in `indexer-ann.js:171`

Replace:
```js
// OLD: calls CodeRankEmbed on individual lines
const megaResults = await getEmbeddings(megaBatch, { ... });
```

With:
```js
// NEW: calls LateOn-Code on full chunk text
const { encodeDocuments } = await import('./colbert-model.js');
const tokenArrays = await encodeDocuments(chunkTexts);
```

Key changes:
- Input: full chunk text (not per-line splitting). The model tokenizes internally.
  Remove per-line splitting logic (lines 220-224).
- Output: `tokenArrays[i]` is `Float32Array[]` (variable number of 128d or 48d
  token vectors per chunk). Pass directly to `colbert.add(chunkId, tokens)`.
- Volume: 1200 calls (one per chunk) instead of 9600 (16 lines per chunk).
  But each call returns ~50-200 token vectors depending on chunk length.

### 3.2 CLI: `--colbert-model=<id>`

Add to `index-codebase-v21.js` arg parsing:
```js
else if (arg.startsWith('--colbert-model=')) colbertModel = arg.split('=')[1];
```

### 3.3 Index format migration

- Bump serialized version from `'1.0'` to `'2.0'` in `colbert-index.js:256`
- Add `modelId`, `tokenDim`, and `tokenPruning` to the serialized header
- On load: if version < 2.0 or modelId mismatch, discard and log re-index message
- Reserve header fields for future: `centroidCount`, `compressionType`

### 3.4 Storage budget tracking

Log per-index storage stats after build:
```
[ColBERT] Index built: 12,847 chunks, 1,284,700 tokens (avg 100/chunk)
[ColBERT] Storage: 157 MB (128d × int8), Model: lateon-code
```

This data informs Phase 7 decisions on whether pruning/compression is needed.

### 3.5 Gate

- `node core/index-codebase-v21.js` builds v2.0 ColBERT index with `lateon-code`
- `--colbert-model=lateon-code-edge` works (48d tokens)
- `--no-colbert` still skips entirely
- Indexing wall time measured for both variants
- Index sizes measured (expect: ~50-200MB for full, ~15-60MB for edge)
- Storage stats logged per build

---

## Phase 4: Query Pipeline (use real MaxSim at search time)

### 4.1 Fix `semanticSearch3Stage`

In `search-semantic.js:143-184`, replace:
```js
const colbertScore = this.approximateColBERTScore(embedResult.float, docTokens);
```

With:
```js
const queryTokens = await this.colbertIndex.encodeQuery(query);
const scored = await this.colbertIndex.scoreWithColBERT(queryTokens, topCandidates);
```

### 4.2 Delete `approximateColBERTScore`

Remove from `sweet-search.js:342-349`. It's the pseudo-approximation.

### 4.3 Update `session-warmup.js`

`warmColbertViaServer` at line 424 checks `COLBERT_CONFIG.enabled`. This still
works with the new getter. But the warmup should also trigger the model lazy-
load. Currently it sends an HTTP request to the server — if the server hasn't
loaded the ColBERT model yet, the first real query pays the cold-start cost.

Add to the warmup plan (`buildWarmupPlan`, line 468):
```js
{
  name: 'colbert-model',
  phase: 'pre-ready',
  when: () => COLBERT_CONFIG.enabled,
  fn: async () => { await getColbertPipeline(); },
},
```

This pre-loads the ONNX model during session warmup instead of on first query.

### 4.4 CLI: `--colbert-model` for search

Add to `search-cli.js`:
```js
else if (arg.startsWith('--colbert-model=')) useColBERT = true; colbertModel = arg.split('=')[1];
```

### 4.5 Blend weight tuning

`blendWeight: 0.3` was set for pseudo-ColBERT. After Phase 4.1, sweep
per model variant on CodeSearchNet:
- `blendWeight: 0.2, 0.3, 0.4, 0.5, 0.6`
- Measure MRR per language per value
- Store optimal per-model in the model registry if they differ significantly
- Consider log-linear interpolation (standard in hybrid retrieval) as an
  alternative to the current linear blend:
  `score = α * log(1 + semanticScore) + (1-α) * log(1 + colbertScore)`

### 4.6 Query token caching

Cache ColBERT query token embeddings in the LRU cache (`embedding-cache.js`).
Key: `colbert:<model>:<query>`, value: `Float32Array[]`.
The `shouldRunColBERT` guard at `search-semantic.js:138` already skips for
cached embeddings — extend this to check ColBERT token cache too.

Edge model at ~1-3ms may not need caching. Full model at ~15-30ms benefits.

### 4.7 Gate

- `semanticSearch3Stage` uses real per-token MaxSim scoring
- `approximateColBERTScore` is deleted
- Both model variants work at query time
- Model mismatch (indexed with A, querying with B) degrades gracefully
- Session warmup pre-loads ColBERT model
- Blend weight tuned per model
- Query latency measured: target <50ms full, <5ms edge

---

## Phase 5: Benchmark and Enable

### 5.1 Run benchmarks (all three configs)

```bash
# Full model (149M, 128d):
SWEET_SEARCH_COLBERT_MODEL=lateon-code \
  node eval/run_benchmark.js --benchmark=codesearchnet --build-colbert=true --use-colbert=true
SWEET_SEARCH_COLBERT_MODEL=lateon-code \
  node eval/run_benchmark.js --benchmark=gencodesearchnet --build-colbert=true --use-colbert=true

# Edge model (17M, 48d):
SWEET_SEARCH_COLBERT_MODEL=lateon-code-edge \
  node eval/run_benchmark.js --benchmark=codesearchnet --build-colbert=true --use-colbert=true
SWEET_SEARCH_COLBERT_MODEL=lateon-code-edge \
  node eval/run_benchmark.js --benchmark=gencodesearchnet --build-colbert=true --use-colbert=true

# Baseline (no ColBERT — already have from 2026-02-19):
node eval/run_benchmark.js --benchmark=codesearchnet --use-colbert=false
```

Also run COIR with all three configs.

### 5.2 Produce comparison table

| Config | Java MRR | JS MRR | Go MRR | Avg MRR | p50 lat | Index time | Disk |
|--------|----------|--------|--------|---------|---------|------------|------|
| No ColBERT (baseline) | 34.8% | 51.7% | 93.6% | 66.4% | 191ms | 220s | 0 |
| lateon-code (128d) | ? | ? | ? | ? | ? | ? | ~150MB |
| lateon-code-edge (48d) | ? | ? | ? | ? | ? | ? | ~68MB |

### 5.3 Decision gates

| Condition | Action |
|-----------|--------|
| Full model: Java MRR +10pts AND latency <50ms | Default to `lateon-code` |
| Full model: latency >50ms but edge <10ms AND edge within 5pts | Default to `lateon-code-edge` |
| Both models: Java MRR <5pts improvement | Investigate integration bug before shipping |
| Indexing time >2x baseline | Make ColBERT opt-in only (default `false`) |
| Both models disappoint after investigation | Keep disabled, revisit when newer models appear |

### 5.4 Set defaults and update eval profiles

Update `COLBERT_CONFIG` default model to the winner. Update benchmark profiles
in `eval/run_all.js:90-93` and `eval/run_benchmark.js:110-113`:

```js
balanced: { buildColBERT: true, useColBERT: true, ... }
```

### 5.5 Document

Add three-config comparison to `eval/results/`.

---

## Phase 6: Pipeline Restructuring — COMPLETE (2026-02-28)

ColBERT moved from `semanticSearch3Stage` (Stage 2.5) to `_applyPostRetrieval`
(after graph expansion). All search modes now benefit from ColBERT scoring on
expanded candidate sets.

Pipeline achieved:
```
BM25 || (Binary -> Int8) -> Fusion -> Expand -> ColBERT -> Reranker -> Budget
```

### 6.1 Implementation (done)

- Removed Stage 2.5 ColBERT block from `search-semantic.js` (lines 137-187)
- Added ColBERT rerank in `search-postprocess.js` after graph expansion, before
  translation fallback and quality scoring
- Blend formula: `0.3 * colbertScore + 0.7 * baseScore` (works across all modes —
  fused scores, int8 scores, and expanded scores are all in [0,1] range)
- Only top `stage3Candidates` (default 20) are scored, remainder preserved
- Graceful fallback: encoding failures log error and preserve original scores
- `stats.colbert.position = 'post-expansion'` for diagnostics

### 6.2 Tests (done)

9 new tests in `tests/search-postprocess.test.js`:
- ColBERT runs and blends scores correctly
- Blend weight math verified (0.3*colbert + 0.7*base)
- Skip when useColBERT=false, no index, model mismatch, empty results
- Graceful failure on ONNX encoding error
- Only top N candidates scored (remainder preserved)
- Falls back to `this.useColBERT` when not specified in options

97 files, 2560 tests, 0 failures.

### 6.3 Benchmark comparison (pending)

Run `eval/run_benchmark.js` with graph expansion enabled to measure
ColBERT's effect on expanded candidates. The CodeSearchNet benchmark
doesn't use graph expansion, so a CrossCodeEval or project-specific
benchmark is needed to see the full benefit.

---

## Phase 7: Storage Optimization — 7.1+7.2 COMPLETE (2026-02-28), 7.3 DEFERRED

### 7.1 Token pooling — COMPLETE

`poolTokens()` in `colbert-model.js`: groups consecutive tokens and averages
their vectors, then L2 re-normalizes. First token always protected (PyLate
convention). Applied at indexing time only (documents, never queries).

- CLI: `--colbert-pool=N` (default 1 = no pooling)
- Passed through: `index-codebase-v21.js` → `indexer-phases.js` → `indexer-ann.js` → `encodeDocuments()`
- Index format v2.1: stores `poolFactor` in header
- `ColBERTIndex.getStats()` includes `poolFactor`

### 7.2 Extended skiplist — COMPLETE

`buildExtendedSkiplist()` in `colbert-model.js`: adds code-noise tokens to
the base 32-char punctuation skiplist. Explicitly curated (NOT IDF-based):
`\t`, `\n`, `\r`, `;`, `,`, `\`, `` ` ``. Cached after first build.

- CLI: `--colbert-skiplist=extended`
- Passed through same pipeline as poolFactor

### 7.3 PLAID residual compression — DEFERRED

Deferred until pooling + extended skiplist are insufficient. Would add K-means
clustering + quantized residuals for ~10x storage reduction. Complex to implement.

### Tests (13 new)

- `tests/colbert-model.test.js`: 7 new tests (poolTokens: 5, buildExtendedSkiplist: 2)
- `tests/eval/core-indexer-flags.test.js`: 4 new tests (--colbert-pool, --colbert-skiplist=extended)
- `tests/colbert-model.test.js`: 2 new tests (ColBERTIndex poolFactor)

97 files, 2573 tests, 0 failures.

---

## Key Files

| File | What to change | Phase |
|------|----------------|-------|
| `scripts/test-lateon-onnx.mjs` | **NEW** — throwaway ONNX loading + projection + encoding asymmetry validation | 1 |
| `core/config.js:815` | New `COLBERT_CONFIG` with model registry + `projectionLayers` | 2 |
| `core/config.js:1315` | Add `colbertModel` to `loadProjectConfig` | 2 |
| `core/colbert-model.js` | **NEW** — model singleton, encode API, skiplist asymmetry, N-stage projection | 2 |
| `core/colbert-index.js:24` | Remove local config, import global, store modelId | 2-3 |
| `core/indexer-ann.js:171` | Replace `getEmbeddings()` with ColBERT model | 3 |
| `core/index-codebase-v21.js:87` | Add `--colbert-model` arg | 3 |
| `core/search-semantic.js:143` | Use `scoreWithColBERT` with real query tokens | 4 |
| `core/sweet-search.js:343` | Delete `approximateColBERTScore` | 4 |
| `core/sweet-search.js:58-59` | Read model config from new COLBERT_CONFIG | 4 |
| `core/session-warmup.js:468` | Add ColBERT model pre-load to warmup plan | 4 |
| `core/search-cli.js:324` | Add `--colbert-model` arg | 4 |
| `eval/run_benchmark.js:112` | Add `--colbert-model`, update profiles | 5 |
| `eval/run_all.js:92` | Same | 5 |
| `eval/lib/indexer.js` | Pass colbertModel through | 5 |
| `core/search-semantic.js` | Extract ColBERT into standalone rerank function, move after expansion | 6 |
| `core/search-fusion.js` | Wire ColBERT rerank into post-expansion pipeline | 6 |
| `core/colbert-index.js` | Add pool_factor support, extended skiplist, PLAID compression (optional) | 7 |
| `tests/colbert-model.test.js` | **NEW** — includes encoding asymmetry + two-stage projection tests | 2 |
| `tests/colbert-config.test.js` | **NEW** — includes `projectionLayers` per model | 2 |

## Existing Tests (4 files, no changes needed unless they break)

- `tests/session-warmup.test.js` — warmup with ColBERT
- `tests/eval/profiles.test.js` — profile flags
- `tests/eval/indexer.test.js` — indexer phases
- `tests/eval/core-indexer-flags.test.js` — `--no-colbert`

## Rollback

- Phase 1: delete throwaway script
- Phase 2-3: delete new files, no existing code modified yet
- Phase 4: revert `search-semantic.js`, restore `approximateColBERTScore`
- Phase 6: revert pipeline restructuring, ColBERT returns to pre-expansion position
- Phase 7: revert efficiency opts, fall back to brute-force MaxSim
- Any time: `SWEET_SEARCH_COLBERT_MODEL=false` disables entirely
- Each phase = separate commit/PR for clean revert

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `@huggingface/transformers` v4 can't load PyLate ONNX | MEDIUM | Fallback A: `onnxruntime-node` directly. Fallback B: `pylate-onnx-export`. Fallback C: `pylate-rs` subprocess |
| Full model: single `1_Dense` projection not auto-applied | HIGH | Manual matrix multiply (393KB weight file, trivial) |
| Edge model: two-stage projection not auto-applied | HIGH | Manual two-stage multiply — must load both weight matrices. Incorrect single-stage projection would silently produce wrong embeddings |
| Accidental [MASK] padding on queries | LOW | LateOn-Code config: `do_query_expansion=false`. Do NOT pad queries with [MASK] tokens. PyLate library defaults differ — always use model-saved config, not library defaults. |
| Skiplist applied to queries (should be doc-only) | MEDIUM | Queries keep ALL tokens. Only documents get skiplist filtering. Easy to get backwards in implementation. |
| Full model latency >50ms per query on CPU | MEDIUM | Default to edge model, offer full as opt-in. Query-time ColBERT is reranking (~20 candidates), so model inference dominates, not MaxSim scoring. |
| User indexes with model A, queries with B | CERTAIN | Model ID in index header, graceful skip + warning |
| MRR improvement < expected | LOW | Check in order: (1) no [MASK] padding on queries (model config: `do_query_expansion=false`), (2) skiplist NOT applied to queries, (3) projection correctness (2-stage for edge), (4) `[Q] `/`[D] ` prefixes present, (5) pipeline position (Phase 6), (6) blend weight |
| ColBERT before expansion limits gains | HIGH | Phase 6 moves ColBERT after expansion. Benchmark both positions. |
| Index too large (>500MB) on big repos | MEDIUM | Phase 7: PyLate pool_factor, extended skiplist, PLAID residual compression |
| First-run download annoys user | LOW | Same UX as CodeRankEmbed download; log progress |

## Reference Implementations (for validation)

When debugging quality or correctness issues, cross-reference against:

| Implementation | Language | What to check |
|----------------|----------|---------------|
| PyLate (`pylate/models/colbert.py`) | Python | Prefix handling, skiplist asymmetry, projection, config override logic |
| ColGrep (`lightonai/next-plaid`) | Rust | Query processing, skiplist token IDs, scoring |
| pylate-rs | Rust | Candle-based inference, projection layer handling |
| Stanford ColBERT (`stanford-futuredata/ColBERT`) | Python | MaxSim reference, PLAID indexing |
