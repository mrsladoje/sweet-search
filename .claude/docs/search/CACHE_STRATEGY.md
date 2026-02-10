# Cache Strategy (4-Tier Hierarchy)

Documentation of the embedding service's multi-tier caching architecture.

## Source Files

- **Embedding Service**: `.claude/helpers/search-100x/embedding-service.js`
  - `grep -n "async getEmbedding" embedding-service.js` → main entry point
  - `grep -n "class LRUCache" embedding-service.js` → Tier 1
  - `grep -n "class SemanticCache" embedding-service.js` → Tier 3
- **Config DB_PATHS**: `.claude/helpers/search-100x/config.js`
  - `grep -n "DB_PATHS" config.js` → all database paths

## Overview

The embedding service implements a 4-tier cache hierarchy to minimize API calls and maximize response speed:

```
Query arrives
    |
    v
[Tier 1: LRU Cache] ----hit----> Return (<0.1ms)
    |
    miss
    v
[Tier 2: Vocabulary] ---hit----> Return (<0.1ms)
    |
    miss
    v
[Tier 3: SemanticCache] -hit---> Return (~5-10ms)
    |
    miss
    v
[Tier 4: Remote API] ----------> Return (~250ms)
    |
    v
Store in all applicable caches
```

## Tier 1: LRU Cache (In-Memory)

**Source**: `LRUCache` class (`grep -n "class LRUCache" embedding-service.js`)

**Characteristics**:
- Exact string match only
- Session-scoped (cleared on process exit)
- Tracks hit counts for vocabulary expansion

```javascript
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hitCount = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    this.cache.delete(key);       // Move to end (most recent)
    this.cache.set(key, value);
    this.hitCount.set(key, (this.hitCount.get(key) || 0) + 1);
    return value;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);  // Evict oldest
    }
    this.cache.set(key, value);
  }
}
```

**Configuration** (`grep -n "cache:" config.js`):
```javascript
cache: {
  enabled: true,
  maxSize: 1000,
  autoExpand: true,           // Auto-add frequent queries to vocabulary
  expansionThreshold: 3,      // Queries used 3+ times get persisted
}
```

**Performance**: <0.1ms lookup (sub-millisecond)

## Tier 2: Vocabulary (Persistent JSON)

**Source**: `Vocabulary` class (`grep -n "class Vocabulary" embedding-service.js`)

**Characteristics**:
- Pre-computed embeddings for common terms
- Persisted to disk (cross-session)
- Provider-aware (clears if provider changes)

**Storage Path** (`grep -n "vocabulary:" config.js`):
```javascript
vocabulary: path.join(PROJECT_ROOT, '.sweet-search', 'query-vocabulary.json'),
```

**File Format**:
```json
{
  "metadata": {
    "created": "2025-12-01T00:00:00Z",
    "lastUpdated": "2025-12-31T00:00:00Z",
    "version": 2,
    "provider": "voyage"
  },
  "terms": {
    "authservice": [0.123, -0.456, ...],
    "employeeservice": [0.789, -0.012, ...],
    // ... normalized lowercase keys
  }
}
```

**Default Terms** (`grep -n "defaultTerms" embedding-service.js`):
```javascript
const defaultTerms = [
  'AuthService', 'EmployeeService', 'LoginService', ...
  'authentication', 'authorization', 'login', 'logout', 'password',
  'JWT', 'token', 'session', 'employee', 'monitoring', 'tracking',
  'gRPC', 'REST', 'API', 'endpoint', 'request', 'response',
  'bot detection', 'heuristic', 'trajectory', 'mouse movement',
  'Spring Boot', 'React', 'Java', 'JavaScript', 'proto', 'protobuf',
];
```

**Performance**: <0.1ms lookup (in-memory Map after load)

## Tier 3: Semantic Cache (Similarity-Based)

**Source**: `SemanticCache` class (`grep -n "class SemanticCache" embedding-service.js`)

**Characteristics**:
- Uses local model (MiniLM-L6-v2) for cache KEY computation
- Stores Voyage embeddings as VALUES
- Similarity threshold: 0.85 (configurable)
- Enables cache hits for semantically similar queries

