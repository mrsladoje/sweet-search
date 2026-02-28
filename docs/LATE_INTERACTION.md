# Late Interaction: LateOn-Code Migration Plan

Extracted from `docs/TODO.md` Sections 0, 8, and 26. Updated 2026-02-28.

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
- Token output: 256 → **48d** per token
- Same prefixes, max lengths, tokenizer, skiplist
- **ONNX already exported on HuggingFace:**
  - `model.onnx` — 68 MB
  - (no INT8 variant yet — could quantize ourselves, target ~20MB)
- MTEB Code v1 avg: **66.64**

### Cross-compatibility

**Embedding spaces are NOT compatible.** Full model outputs 128d tokens, edge
outputs 48d tokens. An index built with one model cannot be queried with the
other. The model ID must be stored in the index and checked at query time.

### Pipeline structure (both models)

```
Input text
  → Tokenizer (shared vocab, 50370 tokens)
  → ModernBERT backbone (per-token hidden states)
  → Linear projection (768→128 or 256→48, no bias, identity activation)
  → L2 normalize per token
  → Skiplist filter (remove punctuation tokens)
  → Output: number[][] (variable-length array of token vectors)
```

This is different from a dense embedding call. The output is **multiple vectors
per input**, not one.

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
      maxQueryLength: 256,
      maxDocLength: 2048,
      queryPrefix: '[Q] ',
      docPrefix: '[D] ',
      diskSize: '~150 MB',
    },
    'lateon-code-edge': {
      hfId: 'lightonai/LateOn-Code-edge',
      onnxFile: 'model.onnx',               // 68 MB FP32 (no INT8 yet)
      tokenDimension: 48,                    // output of 1_Dense projection
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
- Does `@huggingface/transformers` load PyLate ONNX models?
- Does it auto-apply the `1_Dense` linear projection, or do we get raw 768d?
- If raw 768d: we need to load `1_Dense/model.safetensors` (393KB) and apply
  the 768→128 projection manually (single matrix multiply, no bias).
- What is the actual inference latency on CPU?

### 1.2 Test edge model

Same script with `lightonai/LateOn-Code-edge`. Verify 256→48d output.

### 1.3 Measure latency

Run 100 queries through each model, measure:
- Full model (INT8): expected ~15-30ms per query on CPU
- Edge model (FP32): expected ~1-5ms per query on CPU
- Both: tokenization time separately from inference time

### 1.4 Gate

Phase 1 is complete when:
- Both ONNX models load and produce per-token vectors in Node.js
- We know whether `1_Dense` projection is automatic or manual
- Latency is measured for both models
- We have confirmed the output dimensions (128d full, 48d edge)

If `@huggingface/transformers` does NOT support PyLate models:
- Fallback A: load the ONNX model directly via `onnxruntime-node` (same as
  CodeRankEmbed's direct ORT path in `embedding-local-model.js`)
- Fallback B: use the `pylate-onnx-export` tool to produce a self-contained
  ONNX that includes the projection layer

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
- `encodeQuery(text) → Float32Array[]` — tokenize with `[Q] ` prefix,
  forward, project to 128d/48d, normalize, filter skiplist tokens
- `encodeDocuments(texts) → Float32Array[][]` — batch, `[D] ` prefix,
  same pipeline. Returns array of (array of token vectors) per document.
- `unloadColbertModel()` — release memory (mirrors `unloadLocalModel()`)
- `isColbertModelLoaded()` — status check

The projection step (768→128 or 256→48) may need to be applied manually if
`@huggingface/transformers` doesn't handle it. This is a single matrix multiply:

```js
// projection_weight: Float32Array of shape [128, 768] from 1_Dense/model.safetensors
function project(hiddenState, projectionWeight, outDim) {
  const result = new Float32Array(outDim);
  for (let i = 0; i < outDim; i++) {
    let sum = 0;
    for (let j = 0; j < hiddenState.length; j++) {
      sum += projectionWeight[i * hiddenState.length + j] * hiddenState[j];
    }
    result[i] = sum;
  }
  return result;
}
```

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
  shape validation, document encoding, skiplist filtering, prefix insertion
- `tests/colbert-config.test.js`: config from env, from project config, from
  default. `enabled` getter. Model registry lookup. Unknown model ID → null.
  `false` / `"false"` disables.

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
- Add `modelId` and `tokenDim` to the serialized header
- On load: if version < 2.0 or modelId mismatch, discard and log re-index message

### 3.4 Gate

- `node core/index-codebase-v21.js` builds v2.0 ColBERT index with `lateon-code`
- `--colbert-model=lateon-code-edge` works (48d tokens)
- `--no-colbert` still skips entirely
- Indexing wall time measured for both variants
- Index sizes measured (expect: ~50-200MB for full, ~15-60MB for edge)

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

## Phase 6 (Future): Pipeline Restructuring (TODO Section 26)

Separate project. Currently ColBERT runs inside `semanticSearch3Stage` BEFORE
graph expansion, so expanded entities never get ColBERT scoring.

Target:
```
Current: BM25 || (Binary -> Int8 -> ColBERT -> Reranker) -> Fusion -> Expand -> Budget
Target:  BM25 || (Binary -> Int8) -> Fusion -> Expand -> ColBERT -> Reranker -> Budget
```

Do not combine with the model migration PR.

---

## Key Files

| File | What to change | Phase |
|------|----------------|-------|
| `scripts/test-lateon-onnx.mjs` | **NEW** — throwaway ONNX validation | 1 |
| `core/config.js:815` | New `COLBERT_CONFIG` with model registry | 2 |
| `core/config.js:1315` | Add `colbertModel` to `loadProjectConfig` | 2 |
| `core/colbert-model.js` | **NEW** — model singleton, encode API | 2 |
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
| `tests/colbert-model.test.js` | **NEW** | 2 |
| `tests/colbert-config.test.js` | **NEW** | 2 |

## Existing Tests (4 files, no changes needed unless they break)

- `tests/session-warmup.test.js` — warmup with ColBERT
- `tests/eval/profiles.test.js` — profile flags
- `tests/eval/indexer.test.js` — indexer phases
- `tests/eval/core-indexer-flags.test.js` — `--no-colbert`

## Rollback

- Phase 1: delete throwaway script
- Phase 2-3: delete new files, no existing code modified yet
- Phase 4: revert `search-semantic.js`, restore `approximateColBERTScore`
- Any time: `SWEET_SEARCH_COLBERT_MODEL=false` disables entirely
- Each phase = separate commit/PR for clean revert

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `@huggingface/transformers` can't load PyLate ONNX | MEDIUM | Load via `onnxruntime-node` directly (existing pattern in `embedding-local-model.js`) |
| `1_Dense` projection not auto-applied | HIGH | Manual matrix multiply (393KB weight file, trivial) |
| Full model latency >50ms on CPU | MEDIUM | Default to edge model, offer full as opt-in |
| User indexes with model A, queries with B | CERTAIN | Model ID in index header, graceful skip + warning |
| MRR improvement < expected | LOW | If real ColBERT scores low, it's an integration bug (check prefixes, projection, normalization) |
| First-run download annoys user | LOW | Same UX as CodeRankEmbed download; log progress |
