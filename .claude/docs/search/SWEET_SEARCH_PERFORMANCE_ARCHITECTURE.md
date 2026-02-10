# Smart Search Performance Architecture

## Document Purpose

This document provides a detailed technical analysis of the Smart Search system's performance architecture, including the C binary client, Node.js server, hybrid search pipeline, caching layers, and preheating mechanisms.

> **Sources of Truth:**
> - C binary: `ss-fast/ss-fast.c`
> - Bash fallback: `ss.sh`
> - Server: `sweet-search.js`
> - Query Router: `query-router.js` + `wasm-router/` (WASM CatBoost, ~10us)
> - Config: `config.js` (`PERFORMANCE_TARGETS`, `DB_PATHS`)
> - Embedding service: `embedding-service.js`
> - Graph search: `graph-search.js`
>
> **Related:** [QUERY-ROUTING.md](../QUERY-ROUTING.md) (full query router documentation)

---

## System Overview

Smart Search is a hybrid code search system with a client-server architecture optimized for sub-10ms lexical queries (target) and sub-150ms semantic queries (target).

**Current Performance:** 90.0% Success@10 (369/410 benchmark queries)

```
                                    +-----------------------+
   [User Query]                     |   HTTP Server Mode    |
       |                            |   (--serve flag)      |
       v                            +-----------------------+
+----------------+                           |
| C Binary (ss)  |  Unix Socket             |
| ~2-5ms client  |  /tmp/sweet-search.sock        v
| overhead       |                  +-----------------------+
+----------------+                  | Node.js Server        |
       |                            | (sweet-search.js) |
       | HTTP/1.0 GET               |                       |
       v                            | - SweetSearch class   |
+----------------+                  | - Warm singleton      |
| Unix Socket    |<---------------->| - All indexes in RAM  |
| /tmp/search.   |                  +-----------------------+
| sock           |                           |
+----------------+                           |
       ^                                     v
       |                            +--------------------------------+
+----------------+                  |        Search Pipeline         |
| Shell Wrapper  |                  +--------------------------------+
| (ss.sh)        |                  | 1. Query Routing (lexical/     |
| ~10-20ms       |                  |    semantic/hybrid/structural) |
| overhead       |                  | 2. hybridSearchV2 (default)    |
+----------------+                  |    - graphExpandedSearch       |
                                    |      (skipBoosts=true)         |
                                    |    - semanticSearch            |
                                    |    - robustCCFusion            |
                                    |    - applyPostFusionBoosts     |
                                    | 3. Binary HNSW (Stage 1)       |
                                    | 4. Int8 Rescore (Stage 2)      |
                                    | 5. ColBERT Late Interaction    |
                                    | 6. Reranking (Stage 3):        |
                                    |    - FlashRank (~15ms, always) |
                                    |    - Voyage/Jina (conditional) |
                                    +--------------------------------+
```

---

## Hybrid Search v2 Architecture (v21)

The Jan 2026 ranking update introduced a new hybrid search architecture that addresses ranking regressions caused by pre-fusion boost asymmetry.

### Key Changes Summary

| Change | Description | Impact |
|--------|-------------|--------|
| **1. skipBoosts parameter chain** | `bm25Search` -> `hybridDefinitionSearch` -> `graphExpandedSearch` all support `skipBoosts=true` | Fair fusion - lexical path returns raw scores |
| **2. robustCCFusion** | Quantile normalization (p05-p95) + RRF fallback | Robust to outliers, handles edge cases |
| **3. Post-fusion boosts** | Definition/syntax/kind/position boosts applied AFTER fusion | Both paths benefit equally |
| **4. MMR diversity** | Maximal Marginal Relevance for result diversity | Balances relevance + diversity |
| **5. hybridSearchV2 default** | New hybrid implementation using above changes | 90.0% Success@10 |

### Hybrid Search V2 Pipeline