```javascript
class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.85;
    this.maxSize = options.maxSize ?? 500;
    this.entries = [];  // { localEmb, voyageEmb, query }
  }

  async findSimilar(text) {
    // 1. Compute local embedding (~2-3ms)
    const localEmb = await this.computeLocalEmbedding(text);

    // 2. Search for similar entries
    for (const entry of this.entries) {
      const similarity = this.cosineSimilarity(localEmb, entry.localEmb);
      if (similarity > this.threshold) {
        return { voyageEmb: entry.voyageEmb, similarity, matchedQuery: entry.query };
      }
    }

    return { voyageEmb: null, localEmb };
  }

  add(text, localEmb, voyageEmb) {
    if (this.entries.length >= this.maxSize) {
      this.entries.shift();  // FIFO eviction
    }
    this.entries.push({ query: text, localEmb, voyageEmb, addedAt: Date.now() });
  }
}
```

**Local Model**: `Xenova/all-MiniLM-L6-v2` (384d, quantized)

**When Used**: Only for remote providers (Voyage, Mistral, Jina) (`grep -n "isRemote" embedding-service.js`):
```javascript
if (useSemanticCache && EMBEDDING_CONFIG.isRemote) {
```

**Performance**: ~5-10ms (local model inference)

**Expected Hit Rate**: ~60-70% (based on query similarity clustering)

## Tier 4: Remote API

**Source**: `generateEmbedding()` function (`grep -n "async function generateEmbedding" embedding-service.js`)

**Provider Priority** (`grep -n "EMBEDDING_PROVIDERS" config.js`):
1. Voyage Code 3 (priority 1) - 1024d, best for code
2. Mistral Codestral Embed (priority 2) - 3072d
3. Jina Embeddings v3 (priority 3) - 1024d, multilingual
4. Local Xenova (priority 99) - 384d, offline fallback

**Performance** (embedding call only, not end-to-end):
- Voyage API: ~50-100ms per batch (embedding call only)
- Mistral API: ~100-150ms per batch
- Jina API: ~50-100ms per batch
- Local model (warm): 2-3ms
- Local model (cold): ~3-5s (model loading)

> **Note:** Typical uncached *semantic* requests are documented as **~275ms** in the `sweet-search.js` header (environment-dependent).
> That "~275ms" figure reflects the overall semantic path in typical conditions; whether it includes reranking depends on flags (`--no-rerank`) and mode.
> The ~50-100ms figures above are just the embedding API call portion (batch call), not end-to-end search latency.
> See `SEMANTIC_SEARCH.md` and the `sweet-search.js` header for the full target/typical framing.

### Circuit Breaker (API Stability)

**Source**: `circuitBreaker` object (`grep -n "circuitBreaker" embedding-service.js`)

The embedding service includes a circuit breaker to prevent cascading failures during API outages:

```javascript
const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED',  // CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)

  // Configuration
  FAILURE_THRESHOLD: 5,      // Open circuit after 5 consecutive failures
  COOLDOWN_MS: 60000,        // Wait 60s before testing recovery
  SUCCESS_TO_CLOSE: 2,       // Need 2 successes to close circuit
};
```

**State Transitions:**

```
CLOSED (normal operation)
    │
    ├── On success: Reset failure count
    │
    └── On failure: Increment failure count
        │
        └── If failures >= 5 ───────────────> OPEN (blocking)
                                                   │
                                                   ├── All requests rejected
                                                   │
                                                   └── After 60s ──────────> HALF_OPEN (testing)
                                                                                  │
                                                   ┌──────────────────────────────┘
                                                   │
                                                   ├── On failure ───────────> OPEN
                                                   │
                                                   └── On 2 successes ────────> CLOSED
```

**Error Response When Open:**
```javascript
if (!circuitBreaker.canRequest().allowed) {
  throw new Error(`Voyage API unavailable: Circuit OPEN - retry in ${cooldownRemaining}s`);
}
```

**Benefits:**
- Prevents wasted API calls during outages
- Allows system to gracefully degrade to local model
- Auto-recovers when API comes back online
- Reduces load on failing services

## Cache Lookup Flow

**Source**: `getEmbedding()` function (`grep -n "export async function getEmbedding" embedding-service.js`)

