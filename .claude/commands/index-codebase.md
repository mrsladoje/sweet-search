---
description: Index codebase for semantic search (Sweet Search)
command: /index-codebase [options]
---

# Codebase Indexer v2.2 (Sweet Search)

Index the codebase with the hybrid search stack:
- **Lexical path**: FTS5/BM25 + Code Graph (for identifiers, exact tokens)
- **Semantic path**: HNSW ANN + ColBERT Reranking (for conceptual queries)
- **Hybrid path**: Both paths merged (for ambiguous queries)

## What's New in v2.2

- **ColBERT Active**: Late-interaction token-level reranking (72k tokens)
- **Incremental Indexing**: Only reindex changed files (default)
- **Model Prewarming**: Singleton pattern for 100x faster subsequent queries
- **Code Graph**: Entities + relationships with FTS5 full-text search
- **HNSW ANN**: us-scale vector search (replaces O(N) scan)
- **Query Routing**: Auto-detects lexical vs semantic queries (<5us)
- **Cascaded Reranking**: FlashRank always (~15ms), Voyage/Jina conditional via score spread analysis

## Usage

```bash
# Incremental index (DEFAULT - only changed files)
/index-codebase

# Full reindex (ignore previous state)
/index-codebase --full

# Index only code graph (lexical search)
/index-codebase --graph-only

# Index only vectors + HNSW (semantic search)
/index-codebase --vectors-only

# Show indexing statistics
/index-codebase --stats

# Dry run (show what would be indexed)
/index-codebase --dry-run
```

## Incremental Indexing

The indexer tracks file changes via content hashes:

```bash
# First run: indexes all files (~5 min for ~900 files)
/index-codebase --full

# Subsequent runs: only changed files (~10-30 sec)
/index-codebase

# If no changes detected:
# No changes detected - index is up to date!
```

State is stored in `.agentdb/merkle-state.json`

## Model Prewarming

The embedding model loads once and stays warm:

| Query | Cold (first) | Warm (subsequent) |
|-------|--------------|-------------------|
| Embedding | ~2000ms | **2-3ms** |

Use warmup explicitly:
```bash
node embedding-service.js warmup
```

## What Gets Indexed

### Code Graph (Phase 1)
- **Entities**: classes, interfaces, methods, fields, enums, functions, components
- **Relationships**: extends, implements, calls, uses, throws, overrides, imports
- **FTS5 Index**: Full-text search on names, signatures, doc comments

### Vector Embeddings (Phase 2)
- **AST Chunking**: Semantic boundaries (functions, classes, methods)
- **Embeddings**: all-MiniLM-L6-v2 (384d, local, fast)
- **Metadata**: file path, lines, type, symbol name, language

### HNSW Index (Phase 3)
- **256-dim vectors**: Truncated for fast ANN search
- **In-memory**: Loaded once, us-scale lookups
- **Native hnswlib-node**: Falls back to pure JS if unavailable

### ColBERT Tokens (Phase 4)
- **64-dim token embeddings**: 50% smaller than standard 128d
- **int8 quantization**: 4x compression
- **MaxSim scoring**: Cross-encoder quality at bi-encoder speed

## Search Commands

```bash
# Smart search (auto-routes to best path)
ss "AuthService"
ss "how does authentication work"

# Force lexical path (fastest for identifiers)
ss "LoginController" --mode lexical

# Force semantic path
ss "user login flow" --mode semantic

# Graph search only (lexical with graph expansion)
node graph-search.js "EmployeeService"

# Query routing test
node query-router.js "your query here"
```

## Performance (Measured)

| Component | Measured | Target | Status |
|-----------|----------|--------|--------|
| Query routing | **4us** | <1ms | Excellent |
| Lexical (FTS5+graph) | **~6-10ms** | <10ms | On target |
| HNSW lookup | **<1ms** | <1ms | Native |
| Embedding (warm) | **2-3ms** | <100ms | Singleton |
| Embedding (cold) | ~2000ms | N/A | Model load |
| Semantic (warm) | ~200ms | <150ms | Close |

## Storage

| File | Purpose | Size (typical) |
|------|---------|----------------|
| `.agentdb/code-graph.db` | FTS5 + entities + relationships | 2-5 MB |
| `.agentdb/codebase.db` | Vector embeddings | 30-50 MB |
| `.agentdb/codebase-hnsw.idx` | HNSW index | 5-10 MB |
| `.agentdb/codebase-hnsw.meta.json` | HNSW metadata | <1 KB |
| `.agentdb/merkle-state.json` | Incremental indexing state | ~200 KB |
| `.agentdb/colbert-tokens.db` | ColBERT token embeddings | ~200-700 MB |

## Implementation

The command runs the v2.2 indexer:

```bash
node index-codebase-v21.js $ARGS
```

## Files

```
config.js                 # Configuration
index-codebase-v21.js     # Main indexer
incremental-tracker.js    # File change detection
embedding-service.js      # Singleton model prewarming
graph-extractor.js        # AST -> Code Graph
graph-search.js           # FTS5 + graph expansion
hnsw-index.js             # Native HNSW wrapper
colbert-index.js          # Token-level embeddings
flashrank.js              # Local reranker
query-router.js           # Lexical vs semantic routing
sweet-search.js       # Unified search pipeline
benchmark.js              # Performance tests
```

## Setup

```bash
# Install dependencies (one-time)
bun install

# Full index (first time)
/index-codebase --full

# Subsequent updates
/index-codebase
```