```
hybridSearchV2(query, options)
    |
    +-- Step 1: Parallel Retrieval (raw scores)
    |       |
    |       +-- graphExpandedSearch(query, { skipBoosts: true })
    |       |       - Definition-first search for identifier queries
    |       |       - FTS5 + trigram + LIKE fallback
    |       |       - Graph expansion for related entities
    |       |       - NO definition/intent boosts
    |       |
    |       +-- semanticSearch(query, { rerank: false })
    |               - Voyage/Jina embeddings
    |               - HNSW search (Stage 1)
    |               - Int8 rescore (Stage 2)
    |               - NO reranking in this path
    |
    +-- Step 2: robustCCFusion(lexical, semantic, routeType)
    |       |
    |       +-- shouldFallbackToRRF() check
    |       |       - insufficient_results: < 3 on either side
    |       |       - no_valid_scores: NaN/undefined filtering
    |       |       - zero_variance: degenerate distributions
    |       |       - outlier_compression: skewed score clustering
    |       |
    |       +-- If fallback: rrfFusion(k=60)
    |       |       - Rank-based fusion: 1/(k + rank + 1)
    |       |       - No score normalization needed
    |       |
    |       +-- Else: quantile CC fusion
    |               - quantileNormalize(scores, 0.05, 0.95)
    |               - alpha from ROUTE_ALPHAS[routeType]
    |               - Combined: alpha*lexNorm + (1-alpha)*semNorm
    |
    +-- Step 3: applyPostFusionBoosts(fused, query, mode, confidence)
    |       |
    |       +-- getBoostIntent(routerMode, confidence)
    |       |       - definition_strong: lexical + conf >= 0.8
    |       |       - definition_mild: lexical + conf < 0.8
    |       |       - general: hybrid mode
    |       |       - none: semantic mode
    |       |       - structural: structural mode
    |       |
    |       +-- Per-result boosts (policy-controlled):
    |               - computeDefinitionBoost(): filename/name match
    |               - computeSyntaxBoost(): definition patterns
    |               - SYMBOL_KIND_WEIGHTS: type hierarchy
    |               - computePositionBoost(): early line preference
    |               - Cap: max 3.0x total boost
    |
    +-- Step 4: MMR Diversity (mmr.js)
    |       |
    |       +-- applyMMR(results, options)
    |               - lambda: 0.7 (relevance vs diversity tradeoff)
    |               - Iteratively selects results maximizing:
    |                 MMR = lambda * relevance - (1-lambda) * max_similarity
    |               - Prevents redundant results from same file/concept
    |
    +-- Return top-k results
```

### skipBoosts Parameter Chain

The `skipBoosts` parameter propagates through the lexical search stack:

```javascript
// graph-search.js - bm25Search entry point
async bm25Search(query, opts = {}) {
    const { limit = 20, skipBoosts = false } = opts;
    // ... FTS5 search ...
    const finalResults = skipBoosts
        ? results
        : this.applyRankingBoosts(results, query);
    return { results: finalResults, ... };
}

// graph-search.js - hybridDefinitionSearch
async hybridDefinitionSearch(query, options = {}) {
    const { k = 10, limit = 20, skipBoosts = false } = options;
    // ...
    const fts5Promise = this.bm25Search(query, { limit, skipBoosts });
    // ...
}

// graph-search.js - graphExpandedSearch
async graphExpandedSearch(query, opts = {}) {
    const { skipBoosts = false } = opts;
    // ...
    const { results: definitionResults } = await this.hybridDefinitionSearch(
        query, { k, limit: 20, skipBoosts }
    );
    // ...
}

// sweet-search.js - hybridSearchV2 uses skipBoosts=true
async hybridSearchV2(query, options = {}) {
    const [lexicalSearchResult, semanticSearchResult] = await Promise.all([
        this.graphSearch.graphExpandedSearch(query, {
            k: 50, expand: true, skipBoosts: true  // Raw scores for fair fusion
        }),
        this.semanticSearch(query, { k: 50, rerank: false, useColBERT }),
    ]);
    // ...
}
```

