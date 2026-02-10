# Semantic Search

Semantic search provides conceptual code search using vector embeddings and approximate nearest neighbor (ANN) search.

## Source Files

- **Main Pipeline**: `core/sweet-search.js`
- **Embedding Service**: `.claude/helpers/search-100x/embedding-service.js`
- **HNSW Index**: `.claude/helpers/search-100x/hnsw-index.js`
- **Binary HNSW Index**: `.claude/helpers/search-100x/binary-hnsw-index.js`
- **Reranking**: `.claude/helpers/search-100x/flashrank.js` (see [RERANKING.md](./RERANKING.md) for details)
- **Configuration**: `.claude/helpers/search-100x/config.js`

## Performance

| Stage | Target | Typical | Source |
|-------|--------|---------|--------|
| Embedding (cache hit) | <0.1ms | <0.1ms | `embedding-service.js` header: "Cache hit: <0.1ms (sub-millisecond)" |
| Embedding (Voyage API) | - | 50-100ms | `embedding-service.js` header: "Voyage API: ~50-100ms per batch" |
| HNSW lookup p50 | <1ms | 50-500us | `hnsw-index.js` header: "Target: <1ms p50 ANN lookup (often 50-500us)" |
| Binary HNSW search | ~100us | 50-200us | `binary-hnsw-index.js` header: "Stage 1: Binary HNSW (1000 candidates, ~100us)" |
| Reranking (cascaded) | ~15-350ms | 15-330ms | See [RERANKING.md](./RERANKING.md) - FlashRank (~15ms) + Voyage/Jina conditional |
| Total semantic | <150ms | 60-275ms | `sweet-search.js` header: "Semantic: ~275ms (bottleneck: Voyage API ~250ms)" |

## Embedding Service

**Source**: `embedding-service.js`

### Multi-Provider Architecture

**Source**: `embedding-service.js`, lines 1-24, `config.js`, lines 91-180

The embedding service supports tiered providers:

| Tier | Provider | Model | Dimensions | Use Case |
|------|----------|-------|------------|----------|
| 1 | Voyage | voyage-code-3 | 1024d (512d HNSW) | Best for code |
| 2 | Mistral | codestral-embed-2505 | 3072d (512d HNSW) | Alternative |
| 3 | Jina | jina-embeddings-v3 | 1024d (512d HNSW) | Multilingual |
| 4 | Local | Xenova/all-MiniLM-L6-v2 | 384d | Offline fallback |

### Cache Hierarchy

**Source**: `embedding-service.js`, lines 751-841

The `getEmbedding()` function uses a 4-tier cache hierarchy:

1. **LRU Cache** (exact match): <0.1ms lookup
2. **Vocabulary** (pre-computed): <0.1ms lookup, persisted to `query-vocabulary.json`
3. **Semantic Cache** (similarity-based): ~5-10ms, uses local model for cache keys
4. **Remote API** (Voyage/Mistral/Jina): ~50-250ms

**IMPORTANT**: The vocabulary file is `query-vocabulary.json`, NOT `vocabulary.bin`. The vocabulary stores pre-computed embeddings as JSON.

**Source**: `config.js`, lines 80-81

```javascript
// Query vocabulary cache
vocabulary: path.join(PROJECT_ROOT, '.sweet-search', 'query-vocabulary.json'),
```

### Vocabulary Class

**Source**: `embedding-service.js`, lines 173-244

```javascript
class Vocabulary {
  constructor(vocabPath) {
    this.vocabPath = vocabPath;  // Points to query-vocabulary.json
    this.terms = new Map();
    // ...
  }

  async load() {
    if (existsSync(this.vocabPath)) {
      const data = JSON.parse(await fs.readFile(this.vocabPath, 'utf-8'));
      // ...
    }
  }
}
```

### Semantic Cache

**Source**: `embedding-service.js`, lines 250-376

The SemanticCache uses a local model (Xenova/all-MiniLM-L6-v2) to compute cache keys, enabling similarity-based lookups:

```javascript
class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.85;  // Similarity threshold
    this.maxSize = options.maxSize ?? 500;
  }

  async findSimilar(text) {
    // Compute local embedding (~2-3ms)
    const localEmb = await this.computeLocalEmbedding(text);

    // Search for similar entries
    for (const entry of this.entries) {
      const similarity = this.cosineSimilarity(localEmb, entry.localEmb);
      if (similarity > this.threshold) {
        return { voyageEmb: entry.voyageEmb, similarity };
      }
    }
    return { voyageEmb: null, localEmb };
  }
}
```

