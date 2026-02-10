# Smart Search System Documentation

This directory contains documentation for the Smart Search (SEARCH 100x) hybrid code search system.

## Overview

Smart Search is a hybrid code search pipeline that intelligently routes queries to the optimal search path:

- **Lexical Path**: FTS5/BM25 + Code Graph expansion (for identifiers, file paths, exact tokens)
- **Semantic Path**: HNSW ANN + Reranking (for conceptual/how/why questions)
- **Hybrid Path**: Both paths merged with Convex Combination fusion

## Documentation Index

| Document | Description |
|----------|-------------|
| [**QUERY-ROUTING.md**](../../helpers/search-100x/QUERY-ROUTING.md) | **WASM CatBoost query router (authoritative)** |
| [QUERY_ROUTER.md](./QUERY_ROUTER.md) | Quick reference (redirects to QUERY-ROUTING.md) |
| [STRUCTURAL-QUERIES.md](../../helpers/search-100x/STRUCTURAL-QUERIES.md) | GraphRAG structural query patterns |
| [LEXICAL_SEARCH.md](./LEXICAL_SEARCH.md) | FTS5/BM25 + Code Graph lexical search |
| [SEMANTIC_SEARCH.md](./SEMANTIC_SEARCH.md) | HNSW ANN + embedding + reranking pipeline |
| [HYBRID_SEARCH.md](./HYBRID_SEARCH.md) | Convex Combination fusion for hybrid queries |
| [RERANKING.md](./RERANKING.md) | Cascaded reranking (FlashRank → Voyage/Jina) |
| [TESTING_HARNESS.md](./TESTING_HARNESS.md) | Evaluation harness (MRR/Success@K) + baselines/regression checks |
| [**TRANSLATION.md**](../../helpers/search-100x/docs/TRANSLATION.md) | **Multilingual query translation (T1→T2→T3 pipeline)** |

## Source Files

All source files are located in `.claude/helpers/search-100x/`:

| File | Purpose |
|------|---------|
| `sweet-search.js` | Main unified search pipeline (orchestrates all components) |
| `query-router.js` | Query classification and routing |
| `graph-search.js` | FTS5/BM25 lexical search + code graph |
| `embedding-service.js` | Multi-provider embedding service with caching |
| `hnsw-index.js` | HNSW ANN index (USearch backend) |
| `binary-hnsw-index.js` | Binary HNSW for 3-stage retrieval |
| `flashrank.js` | Cascaded reranking (FlashRank + Voyage/Jina) |
| `config.js` | All configuration constants |

## Performance Summary

| Search Mode | Latency (Target) | Latency (Typical) | Use Case |
|-------------|------------------|-------------------|----------|
| Lexical | <10ms | 6-10ms | Exact identifiers, file paths |
| Semantic | <150ms | 60-275ms | Conceptual queries, how/why questions |
| Hybrid | <200ms | 100-300ms | Ambiguous queries |
| Structural | <10ms | 3-8ms | Dependency queries ("what calls X") |

## Architecture

```
Query Input
    |
    v
[Query Router] --> lexical|semantic|hybrid|structural
    |
    +---> [Lexical Path]
    |        |
    |        +---> FTS5/BM25 Search (graph-search.js)
    |        +---> Code Graph Expansion (optional)
    |
    +---> [Semantic Path]
    |        |
    |        +---> Embedding (embedding-service.js)
    |        +---> HNSW ANN Search (hnsw-index.js)
    |        +---> Reranking (flashrank.js)
    |
    +---> [Hybrid Path]
             |
             +---> Both paths in parallel
             +---> Convex Combination fusion
    |
    v
Results
```

## Configuration

All configuration is centralized in `config.js`. Key sections:

- `ROUTING_CONFIG`: Patterns for lexical/semantic classification
- `EMBEDDING_CONFIG`: Active embedding provider and caching
- `HNSW_CONFIG`: HNSW index parameters
- `GRAPH_CONFIG`: Code graph relationship weights
- `PERFORMANCE_TARGETS`: Latency targets for monitoring