### Scoring Pipeline: Quantile Normalization

```javascript
// Quantile-based normalization for robust CC fusion
// Robust to outliers from pre-fusion boosts
quantileNormalize(scores, lowQuantile = 0.05, highQuantile = 0.95) {
    const sorted = [...scores].sort((a, b) => a - b);
    const pLow = sorted[floor(length * 0.05)];   // 5th percentile
    const pHigh = sorted[ceil(length * 0.95)];   // 95th percentile
    const range = pHigh - pLow;

    return scores.map(s => {
        const normalized = (s - pLow) / range;
        return clamp(normalized, 0, 1);  // Clamp outliers
    });
}
```

**Why quantile normalization?**
- Pre-fusion boosts created outliers that skewed min-max normalization
- Quantile approach ignores extreme 5% on each end
- Results in stable [0, 1] range for CC fusion

### RRF Fallback Mechanism

```javascript
shouldFallbackToRRF(lexicalResults, semanticResults) {
    // Case 1: Too few results (< 3 on either side)
    if (lexicalResults.length < 3 || semanticResults.length < 3) {
        return { fallback: true, reason: 'insufficient_results' };
    }

    // Case 2: Zero variance (degenerate distribution)
    if (lexVariance < 1e-6 || semVariance < 1e-6) {
        return { fallback: true, reason: 'zero_variance' };
    }

    // Case 3: Outlier compression
    // Top 5% clustered near max but median far from max
    if ((top5PctThreshold / max) > 0.95 && (median / max) < 0.3) {
        return { fallback: true, reason: 'outlier_compression' };
    }

    return { fallback: false, reason: null };
}

rrfFusion(lexicalResults, semanticResults, k = 60) {
    // Rank-based fusion: score = sum(1 / (k + rank + 1))
    lexicalResults.forEach((result, rank) => {
        scores.set(id, scores.get(id) || 0 + 1 / (k + rank + 1));
    });
    semanticResults.forEach((result, rank) => {
        scores.set(id, scores.get(id) || 0 + 1 / (k + rank + 1));
    });
    return sortedByScore(results);
}
```

### Post-Fusion Boost Application

```javascript
// BOOST_POLICY by intent
static BOOST_POLICY = {
    definition_strong: { defBoost: 2.0, syntaxBoost: 1.8, kindHierarchy: true, posBoost: true },
    definition_mild:   { defBoost: 1.8, syntaxBoost: 1.5, kindHierarchy: true, posBoost: true },
    general:           { defBoost: 1.8, syntaxBoost: 1.8, kindHierarchy: true, posBoost: false },
    none:              { defBoost: 1.0, syntaxBoost: 1.0, kindHierarchy: true, posBoost: false },
    structural:        { defBoost: 1.0, syntaxBoost: 1.0, kindHierarchy: false, posBoost: false },
};

// Applied AFTER fusion (both paths benefit equally)
applyPostFusionBoosts(fusedResults, query, routerMode, routerConfidence) {
    const boostIntent = getBoostIntent(routerMode, routerConfidence);
    const policy = BOOST_POLICY[boostIntent];

    return fusedResults.map(result => {
        let totalBoost = 1.0;

        // 1. Definition Boost (filename/name match)
        if (policy.definitionBoost > 1.0) {
            totalBoost *= computeDefinitionBoost(result, query);
        }

        // 2. Syntax Boost (class/function/interface patterns)
        if (policy.syntaxBoost > 1.0) {
            totalBoost *= computeSyntaxBoost(result, query);
        }

        // 3. Symbol Kind Hierarchy (class > method > variable)
        if (policy.kindHierarchy) {
            totalBoost *= 0.7 + 0.3 * SYMBOL_KIND_WEIGHTS[result.type];
        }

        // 4. Position Boost (definitions near top of file)
        if (policy.positionBoost && result.startLine != null) {
            totalBoost *= computePositionBoost(result);
        }

        // Cap total boost to prevent over-promotion
        const cappedBoost = Math.min(totalBoost, 3.0);
        return { ...result, score: result.score * cappedBoost };
    });
}
```