### Matryoshka Truncation

**Source**: `embedding-service.js`, lines 901-905

Embeddings are truncated for HNSW to reduce memory and improve speed:

```javascript
export function truncateForHNSW(embedding) {
  const targetDim = EMBEDDING_CONFIG.hnswDimension;  // 512
  if (embedding.length <= targetDim) return embedding;
  return embedding.slice(0, targetDim);
}
```

### Binary Quantization

**Source**: `embedding-service.js`, lines 920-932

For the 3-stage pipeline, float embeddings are converted to binary:

```javascript
export function floatToBinary(embedding) {
  const numBytes = Math.ceil(embedding.length / 8);
  const binary = new Uint8Array(numBytes);

  for (let i = 0; i < embedding.length; i++) {
    if (embedding[i] > 0) {
      binary[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }
  return binary;
}
```

### Int8 Quantization

**Source**: `embedding-service.js`

For Stage 2 rescoring, float embeddings are quantized to int8 using per-vector max-abs scaling:

```javascript
export function floatToInt8(embedding) {
  // Per-vector max-abs scaling preserves relative magnitudes within each vector
  const maxAbs = Math.max(...embedding.map(Math.abs));
  if (maxAbs === 0) return new Int8Array(embedding.length);

  const int8 = new Int8Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    // Formula: int8[i] = round(float[i] / maxAbs * 127)
    int8[i] = Math.round(embedding[i] / maxAbs * 127);
  }
  return int8;
}
```

**Why per-vector scaling?** Each vector is normalized independently, preserving relative magnitudes within the vector while maximizing the use of the int8 range (-127 to 127).

### Int8 Cosine Similarity

**Source**: `embedding-service.js`

The `int8CosineSimilarity` function computes cosine similarity between int8-quantized vectors for Stage 2 rescoring:

```javascript
export function int8CosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Deprecated alias (kept for backward compatibility)
export const int8DotProduct = int8CosineSimilarity;
```

**Note**: The function was renamed from `int8DotProduct` to `int8CosineSimilarity` to better reflect its actual behavior (computing cosine similarity, not raw dot product). The old name is kept as a deprecated alias for backward compatibility.

## HNSW Index

**Source**: `hnsw-index.js`

### USearch Backend

**Source**: `hnsw-index.js`, lines 49-83

The HNSW index uses USearch (native, SIMD-accelerated) with pure JS fallback:

```javascript
async init() {
  try {
    this.usearchModule = await import('usearch');
    this.index = new Index({
      metric: 'cos',  // cosine similarity
      connectivity: this.M,
      dimensions: this.dimension,
      quantization: 'f32',
    });
  } catch (err) {
    // Fallback to pure JS implementation
    this.useFallback = true;
    this.vectors = [];
  }
}
```

### HNSW Configuration

**Source**: `config.js`, lines 384-402

```javascript
export const HNSW_CONFIG = {
  get dimension() {
    return EMBEDDING_CONFIG.hnswDimension;  // 512
  },
  M: 16,                     // Bi-directional links
  efConstruction: 200,       // Construction-time candidate list
  efSearch: 100,             // Query-time candidate list
  metric: 'cosine',
  maxElements: 100000,
};
```

## Binary HNSW Index (3-Stage Pipeline)

**Source**: `binary-hnsw-index.js`

### 3-Stage Retrieval Pipeline

**Source**: `sweet-search.js`, lines 270-459

The semantic search uses a 3-stage pipeline for efficiency:

| Stage | Component | Candidates | Latency | Description |
|-------|-----------|------------|---------|-------------|
| 1 | Binary HNSW | 1000 | ~100us | Hamming distance search |
| 2 | Int8 Rescore | 100 | ~1ms | Cosine similarity refinement |
| 3 | Rerank | 20 -> k | ~50-100ms | Cross-encoder scoring |

#### Stage 2: Int8 Rescoring Details

**Source**: `sweet-search.js`, Stage 2 rescoring

Stage 2 uses `int8CosineSimilarity` to refine the top candidates from Stage 1. Documents are rescored using their pre-computed int8 vectors.

**Missing Int8 Vector Handling**: When a document is missing its int8 vector during rescoring:
- Score is set to `0.0` (neutral, sorts to bottom of results)
- A `missingInt8: true` flag is added to the result object
- These documents are **filtered OUT** from skip-rerank threshold analysis to avoid poisoning the score spread calculations

This can occur for:
- Recently indexed documents not yet quantized
- Documents indexed before int8 quantization was added
- Index corruption or incomplete migrations

#### Binary HNSW Configuration