```javascript
export async function getEmbedding(text, options = {}) {
  const { useCache = true, useSemanticCache = true } = options;

  // Tier 1: LRU Cache (exact match)
  if (useCache && EMBEDDING_CONFIG.cache?.enabled) {
    const cached = queryCache.get(text);
    if (cached) {
      return { embedding: cached, source: 'lru', latency_us: ... };
    }

    // Tier 2: Vocabulary (pre-computed)
    await vocabulary.load();
    const vocabHit = vocabulary.get(text);
    if (vocabHit) {
      queryCache.set(text, vocabHit);  // Promote to LRU
      return { embedding: vocabHit, source: 'vocabulary', latency_us: ... };
    }
  }

  // Tier 3: Semantic Cache (similarity-based)
  if (useSemanticCache && EMBEDDING_CONFIG.isRemote) {
    const semanticResult = await semanticCache.findSimilar(text);
    if (semanticResult?.voyageEmb) {
      queryCache.set(text, semanticResult.voyageEmb);  // Promote to LRU
      return {
        embedding: semanticResult.voyageEmb,
        source: 'semantic-cache',
        similarity: semanticResult.similarity,
        matchedQuery: semanticResult.matchedQuery,
      };
    }
  }

  // Tier 4: Remote API
  const embedding = await generateEmbedding(text);

  // Store in caches
  queryCache.set(text, embedding);
  if (localEmbForCache) {
    semanticCache.add(text, localEmbForCache, embedding);
  }

  return { embedding, source: EMBEDDING_CONFIG.provider, latency_us: ... };
}
```

## DB_PATHS Configuration

**Source**: `grep -n "export const DB_PATHS" config.js`

```javascript
export const DB_PATHS = {
  // Main codebase vectors
  codebase: path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db'),

  // Code graph (entities + relationships + FTS5 + summaries)
  codeGraph: path.join(PROJECT_ROOT, '.sweet-search', 'code-graph.db'),

  // HNSW index (in-memory at query time)
  hnswIndex: path.join(PROJECT_ROOT, '.sweet-search', 'codebase-hnsw.idx'),

  // Binary HNSW index (32x smaller, Hamming distance)
  // Files: .meta.json, .vectors.json, .graph.json, .int8.json
  binaryHnswIndex: path.join(PROJECT_ROOT, '.sweet-search', 'codebase-binary-hnsw.idx'),

  // Int8 vectors for rescore stage
  // DEPRECATED: This SQLite path is no longer used. Int8 vectors are stored in
  // .int8.json sidecar alongside binary HNSW index. See binary-hnsw-index.js.
  int8Vectors: path.join(PROJECT_ROOT, '.sweet-search', 'codebase-int8.db'),

  // ColBERT token embeddings (late interaction)
  colbert: path.join(PROJECT_ROOT, '.sweet-search', 'codebase-colbert.db'),

  // Merkle state for incremental indexing
  merkle: path.join(PROJECT_ROOT, '.sweet-search', 'merkle-state.json'),

  // Query vocabulary cache
  vocabulary: path.join(PROJECT_ROOT, '.sweet-search', 'query-vocabulary.json'),

  // HCGS summaries cache
  summaries: path.join(PROJECT_ROOT, '.sweet-search', 'code-summaries.json'),
};
```

## Auto-Persist Feature

**Source**: `grep -n "autoPersistFrequentQueries" embedding-service.js`

Frequent queries are automatically persisted to vocabulary on process exit:

```javascript
export async function autoPersistFrequentQueries(threshold = 2) {
  const frequent = queryCache.getFrequentQueries(threshold);

  for (const { query, embedding } of frequent) {
    if (!vocabulary.has(query)) {
      vocabulary.set(query, embedding);
    }
  }

  await vocabulary.save();
}

export function registerAutoPersistOnExit(threshold = 2) {
  process.on('beforeExit', persist);
  process.on('SIGINT', persist);
  process.on('SIGTERM', persist);
}
```

## Performance Summary

| Tier | Latency | Persistence | Match Type |
|------|---------|-------------|------------|
| LRU Cache | <0.1ms | Session only | Exact string |
| Vocabulary | <0.1ms | Cross-session | Exact string (normalized) |
| SemanticCache | ~5-10ms | Session only | Cosine similarity > 0.85 |
| Remote API | ~50-250ms | N/A | New computation |

**Note**: All latency numbers are **typical** based on comments in the source code. Actual performance depends on hardware, network latency (for remote APIs), and model loading state.

## Query Deduplication

**Source**: `QueryDeduplicator` class (`grep -n "class QueryDeduplicator" embedding-service.js`)

Prevents duplicate concurrent API calls for identical queries:

```javascript
class QueryDeduplicator {
  constructor() {
    this.inflight = new Map();  // text -> Promise
  }

  get(text) {
    return this.inflight.get(text) || null;
  }

  set(text, promise) {
    this.inflight.set(text, promise);
    promise.finally(() => this.inflight.delete(text));
  }
}
```

Saves ~250ms per duplicate and reduces API costs.