### MMR Diversity (Step 4)

**Implementation:** `mmr.js`

Maximal Marginal Relevance (MMR) provides result diversity without the aggressive filtering that flood control caused.

```javascript
// mmr.js - applyMMR()
function applyMMR(results, options = {}) {
    const { lambda = 0.7, limit = 20 } = options;
    const selected = [];
    const remaining = [...results];

    while (selected.length < limit && remaining.length > 0) {
        let bestIdx = 0;
        let bestMMR = -Infinity;

        for (let i = 0; i < remaining.length; i++) {
            const relevance = remaining[i].score;
            const maxSimilarity = selected.length === 0 ? 0 :
                Math.max(...selected.map(s => cosineSimilarity(s.embedding, remaining[i].embedding)));

            // MMR = lambda * relevance - (1 - lambda) * max_similarity_to_selected
            const mmr = lambda * relevance - (1 - lambda) * maxSimilarity;

            if (mmr > bestMMR) {
                bestMMR = mmr;
                bestIdx = i;
            }
        }

        selected.push(remaining.splice(bestIdx, 1)[0]);
    }

    return selected;
}
```

**How MMR works:**
- `lambda = 0.7`: 70% weight on relevance, 30% on diversity
- Iteratively selects results that maximize relevance while minimizing similarity to already-selected results
- Prevents redundant results from the same file or concept cluster
- Unlike flood control, MMR does not hard-cap results by file/type

**Why MMR replaced flood control:**
- Flood control was too aggressive (53->6 results in tests)
- MMR provides soft diversity without destroying recall
- Configurable lambda allows tuning relevance vs diversity tradeoff

---

## C Binary Architecture (`ss-fast.c`)

> **Source of truth:** `ss-fast/ss-fast.c`

### Location
- Source: `./ss-fast/ss-fast.c`
- Compiled binary: `./ss` (ELF 64-bit executable, ~19KB)
- Makefile: `./ss-fast/Makefile`

**IMPORTANT:** The `ss` file is a **compiled C binary**, NOT a symlink to `ss.sh`. The `ss.sh` file is a separate Bash fallback script.

### What It Does

The C binary is a minimal HTTP client that:
1. Parses command-line arguments (query, flags like `--mode`, `--summary`, `--top`)
2. Opens a Unix domain socket connection to `/tmp/sweet-search.sock`
3. Sends an HTTP/1.0 GET request with URL-encoded query parameters
4. Streams the response body directly to stdout (skipping HTTP headers)
5. Exits immediately after response is complete

### Why C Instead of Node.js

| Factor | Node.js | C Binary |
|--------|---------|----------|
| Process spawn time | ~50-100ms | ~0.5-1ms |
| V8 engine startup | ~30-50ms | N/A |
| Module loading | ~20-30ms | N/A |
| Memory footprint | ~50-100MB | <1MB |
| Total cold overhead | ~100-180ms | ~2-3ms |

**Key insight**: Node.js has a minimum ~100ms cold start overhead even for trivial scripts. The C binary eliminates this entirely, making the total round-trip time dominated by the actual search operation rather than client overhead.

### Socket Connection Details

```c
#define SOCKET_PATH "/tmp/sweet-search.sock"
#define BUFFER_SIZE 16384

// Create Unix domain socket
sock_fd = socket(AF_UNIX, SOCK_STREAM, 0);

// Connect to server
struct sockaddr_un addr;
addr.sun_family = AF_UNIX;
strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);
connect(sock_fd, (struct sockaddr *)&addr, sizeof(addr));
```

The C binary uses `AF_UNIX` socket (Unix domain socket) which is:
- 30-50% faster than TCP loopback (`localhost:9876`)
- Zero network stack overhead
- Shared memory IPC under the hood

### Compilation Flags