**Source**: `config.js`, lines 409-440

```javascript
export const BINARY_HNSW_CONFIG = {
  get dimension() {
    return Math.ceil(EMBEDDING_CONFIG.hnswDimension / 8);  // 64 bytes
  },
  M: 32,                     // More links (Hamming is cheap)
  efConstruction: 400,       // Higher ef for quality
  efSearch: 200,
  metric: 'hamming',
  maxElements: 500000,
  retrieval: {
    stage1Candidates: 1000,  // Binary HNSW retrieves
    stage2Candidates: 100,   // Int8 rescores
    stage3Candidates: 20,    // Reranker sees
  },
};
```

### Reranking Stage

**Source**: `flashrank.js` (see [RERANKING.md](./RERANKING.md) for full documentation)

The 3-stage pipeline uses **cascaded two-stage reranking**:

1. **Stage 1 (FlashRank)**: Always runs, ~15ms, free local inference
2. **Score Spread Analysis**: Determines if remote reranker is needed
3. **Stage 2 (Voyage/Jina)**: Conditional, ~80-350ms, API call

**Skip Optimization**: 60-80% of queries skip Stage 2 due to clear winner, tight cluster, or high confidence scores. See [RERANKING.md](./RERANKING.md) for thresholds and implementation details.

## Hybrid Search

**Source**: `sweet-search.js`, lines 747-830

### Convex Combination Fusion

**Source**: `sweet-search.js`, lines 648-730

Hybrid search uses Convex Combination (CC) fusion with route-specific alpha weights:

```javascript
const ROUTE_ALPHAS = {
  'identifier': 0.85,    // Heavy lexical (BM25)
  'conceptual': 0.25,    // Heavy semantic
  'structural': 0.90,    // Lexical + graph
  'mixed': 0.55,         // Balanced
};

// CC Formula: score = alpha * lexical_norm + (1-alpha) * semantic_norm
const ccScore = alpha * normLex + (1 - alpha) * normSem;
```

### RRF Fallback

**Source**: `sweet-search.js`, lines 775-824

Reciprocal Rank Fusion available via `fusion='rrf'`:

```javascript
// RRF Formula: RRF_score(d) = Sigma 1 / (k + rank_i(d))
const rrfContrib = 1 / (rrf_k + rank + 1);
```

## Warm Server Architecture

**Source**: `sweet-search.js`, lines 1295-1513

The search system maintains a warm HTTP server for fast subsequent searches:

- **First search**: ~1-2s (server startup + index load)
- **Subsequent**: ~6-10ms lexical, ~275ms semantic

### Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search?q=<query>&mode=auto&k=10` | GET | Execute search |
| `/health` | GET | Health check |
| `/stop` | GET | Shutdown server |

### Server Ports

- TCP: `localhost:9876`
- Unix socket: `/tmp/search.sock` (30-50% faster)

## Configuration Reference

### Embedding Configuration

**Source**: `config.js`, lines 201-242

```javascript
export const EMBEDDING_CONFIG = {
  provider: activeProvider.name,
  model: providerConfig.model,
  dimension: providerConfig.dimensions.full,
  hnswDimension: providerConfig.dimensions.hnsw,  // 512
  batchSize: providerConfig.batchSize,
  cache: {
    enabled: true,
    maxSize: 1000,
    vocabularyPath: DB_PATHS.vocabulary,  // query-vocabulary.json
    autoExpand: true,
    expansionThreshold: 3,
  },
};
```

### Performance Targets

**Source**: `config.js`, lines 597-607

```javascript
export const PERFORMANCE_TARGETS = {
  latency: {
    lexicalP50: 10,      // ms
    hnswLookupP50: 1,    // ms
    semanticP50: 150,    // ms
    rerankP50: 100,      // ms
  },
  accuracy: {
    topKRecall: 0.85,
  },
};
```

## Usage

### Programmatic API

```javascript
import { SweetSearch, warmSearch } from './sweet-search.js';

// Using warm singleton
const { results, stats } = await warmSearch("how does auth work", {
  k: 10,
  mode: 'semantic',
  rerank: true,
});

// Full control
const searcher = new SweetSearch({ verbose: true });
await searcher.init();
const { results } = await searcher.semanticSearch("auth", { k: 10 });
```

### CLI

```bash
# Auto-routing search
./ss "how does authentication work"

# Force semantic mode
./ss "auth patterns" --mode semantic

# With reranking disabled
./ss "query" --no-rerank

# Summary-first output (10x fewer tokens)
./ss "query" --summary

# JSON output
./ss "query" --json
```