```makefile
CFLAGS = -O3 -march=native -flto -Wall -Wextra
LDFLAGS = -s
```

- `-O3`: Maximum optimization
- `-march=native`: CPU-specific optimizations
- `-flto`: Link-time optimization
- `-s`: Strip symbols (smaller binary, ~14KB)

### Latency Characteristics

| Phase | Time |
|-------|------|
| Binary launch | <1ms |
| Socket connect | <1ms |
| HTTP request build/send | <1ms |
| Wait for server response | Variable (see server section) |
| Response streaming | <1ms |
| **Total C binary overhead** | **~2-5ms** |

---

## Shell Wrapper (`ss.sh`)

> **Source of truth:** `ss.sh`

### Purpose

The shell wrapper serves as a fallback when the C binary is not compiled or as a simpler alternative using standard Unix tools.

### How It Works (from ss.sh)

```bash
#!/bin/bash
# ss.sh - Sweet Search: Blazing fast (~5-10ms total)
SOCKET="/tmp/sweet-search.sock"
Q="${1:-}" K="${2:-10}"

# Auto-start server if not running
if [[ ! -S "$SOCKET" ]]; then
    nohup node "$(dirname "$0")/sweet-search.js" --serve &>/dev/null &
    for _ in {1..50}; do
        [[ -S "$SOCKET" ]] && break
        sleep 0.1
    done
fi

# URL encode and send via netcat
Q_ENC="${Q// /%20}"
printf "GET /search?q=%s&k=%s&format=text HTTP/1.0\r\nHost: l\r\n\r\n" "$Q_ENC" "$K" \
  | nc -N -U "$SOCKET" 2>/dev/null \
  | { while IFS= read -r line; do [[ "${line%$'\r'}" == "" ]] && break; done; cat; }
```

### Latency Overhead

| Phase | Time | Source |
|-------|------|--------|
| Bash interpreter | ~5-10ms | (typical) |
| Socket check | <1ms | (typical) |
| netcat spawn | ~3-5ms | (typical) |
| HTTP formatting | <1ms | (typical) |
| **Total shell overhead** | **~10-20ms** | (typical) |

---

## Node.js Server (`sweet-search.js`)

### Server Mode

When started with `--serve`, the server:
1. Creates a `SweetSearch` instance
2. Loads all indexes into memory (one-time ~400-1000ms cost)
3. Warms up embedding service (vocabulary + semantic cache)
4. Listens on both TCP (port 9876) and Unix socket (`/tmp/sweet-search.sock`)
5. Stays resident in memory until stopped

### Dual Protocol Support

```javascript
// TCP server (port 9876) - backward compatible
const tcpServer = http.createServer(handleRequest);
tcpServer.listen(SEARCH_SERVER_PORT);

// Unix socket server (/tmp/sweet-search.sock) - 30-50% faster
const unixServer = http.createServer(handleRequest);
unixServer.listen(SEARCH_SERVER_SOCKET);
```

### Server Lifecycle

| Event | Action |
|-------|--------|
| First query | Auto-spawns server via shell or Node |
| Server startup | Loads indexes ~400-1000ms |
| Subsequent queries | Server already warm, instant response |
| System restart | Server stops, next query respawns |
| `ss --stop` | Graceful shutdown, removes PID/socket files |

---

## Caching Layers

> **Source of truth:** `embedding-service.js` (LRUCache class, Vocabulary class, SemanticCache class)

### Layer 1: LRU Query Cache (In-Memory)

```javascript
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hitCount = new Map();
  }
}

const queryCache = new LRUCache(EMBEDDING_CONFIG.cache?.maxSize || 1000);
```

**Properties:**
- Max 1000 entries (configurable via `EMBEDDING_CONFIG.cache.maxSize`)
- Evicts oldest on overflow
- Tracks hit counts for vocabulary expansion
- **Lookup time: <0.1ms** (typical)

### Layer 2: Persistent Vocabulary Cache

**Location:** `.sweet-search/query-vocabulary.json` (from `DB_PATHS.vocabulary` in config.js)

Pre-computed Voyage embeddings stored as JSON:
- All entity names from code graph (classes, methods, etc.)
- Common question variants ("what is X", "how does X work")
- Frequently used queries (auto-expanded from LRU hits)

**Properties:**
- Persists across sessions
- ~80% of likely queries pre-computed
- **Lookup time: <0.1ms** (typical)

### Layer 3: Semantic Cache (Similarity-Based)

```javascript
class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.85;  // Similarity threshold
    this.maxSize = options.maxSize ?? 500;       // Max cached entries
    this.entries = [];                            // { localEmb, voyageEmb, query }
    this.localModel = null;                       // Xenova/all-MiniLM-L6-v2
  }
}

const semanticCache = new SemanticCache({ threshold: 0.85, maxSize: 500 });
```

**How it works:**
1. Uses local MiniLM model to compute lightweight embedding (~2-3ms)
2. Searches cache for similar local embeddings (cosine similarity > 0.85)
3. If found, returns cached Voyage embedding
4. Enables fuzzy matching: "AuthService" matches "auth service"

**Properties:**
- Uses local model for key computation (fast)
- Returns remote (Voyage) embedding on hit
- **Lookup time: ~5-10ms** (typical) - local model inference
- **Hit rate: ~60-70%** (typical) for varied query phrasings

### Layer 4: Binary/Int8 Vector Cache

For 3-stage semantic retrieval (from `BINARY_HNSW_CONFIG.retrieval` in config.js):
- Binary embeddings (512d -> 64 bytes) in binary HNSW index
- Int8 embeddings for rescore stage
- Cached per-query in LRU

**Properties:**
- 32x memory reduction vs float32
- Hamming distance for Stage 1 (~100us for 1000 candidates) (typical)
- Int8 dot product for Stage 2 (~1ms for 100 candidates) (typical)

---

## Reranking Architecture (Stage 3)

> **Source of truth:** `flashrank.js` (Reranker class, cascadedRerank method)

### Cascaded Mode (Default)

The reranking pipeline uses a cascaded approach to minimize latency while maintaining quality:

```
Stage 3a: FlashRank (~15ms, always)
    |
    +-- Score spread analysis
    |
    +-- Clear winner (gap > 0.15)?     -> SKIP Stage 3b (40-60% of queries)
    +-- Tight cluster (spread < 0.10)? -> SKIP Stage 3b
    +-- High confidence (all > 0.90)?  -> SKIP Stage 3b
    |
    +-- Ambiguous results -> Stage 3b
                              |
                              +-- Voyage available? -> Voyage (~300-350ms)
                              +-- Jina available?   -> Jina (~80-100ms)
```

### Reranker Providers

| Provider | Model | Latency | Priority | Context | Notes |
|----------|-------|---------|----------|---------|-------|
| **FlashRank** | ms-marco-MiniLM-L-6-v2 | ~15ms | Local | 512 tokens | Always runs, local cross-encoder |
| **Voyage** | rerank-2.5 | ~300-350ms | 1 | 4000 chars | Highest quality, 2x faster than rerank-2 |
| **Jina** | jina-reranker-v3 | ~80-100ms | 2 | 131K tokens | Good quality, listwise reranking |

---

## Performance Benchmarks

### Current Metrics (Jan 2026)

| Metric | Value | Target |
|--------|-------|--------|
| **Success@10** | **90.0%** (369/410) | 95% |
| MRR | ~0.65 | 0.70 |
| P50 Lexical | 6-10ms | <10ms |
| P50 Semantic (cached) | <10ms | <30ms |
| P50 Semantic (uncached) | ~275ms | <150ms |

### Latency Breakdown by Scenario

#### Scenario 1: Cached Lexical Query (Best Case)

```
User: ss "AuthService"
```

| Step | Time | Cumulative |
|------|------|------------|
| C binary launch | 0.5ms | 0.5ms |
| Socket connect | 0.5ms | 1ms |
| Query routing (WASM CatBoost) | 0.01ms | 1.01ms |
| LRU cache check | 0.01ms | 1.03ms |
| Result formatting | 0.3ms | 1.33ms |
| Socket response | 0.5ms | 1.83ms |
| **Total** | | **~2ms** |

#### Scenario 2: Uncached Lexical Query

```
User: ss "NewClassName"
```

| Step | Time | Cumulative |
|------|------|------------|
| C binary launch | 0.5ms | 0.5ms |
| Socket connect | 0.5ms | 1ms |
| Query routing (WASM CatBoost) | 0.01ms | 1.01ms |
| Cache miss | 0.01ms | 1.02ms |
| BM25 FTS5 search | 5-8ms | 6-9ms |
| Graph expansion | 1-2ms | 7-11ms |
| Result formatting | 0.3ms | 7.3-11.3ms |
| Socket response | 0.5ms | 7.8-11.8ms |
| **Total** | | **~8-12ms** |

#### Scenario 3: Cached Semantic Query

```
User: ss "how does authentication work"  (vocabulary hit)
```

| Step | Time | Cumulative |
|------|------|------------|
| C binary launch | 0.5ms | 0.5ms |
| Socket connect | 0.5ms | 1ms |
| Query routing (WASM CatBoost) | 0.01ms | 1.01ms |
| Vocabulary embedding lookup | 0.1ms | 1.11ms |
| Binary HNSW search (Stage 1) | 0.1ms | 1.25ms |
| Int8 rescore (Stage 2) | 1ms | 2.25ms |
| Early exit (high confidence) | - | 2.25ms |
| Result formatting | 0.5ms | 2.75ms |
| Socket response | 0.5ms | 3.25ms |
| **Total** | | **~3-5ms** |

#### Scenario 4: Uncached Semantic Query (API Call)

```
User: ss "implement caching for employee data"  (novel query)
```

| Step | Time | Cumulative |
|------|------|------------|
| C binary launch | 0.5ms | 0.5ms |
| Socket connect | 0.5ms | 1ms |
| Query routing (WASM CatBoost) | 0.01ms | 1.01ms |
| Cache miss, Voyage API call | 50-100ms | 51-101ms |
| Binary HNSW search (Stage 1) | 0.1ms | 51-101ms |
| Int8 rescore (Stage 2) | 1ms | 52-102ms |
| ColBERT late interaction | 5-10ms | 57-112ms |
| Reranking Stage 3a: FlashRank | ~15ms | 72-127ms |
| Reranking Stage 3b: Remote (conditional) | 0-350ms | 72-477ms |
| Result formatting | 0.5ms | 72.5-477.5ms |
| Socket response | 0.5ms | 73-478ms |
| **Total (FlashRank skip)** | | **~75-130ms** |
| **Total (with Jina)** | | **~150-230ms** |
| **Total (with Voyage)** | | **~375-480ms** |

#### Scenario 5: Cold Start (Server Not Running)

```
User: ss "AuthService"  (server dead)
```

| Step | Time | Cumulative |
|-------|------|------------|
| Shell wrapper detects missing socket | 1ms | 1ms |
| nohup spawn node | 50-100ms | 51-101ms |
| Node.js initialization | 100-200ms | 151-301ms |
| SweetSearch.init() | 200-500ms | 351-801ms |
| Index loading | 200-500ms | 551-1301ms |
| Embedding warmup | 200-500ms | 751-1801ms |
| Socket ready | - | 751-1801ms |
| Query execution (as above) | 5-15ms | 756-1816ms |
| **Total** | | **~1-2 seconds** |

---

## Performance Optimization Summary

### What Makes It Fast

1. **C Binary Client**: Eliminates 100ms+ Node.js cold start
2. **Unix Socket**: 30-50% faster than TCP loopback
3. **Multi-Layer Cache**: LRU -> Vocabulary -> Semantic -> API (graceful degradation)
4. **Persistent Server**: One-time index loading, stays warm
5. **Binary HNSW**: 10x faster search via Hamming distance
6. **Cascaded Reranking**: FlashRank (~15ms) always runs first; score spread analysis skips remote reranker for 40-60% of queries
7. **Pre-computed Vocabulary**: ~80% of queries hit cache
8. **Hybrid Fusion v2**: Fair fusion with post-fusion boosts and MMR diversity (90.0% Success@10)

### When It's Slow

1. **Cold start**: First query in session pays ~1-2s penalty
2. **Novel queries**: API calls for embeddings add ~50-100ms
3. **Full reranking**: Voyage adds ~300-350ms, Jina adds ~80-100ms (only when score spread is ambiguous)
4. **Index not loaded**: Falls back to O(N) vector scan

### Recommended Usage Pattern

```bash
# Session start: warm the server
ss "init" >/dev/null 2>&1  # Pay cold start cost once

# All subsequent queries are fast
ss "AuthService"           # <10ms (lexical cache)
ss "how does auth work"    # <30ms (semantic cache)
ss "novel complex query"   # ~75-130ms (FlashRank skip) or ~150-480ms (with remote rerank)
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `ss` | Compiled C binary (~19KB, ELF 64-bit) |
| `ss-fast/ss-fast.c` | C source code for binary client |
| `ss-fast/Makefile` | Build configuration |
| `ss.sh` | Bash shell wrapper fallback |
| `sweet-search.js` | Main Node.js server (hybridSearchV2 default) |
| `graph-search.js` | BM25/FTS5 search, skipBoosts support |
| `config.js` | All configuration (`DB_PATHS`, `PERFORMANCE_TARGETS`, providers) |
| `embedding-service.js` | Multi-layer caching, API calls, `query-vocabulary.json` |
| `flashrank.js` | Reranking pipeline, cascaded mode |
| `mmr.js` | MMR diversity (Step 4 in hybridSearchV2 pipeline) |
| `vocabulary-utils.js` | Binary vocabulary format (`vocabulary.bin`) |
| `prewarm-vocab.js` | Project-specific term warming |
| `benchmark.js` | Performance benchmarks |
| `.sweet-search/query-vocabulary.json` | Primary vocabulary cache (JSON, 1024d) |
| `.sweet-search/vocabulary.bin` | Optional binary vocabulary (256d Matryoshka) |
| `/tmp/sweet-search.sock` | Unix domain socket |
| `/tmp/sweet-search-server.pid` | Server PID file |

---

## Key Sources of Truth Summary

| Component | Source File | Key Functions/Constants |
|-----------|-------------|------------------------|
| ss binary | `ss-fast/ss-fast.c` | `main()`, `do_request()` |
| ss.sh fallback | `ss.sh` | Bash script |
| Index paths | `config.js` | `DB_PATHS` (lines 55-85) |
| Performance targets | `config.js` | `PERFORMANCE_TARGETS` (lines 597-607) |
| **hybridSearchV2** | `sweet-search.js` | `hybridSearchV2()`, `robustCCFusion()`, `applyPostFusionBoosts()` |
| skipBoosts chain | `graph-search.js` | `bm25Search()`, `hybridDefinitionSearch()`, `graphExpandedSearch()` |
| Quantile normalization | `sweet-search.js` | `quantileNormalize()` |
| RRF fallback | `sweet-search.js` | `shouldFallbackToRRF()`, `rrfFusion()` |
| Post-fusion boosts | `sweet-search.js` | `BOOST_POLICY`, `getBoostIntent()` |
| MMR diversity | `mmr.js` | `applyMMR()` |
| Vocabulary (JSON) | `embedding-service.js` | `Vocabulary` class, `query-vocabulary.json` |
| Semantic cache | `embedding-service.js` | `SemanticCache` class |
| Typical latency | `sweet-search.js` | Header comment (~275ms semantic) |
