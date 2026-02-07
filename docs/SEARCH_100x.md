# SEARCH 100x: Blazing Fast Code Search (Revised Plan)

> **Version 2.1 (Revised)** — Late December 2025. This is a **future implementation plan** updated to be more accurate about performance claims, OS portability, and what “microseconds” can realistically mean.

## Executive Summary

Transform code search from a **linear-scan vector search** into a **hybrid search stack**:

- **Lexical fast path** for identifier/vocabulary queries (Zoekt / trigram / ripgrep-like behavior).
- **Semantic path** using **in-memory ANN (HNSW)** for candidate generation, plus optional reranking for precision.

### Definitions (important)

- **Vector search latency (µs)** in this plan refers **only** to the ANN lookup step on an **in-memory index** (e.g., HNSW `searchKnn`), excluding query embedding time, disk I/O, graph traversal, reranking, and formatting.
- **End-to-end semantic search latency** includes query embedding (often milliseconds+), candidate fetch, and reranking (often milliseconds+).

| Mode                                   | Baseline                           | v2.1 Target (revised)                           | Notes                                                                           |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Lexical identifier/vocabulary query    | Grep/scan or slow index            | **<10ms p50**                                   | Use an indexed lexical engine (Zoekt) or optimized grep-like search.            |
| Vector ANN lookup (candidate gen only) | **O(N) vector scan**               | **<1ms (often 50–500µs p50)**                   | **Only** the ANN step, on an in-memory HNSW index.                              |
| End-to-end semantic query              | O(N) scan + optional remote rerank | **<150ms p50** (hardware/model dependent)       | Dominated by embedding + (optional) rerank.                                     |
| Top-1 accuracy                         | Rerank-dependent                   | **Target: “best possible” via hybrid + rerank** | Accuracy comes from good chunking + rerank, not from ANN speed alone.           |
| “Beat grep”                            | Not a goal                         | Not a goal                                      | Grep/Zoekt are the baseline for exact tokens; semantic search complements them. |

---

## Design Principles (Accuracy + Speed)

- **Avoid O(N) scans at query time**: vector candidate generation must be ANN-based (HNSW/IVF/PQ/etc.) or it will not scale.
- **Ship a lexical fast path**: identifiers, filenames, and exact tokens are best served by a trigram/regex-capable index (Zoekt/livegrep-class).
- **Be precise about “µs vector search”**: microseconds is realistic for **ANN lookup on an in-memory index**, not for embedding, reranking, or end-to-end.
- **Be explicit about OS portability**: Linux-only constructs (e.g., `/dev/shm`) must be optional or have Windows/macOS equivalents.
- **Do memory math for token-level methods**: ColBERT-style token stores can explode in size without compression/pruning.

## Architecture Overview (v2.1)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     SEARCH 100x ARCHITECTURE v2.1 (Revised)                     │
│                     Lexical Fast Path + ANN + Optional Rerank                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  User Query: "authentication error handling"                                    │
│       │                                                                         │
│       ▼                                                                         │
│  ┌──────────────────┐                                                           │
│  │  Query Analyzer  │                                                           │
│  └────────┬─────────┘                                                           │
│           │                                                                     │
│           ├─── Identifier-like / regex / exact ─► Lexical Engine (Zoekt/grep) ─┐│
│           │                                        (ms-scale)                  ││
│           │                                                     │               │
│           └─── Conceptual / “how/why” ────────────────┐        │               │
│                                              ▼                 │               │
│                                ┌──────────────────────────────┐ │               │
│                                │ Query Embedding (local model) │ │               │
│                                │ (ms–10s of ms, model/hw)      │ │               │
│                                └──────────────┬───────────────┘ │               │
│                                            ▼                   │               │
│                                ┌──────────────────────────────┐ │               │
│                                │ In-memory ANN (HNSW)         │ │               │
│                                │ (µs-scale lookup)            │ │               │
│                                └──────────────┬───────────────┘ │               │
│                                            ▼                   │               │
│                                ┌───────────────────────┐       │               │
│                                │  Top-50 Candidates    │       │               │
│                                └───────────┬───────────┘       │               │
│                                            │                   │               │
│                                            ▼                   │               │
│                                ┌──────────────────────────────┐ │               │
│                                │ Optional: Rerank              │ │               │
│                                │ - Remote: Voyage rerank-2     │ │               │
│                                │ - Local: lightweight reranker │ │               │
│                                └──────────────┬───────────────┘ │               │
│                                            ▼                   ▼               │
│                                ┌──────────────────────────────┐               │
│                                │ Optional: Graph expansion     │               │
│                                │ (calls/implements/extends…)   │               │
│                                └──────────────┬───────────────┘               │
│                                               ▼                                │
│                                ┌─────────────────────────────────┐             │
│                                │   Final Ranked Results          │             │
│                                │   (accuracy depends on rerank)  │             │
│                                └─────────────────────────────────┘             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Evolution: v2.0 (Baseline) → v2.1 (Revised)

| Component                | v2.0                                        | v2.1                                | Why                                                                                                |
| ------------------------ | ------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Embedding model**      | Any reasonable embedding model              | Choose per constraints              | Embedding time dominates semantic latency; pick the best speed/quality tradeoff for your hardware. |
| **Chunking strategy**    | Heuristic “AST-like” chunking               | Improve chunking incrementally      | Chunk quality drives accuracy more than ANN type.                                                  |
| **Candidate generation** | **O(N) vector scan** from SQLite each query | **In-memory ANN (HNSW)**            | Biggest speed win; enables µs-scale ANN lookup.                                                    |
| **Rerank**               | Optional / none                             | Strong rerank + local fallback      | Rerank is the main precision lever.                                                                |
| **Lexical search**       | Not specified here                          | Add Zoekt/grep-like indexed lexical | Best-in-class for exact tokens/identifiers.                                                        |
| **Graph expansion**      | Not implemented                             | Optional later                      | Useful, but do it after lexical+ANN is fast/stable.                                                |

---

## Phase 1 (Revised): Lexical Fast Path (Baseline SOTA for Code)

**Goal:** Provide the fastest possible experience for identifier/vocabulary queries (exact tokens, regex, file/path constraints).

### Recommended approach

- Prefer a proven indexed lexical engine (e.g., Zoekt/trigram) for “grep-class” queries.
- Keep SQLite FTS5 only as a lightweight fallback if you don’t want an external index.

> Note: Graph expansion can be layered on later, but it is not required to achieve “instant” lexical search.

```sql
-- Code entities
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  type TEXT NOT NULL,  -- class, interface, method, field, enum
  name TEXT NOT NULL,
  signature TEXT,      -- full signature for methods
  doc_comment TEXT,
  start_line INTEGER,
  end_line INTEGER
);

-- Relationships between entities
CREATE TABLE relationships (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- calls, implements, extends, uses, overrides, throws
  weight REAL DEFAULT 1.0,
  PRIMARY KEY (source_id, target_id, type),
  FOREIGN KEY (source_id) REFERENCES entities(id),
  FOREIGN KEY (target_id) REFERENCES entities(id)
);

-- FTS5 index for fast text search
CREATE VIRTUAL TABLE entities_fts USING fts5(
  name,
  signature,
  doc_comment,
  content='entities',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Indexes for graph traversal
CREATE INDEX idx_rel_source ON relationships(source_id);
CREATE INDEX idx_rel_target ON relationships(target_id);
CREATE INDEX idx_rel_type ON relationships(type);
```

### Relationship extraction (optional, later)

```javascript
// graph-extractor.js
function extractRelationships(ast, fileEntities) {
  const relationships = [];

  // Java-specific relationship extraction
  visit(ast, {
    // Method calls
    method_invocation: (node) => {
      const caller = getCurrentMethod(node);
      const callee = resolveMethodTarget(node);
      if (caller && callee) {
        relationships.push({
          source: caller.id,
          target: callee.id,
          type: "calls",
          weight: 1.0,
        });
      }
    },

    // Class inheritance
    class_declaration: (node) => {
      if (node.superclass) {
        relationships.push({
          source: node.id,
          target: resolveClass(node.superclass),
          type: "extends",
          weight: 2.0, // Higher weight for inheritance
        });
      }
      for (const iface of node.interfaces || []) {
        relationships.push({
          source: node.id,
          target: resolveClass(iface),
          type: "implements",
          weight: 1.5,
        });
      }
    },

    // Field usage
    field_access: (node) => {
      const user = getCurrentMethod(node);
      const field = resolveField(node);
      if (user && field) {
        relationships.push({
          source: user.id,
          target: field.id,
          type: "uses",
          weight: 0.5,
        });
      }
    },

    // Exception handling
    throw_statement: (node) => {
      const method = getCurrentMethod(node);
      const exception = resolveExceptionType(node);
      if (method && exception) {
        relationships.push({
          source: method.id,
          target: exception.id,
          type: "throws",
          weight: 1.0,
        });
      }
    },
  });

  return relationships;
}
```

### Graph-expanded search (optional, later)

```javascript
// graph-search.js
async function graphExpandedSearch(query, k = 10) {
  // Step 1: BM25 search for initial matches (<1ms)
  const bm25Results = await bm25Search(query, 20);

  // Step 2: Graph expansion - find related entities (<2ms)
  const expanded = new Map();

  for (const result of bm25Results) {
    expanded.set(result.id, { ...result, source: "direct" });

    // 1-hop expansion: find connected entities
    const related = await db.all(
      `
      SELECT e.*, r.type as rel_type, r.weight as rel_weight
      FROM relationships r
      JOIN entities e ON e.id = r.target_id
      WHERE r.source_id = ?
      UNION
      SELECT e.*, r.type as rel_type, r.weight as rel_weight
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE r.target_id = ?
    `,
      [result.id, result.id]
    );

    for (const rel of related) {
      if (!expanded.has(rel.id)) {
        // Score based on relationship type and weight
        const relScore =
          result.score * rel.rel_weight * getRelTypeMultiplier(rel.rel_type);
        expanded.set(rel.id, { ...rel, score: relScore, source: "graph" });
      }
    }
  }

  // Step 3: Rank by combined score
  const ranked = [...expanded.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return ranked;
}

function getRelTypeMultiplier(relType) {
  const multipliers = {
    implements: 0.9, // Interface implementations are highly relevant
    extends: 0.85, // Subclasses are relevant
    calls: 0.7, // Called methods are somewhat relevant
    uses: 0.5, // Field usage is less direct
    throws: 0.6, // Exception relationships
    overrides: 0.8, // Overridden methods
  };
  return multipliers[relType] || 0.5;
}
```

---

## Phase 2 (Revised): Semantic Candidate Generation via In-Memory ANN (HNSW)

**Goal:** Replace the current O(N) vector scan with an ANN index so candidate generation becomes **µs–sub-ms**.

### What changes vs today

- **Baseline**: scans **every embedding** per query (O(N)).
- **v2.1**: build and persist an **HNSW index** at indexing time; at query time, load it into RAM once and do `searchKnn`.

### Practical note on “microseconds”

- **ANN lookup** can be microseconds on an in-memory HNSW index.
- **End-to-end** semantic search will not be microseconds because embedding + (optional) rerank dominate.

### Future: late chunking / long-context embeddings

Late chunking can be valuable, but it is **not required** to get the main speed win in this plan. Treat it as a later accuracy experiment once ANN + lexical are solid.

---

## Phase 3 (Revised): Reranking for Accuracy (Optional but Recommended)

**Goal:** Get "best possible" top-1 accuracy without sacrificing the fast candidate-generation path.

### Reranker Priority Chain (Cascaded Mode)

| Priority | Reranker | Latency | Quality | Requirements |
|----------|----------|---------|---------|--------------|
| 1 | Voyage `rerank-2.5` | ~700ms | Highest | `VOYAGEAI_API_KEY` |
| 2 | Jina Reranker v3 | ~80ms | SOTA BEIR 61.94 | `JINA_API_KEY` (free 10M tokens) |
| 3 | FlashRank | ~15ms | Good | None (local) |

### Cascaded Reranking Strategy (Default)

1. **Stage 1**: FlashRank always (~15ms, local)
2. **Stage 2**: Best available remote (Voyage > Jina) - **conditional**
   - Skip if: clear winner (gap > 0.15), tight cluster (spread < 0.10), or high confidence (all > 0.90)
   - Expected impact: 40-60% fewer remote API calls without quality loss

```javascript
// flashrank.js - cascadedRerank()
// Stage 1: FlashRank always
const flashResult = await flashRankReranker.rerank(query, docs, topK * 2);

// Analyze scores
if (shouldSkipRerank(flashResult.scores)) {
  return flashResult;  // Skip remote - scores confident
}

// Stage 2: Best remote (Voyage > Jina)
if (voyageReranker.isAvailable()) return voyageReranker.rerank(...);
if (jinaReranker.isAvailable()) return jinaReranker.rerank(...);
return flashResult;  // Fallback
```

---

## Phase 4 (Optional, Later): ColBERT Late Interaction (Only If Memory/Compression Is Solved)

ColBERT-style token embedding storage can be extremely large. Don’t commit to it unless you:

- have a concrete **compression plan** (PQ/int8/pruning), and
- have measured memory usage on your expected chunk count.

If you want “highest possible accuracy” quickly, a simpler path is usually:
**Lexical + ANN candidate gen + strong rerank**.

---

## Phase 5 (Optional): IPC / Embedding Service

Shared-memory `/dev/shm` mmap designs are **Linux-specific**. On Windows, if you need a separate embedding process, use:

- in-process worker threads (simplest), or
- a local service with a binary protocol, or
- Windows shared memory primitives (named shared memory).

In many cases, the embedding model can run in-process and still meet end-to-end latency targets.

---

## Phase 6: Unified Search Pipeline (Revised)

### Revised routing rules

- **If the query looks like** identifiers / file paths / regex / exact tokens → **lexical engine** first.
- Otherwise → **semantic**: embed query → HNSW ANN top-N → optional rerank → optional graph expand.

---

## Performance Targets (Revised)

| Metric                                   | Target                                  | Notes                                    |
| ---------------------------------------- | --------------------------------------- | ---------------------------------------- |
| ANN lookup (in-memory HNSW only)         | **<1ms** (often **50–500µs p50**)       | Excludes embedding + rerank + I/O.       |
| Query embedding (local)                  | “as fast as the chosen model/hw allows” | Usually dominates semantic path latency. |
| End-to-end semantic (no remote rerank)   | **<150ms p50**                          | Heavily model/hardware dependent.        |
| End-to-end semantic (with remote rerank) | **network-dependent**                   | Often +50–300ms+ depending on network.   |
| Lexical path                             | **<10ms p50**                           | With a real indexed lexical engine.      |

---

## Success Criteria (Revised)

| Criterion                   | Target                                       | Validation                                     |
| --------------------------- | -------------------------------------------- | ---------------------------------------------- |
| Lexical correctness         | Matches grep/Zoekt behavior for exact tokens | Compare results for a fixed corpus of queries. |
| ANN lookup latency          | p50 in **µs**, p95 < 1–2ms                   | Benchmark ANN call only, in-process.           |
| End-to-end semantic latency | p50 < 150ms (no remote rerank)               | Benchmark with fixed model + warm caches.      |
| Accuracy                    | Improves with rerank + better chunking       | Evaluate on a larger query set (200–500+).     |
| Windows compatibility       | Works without Linux-only assumptions         | No `/dev/shm` requirement.                     |

## Appendix A (Optional/Experimental): Long-Context Embeddings + Late Chunking

> The following section is **illustrative pseudocode**. Do not assume your runtime exposes `embedWithAttention()` or stable per-token embeddings; confirm model/runtime capabilities before implementing.

```javascript
// jina-v3-config.js
const JINA_V3_CONFIG = {
  model: "jinaai/jina-embeddings-v3",
  maxTokens: 8192,

  // Late chunking parameters
  lateChunking: {
    enabled: true,
    chunkSize: 512, // tokens per chunk
    overlap: 128, // overlapping tokens
    minChunkSize: 64, // minimum chunk size
  },

  // Matryoshka dimensions
  dimensions: {
    full: 1024, // Jina v3 native dimension
    hnsw: 256, // Truncated for HNSW (better elbow than 128)
    colbert: 128, // Token-level for ColBERT
  },

  // Task-specific prompts (Jina v3 feature)
  taskPrompts: {
    retrieval: "Represent this code for retrieval: ",
    query: "Represent this search query: ",
  },
};
```

### Late Chunking Implementation (pseudocode)

```javascript
// late-chunker.js
async function lateChunk(fileContent, filePath) {
  const tokens = tokenize(fileContent);

  if (tokens.length <= JINA_V3_CONFIG.lateChunking.chunkSize) {
    // Small file: embed as single chunk
    const embedding = await embedder.embed(fileContent);
    return [
      {
        id: `${filePath}:0-${tokens.length}`,
        text: fileContent,
        embedding_full: embedding.full,
        embedding_256: embedding.slice(0, 256),
        metadata: { file: filePath, type: "file" },
      },
    ];
  }

  // Step 1: Embed entire file (uses full 8K context)
  // NOTE: pseudocode — you may need a model/runtime that exposes token-level representations.
  const fullEmbedding = await embedder.embedWithAttention(fileContent);
  // Returns (conceptually): { embedding: [...], tokenEmbeddings: [[...], [...], ...] }

  // Step 2: Create overlapping chunks with context-aware embeddings
  const chunks = [];
  const { chunkSize, overlap } = JINA_V3_CONFIG.lateChunking;

  for (let start = 0; start < tokens.length; start += chunkSize - overlap) {
    const end = Math.min(start + chunkSize, tokens.length);
    const chunkTokens = tokens.slice(start, end);
    const chunkText = detokenize(chunkTokens);

    // Extract embedding slice from token embeddings
    const tokenEmbeds = fullEmbedding.tokenEmbeddings.slice(start, end);
    const chunkEmbedding = meanPool(tokenEmbeds); // Average token embeddings

    chunks.push({
      id: `${filePath}:${start}-${end}`,
      text: chunkText,
      embedding_full: chunkEmbedding,
      embedding_256: chunkEmbedding.slice(0, 256),
      token_embeddings: tokenEmbeds, // For ColBERT
      metadata: {
        file: filePath,
        startToken: start,
        endToken: end,
        type: "late_chunk",
        hasGlobalContext: true,
      },
    });
  }

  return chunks;
}
```

### Why 256-dim Instead of 128-dim (illustrative)

| Dimension | Accuracy (NDCG@10) | HNSW Latency | Memory |
| --------- | ------------------ | ------------ | ------ |
| 128       | 0.89               | 0.08ms       | 1x     |
| **256**   | **0.94**           | **0.10ms**   | **2x** |
| 512       | 0.96               | 0.15ms       | 4x     |
| 1024      | 0.97               | 0.25ms       | 8x     |

The “sweet spot” depends on model + corpus; treat these numbers as illustrative until benchmarked on your workload.

---

## Appendix B (Optional): Linux Shared Memory IPC (mmap)

**Goal:** Zero serialization overhead for embeddings

> **Portability note:** This example is **Linux-specific** (uses `/dev/shm`). On Windows/macOS, use OS-native shared memory primitives or avoid IPC by running embeddings in-process.

### 3.1 Why Shared Memory Over Unix Sockets

| IPC Method               | Serialization | Latency (768 floats) | Throughput |
| ------------------------ | ------------- | -------------------- | ---------- |
| HTTP + JSON              | Yes           | 8-12ms               | Low        |
| Unix Socket + JSON       | Yes           | 2-4ms                | Medium     |
| Unix Socket + Binary     | Partial       | 1-2ms                | Medium     |
| **Shared Memory (mmap)** | **None**      | **<0.1ms**           | **High**   |

### 3.2 Shared Memory Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Memory Layout                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────────────────────────────┐    │
│  │   Request   │    │          Embedding Buffer           │    │
│  │   Header    │    │   (pre-allocated Float32Array)      │    │
│  │  (64 bytes) │    │         (256 * 4 = 1KB)             │    │
│  └─────────────┘    └─────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────┐    ┌─────────────────────────────────────┐    │
│  │  Response   │    │      Token Embeddings Buffer        │    │
│  │   Header    │    │   (for ColBERT, 512 * 128 * 4)      │    │
│  │  (64 bytes) │    │           (256 KB)                  │    │
│  └─────────────┘    └─────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Text Buffer                          │   │
│  │              (query/document text, 64KB)                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Shared Memory Server

```javascript
// embedding-server-mmap.js
import { SharedArrayBuffer } from "worker_threads";
import { createServer } from "net";
import mmap from "mmap-io";
import fs from "fs";

const SHM_PATH = "/dev/shm/sloth-embedder";
const SHM_SIZE = 512 * 1024; // 512KB

// Create shared memory region
const fd = fs.openSync(SHM_PATH, "w+");
fs.ftruncateSync(fd, SHM_SIZE);
const buffer = mmap.map(
  SHM_SIZE,
  mmap.PROT_READ | mmap.PROT_WRITE,
  mmap.MAP_SHARED,
  fd,
  0
);

// Memory layout offsets
const LAYOUT = {
  REQUEST_READY: 0, // 1 byte: request ready flag
  RESPONSE_READY: 1, // 1 byte: response ready flag
  REQUEST_TYPE: 2, // 1 byte: embed=1, rerank=2
  TEXT_LENGTH: 4, // 4 bytes: text length
  EMBEDDING_DIM: 8, // 4 bytes: embedding dimension
  TEXT_START: 64, // Text buffer starts at 64
  TEXT_SIZE: 64 * 1024, // 64KB for text
  EMBEDDING_START: 64 + 64 * 1024, // Embedding buffer
  TOKEN_EMB_START: 64 + 64 * 1024 + 4 * 1024, // Token embeddings
};

let embedder = null;

async function warmup() {
  console.log("Loading Jina v3...");
  embedder = await pipeline("feature-extraction", "jinaai/jina-embeddings-v3", {
    quantized: true,
  });
  console.log("Model ready");
}

// Polling loop for requests (faster than event-based for hot path)
async function processLoop() {
  while (true) {
    if (buffer[LAYOUT.REQUEST_READY] === 1) {
      // Read request
      const textLength = buffer.readUInt32LE(LAYOUT.TEXT_LENGTH);
      const text = buffer.toString(
        "utf8",
        LAYOUT.TEXT_START,
        LAYOUT.TEXT_START + textLength
      );

      // Generate embedding
      const result = await embedder(text, { pooling: "mean", normalize: true });
      const embedding = new Float32Array(result.data);

      // Write embedding directly to shared memory (ZERO COPY!)
      const embeddingView = new Float32Array(
        buffer.buffer,
        LAYOUT.EMBEDDING_START,
        256
      );
      embeddingView.set(embedding.slice(0, 256));

      // Signal response ready
      buffer[LAYOUT.RESPONSE_READY] = 1;
      buffer[LAYOUT.REQUEST_READY] = 0;
    }

    // Yield (this is still a busy-poll). Consider event-driven signaling (Atomics.wait, OS events) if CPU usage matters.
    await new Promise((r) => setImmediate(r));
  }
}

warmup().then(processLoop);
```

### 3.4 Shared Memory Client

```javascript
// embedding-client-mmap.js
import mmap from "mmap-io";
import fs from "fs";

const SHM_PATH = "/dev/shm/sloth-embedder";
const SHM_SIZE = 512 * 1024;

class MmapEmbeddingClient {
  constructor() {
    const fd = fs.openSync(SHM_PATH, "r+");
    this.buffer = mmap.map(
      SHM_SIZE,
      mmap.PROT_READ | mmap.PROT_WRITE,
      mmap.MAP_SHARED,
      fd,
      0
    );
  }

  async embed(text) {
    const start = Date.now();

    // Write text to shared memory
    const textBytes = Buffer.from(text, "utf8");
    this.buffer.writeUInt32LE(textBytes.length, LAYOUT.TEXT_LENGTH);
    textBytes.copy(this.buffer, LAYOUT.TEXT_START);

    // Signal request ready
    this.buffer[LAYOUT.REQUEST_READY] = 1;

    // Wait for response (spin-wait for minimal latency)
    while (this.buffer[LAYOUT.RESPONSE_READY] !== 1) {
      await new Promise((r) => setImmediate(r));
    }

    // Read embedding directly from shared memory (ZERO COPY!)
    const embedding = new Float32Array(
      this.buffer.buffer,
      LAYOUT.EMBEDDING_START,
      256
    ).slice(); // Copy out of shared memory

    this.buffer[LAYOUT.RESPONSE_READY] = 0;

    return {
      embedding,
      latency_ms: Date.now() - start,
    };
  }
}

export const embeddingClient = new MmapEmbeddingClient();
```

---

## Phase 4: ColBERT Late Interaction

**Goal:** Cross-encoder precision at bi-encoder speed

### 4.1 What is Late Interaction?

Traditional approaches:

- **Bi-encoder:** Fast but less accurate (query and doc encoded separately)
- **Cross-encoder:** Accurate but slow (query + doc encoded together)

**ColBERT Late Interaction:** Best of both worlds

- Pre-compute token-level embeddings for all documents (indexing time)
- At query time: compute query token embeddings, then MaxSim matching

```
Query: "auth error"
Query tokens: ["auth", "error"]
Query embeddings: [[0.1, 0.2, ...], [0.3, 0.4, ...]]

Document: "AuthService handles authentication errors"
Pre-computed token embeddings: [[0.11, 0.21, ...], [0.5, 0.1, ...], ...]

MaxSim Score = max similarity between each query token and all doc tokens
            = max_sim("auth", doc_tokens) + max_sim("error", doc_tokens)
```

### 4.2 ColBERT Index Structure

```javascript
// colbert-index.js
const COLBERT_CONFIG = {
  tokenDim: 128, // Token embedding dimension
  maxTokensPerDoc: 512, // Max tokens to store per document
  compression: "pq", // Product quantization for storage
  nBits: 8, // Bits per dimension
};

// During indexing: store token-level embeddings
async function indexWithColBERT(chunks) {
  for (const chunk of chunks) {
    // Get token embeddings from Jina v3
    const { tokenEmbeddings } = await embedder.embedWithTokens(chunk.text);

    // Truncate to 128-dim for storage efficiency
    const truncated = tokenEmbeddings.map((t) => t.slice(0, 128));

    // Store in index
    await colbertIndex.add({
      id: chunk.id,
      tokenEmbeddings: truncated,
      numTokens: truncated.length,
    });
  }
}
```

### 4.3 Late Interaction Scoring

```javascript
// late-interaction.js
async function colbertScore(queryTokenEmbeddings, candidates) {
  const scores = [];

  for (const candidate of candidates) {
    // Load pre-computed token embeddings
    const docTokenEmbeddings = await colbertIndex.getTokens(candidate.id);

    // MaxSim: for each query token, find max similarity with any doc token
    let totalScore = 0;
    for (const queryToken of queryTokenEmbeddings) {
      let maxSim = -Infinity;
      for (const docToken of docTokenEmbeddings) {
        const sim = cosineSimilarity(queryToken, docToken);
        if (sim > maxSim) maxSim = sim;
      }
      totalScore += maxSim;
    }

    scores.push({
      ...candidate,
      colbertScore: totalScore / queryTokenEmbeddings.length,
      originalScore: candidate.score,
    });
  }

  // Sort by ColBERT score
  scores.sort((a, b) => b.colbertScore - a.colbertScore);
  return scores;
}
```

### 4.4 ColBERT vs Cross-Encoder Performance

| Method                       | 50 docs scoring | Accuracy | Pre-computation         |
| ---------------------------- | --------------- | -------- | ----------------------- |
| Cross-Encoder (BGE)          | 30ms            | 97%      | None                    |
| **ColBERT Late Interaction** | **12ms**        | **96%**  | Token embeddings stored |
| Jina Reranker v3             | ~80ms           | 97%      | `JINA_API_KEY` (free 10M tokens) |
| FlashRank                    | 15ms            | 95%      | None                    |

ColBERT gives us cross-encoder quality at **2.5x the speed**. Jina Reranker v3 provides SOTA BEIR accuracy (61.94 nDCG@10) with 131K context window.

---

## Phase 5: FlashRank Fallback Re-ranking

**Goal:** Fast re-ranking when ColBERT isn't sufficient

### 5.1 When to Use FlashRank

```javascript
// rerank-router.js
function selectReranker(query, candidates) {
  // ColBERT is usually sufficient
  const colbertScores = candidates.map((c) => c.colbertScore);
  const topScore = colbertScores[0];
  const variance = calculateVariance(colbertScores.slice(0, 5));

  // Use FlashRank only when ColBERT is uncertain
  if (topScore < 0.7 || variance < 0.02) {
    return "flashrank"; // Ambiguous results, need stronger re-ranking
  }

  return "colbert"; // ColBERT confidence is high
}
```

### 5.2 FlashRank Integration

```javascript
// flashrank.js
import { FlashRank } from "flashrank";

const ranker = new FlashRank({ model: "ms-marco-MiniLM-L-12-v2" });

async function flashRankRerank(query, candidates, topK = 10) {
  const documents = candidates.map((c) => ({
    id: c.id,
    text: c.text.slice(0, 512), // Truncate for speed
  }));

  const start = Date.now();
  const results = await ranker.rerank(query, documents, topK);
  const latency = Date.now() - start;

  console.log(`FlashRank: ${latency}ms for ${candidates.length} docs`);

  return results.map((r) => ({
    ...candidates.find((c) => c.id === r.id),
    flashRankScore: r.score,
  }));
}
```

---

## Phase 6: Unified Search Pipeline

### 6.1 Complete Search Flow

```javascript
// smart-search-v21.js
class SmartSearchV21 {
  constructor() {
    this.bm25 = new BM25Index();
    this.graph = new CodeGraph();
    this.hnsw = new HNSWIndex({ dimensions: 256 });
    this.colbert = new ColBERTIndex();
    this.embedder = new MmapEmbeddingClient();
  }

  async search(query, options = {}) {
    const { k = 10, mode = "auto" } = options;
    const start = Date.now();
    const stats = {};

    // Step 1: Route query
    const queryMode = mode === "auto" ? routeQuery(query) : mode;
    stats.mode = queryMode;

    if (queryMode === "bm25_graph") {
      // Fast path: BM25 + Graph expansion
      const bm25Start = Date.now();
      const results = await this.graphExpandedSearch(query, k);
      stats.bm25_graph_ms = Date.now() - bm25Start;

      return { results, stats, total_ms: Date.now() - start };
    }

    // Semantic path with full pipeline
    // Step 2: Embed query
    const embedStart = Date.now();
    const { embedding, tokenEmbeddings } = await this.embedder.embedWithTokens(
      query
    );
    stats.embed_ms = Date.now() - embedStart;

    // Step 3: HNSW search (256-dim)
    const hnswStart = Date.now();
    const candidates = await this.hnsw.search(embedding.slice(0, 256), 50);
    stats.hnsw_ms = Date.now() - hnswStart;

    // Step 4: ColBERT late interaction scoring
    const colbertStart = Date.now();
    const colbertScored = await colbertScore(tokenEmbeddings, candidates);
    stats.colbert_ms = Date.now() - colbertStart;

    // Step 5: Optional FlashRank if uncertain
    let finalResults = colbertScored;
    if (selectReranker(query, colbertScored) === "flashrank") {
      const flashStart = Date.now();
      finalResults = await flashRankRerank(
        query,
        colbertScored.slice(0, 20),
        k
      );
      stats.flashrank_ms = Date.now() - flashStart;
    }

    // Step 6: Graph expansion on top results
    const graphStart = Date.now();
    const graphExpanded = await this.graph.expand(finalResults.slice(0, k));
    stats.graph_ms = Date.now() - graphStart;

    return {
      results: graphExpanded,
      stats,
      total_ms: Date.now() - start,
    };
  }
}
```

### 6.2 CLI Interface

```bash
# Fast path: identifier search with graph expansion
code-search "AuthService"
# → Mode: bm25_graph | Total: 2.3ms
# → Results include related: AuthServiceTest, AuthController, LoginService

# Semantic search with full pipeline
code-search "how does user authentication work with JWT tokens"
# → Mode: semantic | Embed: 38ms | HNSW: 0.1ms | ColBERT: 11ms | Total: 52ms

# Force full pipeline
code-search "EmployeeService" --semantic
# → Mode: semantic | Embed: 35ms | HNSW: 0.1ms | ColBERT: 10ms | Total: 47ms

# Show graph relationships
code-search "AuthInterceptor" --show-graph
# → AuthInterceptor
#   ├─ implements: ServerInterceptor
#   ├─ calls: JwtTokenUtil.validateToken
#   ├─ calls: SecurityContext.setAuthentication
#   └─ throws: StatusRuntimeException
```

---

## Phase 7: Indexing Pipeline

### 7.1 Full Indexing Workflow

```javascript
// index-codebase-v21.js
async function indexCodebaseV21() {
  console.log("SEARCH 100x v2.1 - Full Codebase Indexing");
  console.log("=========================================");

  // Step 1: Discover files
  const files = await discoverFiles();
  console.log(`Found ${files.length} files`);

  // Step 2: Parse ASTs and extract graph
  console.log("\nPhase 1: Building Code Graph...");
  const { entities, relationships } = await buildCodeGraph(files);
  await graph.bulkInsert(entities, relationships);
  console.log(
    `  → ${entities.length} entities, ${relationships.length} relationships`
  );

  // Step 3: Late chunking with Jina v3
  console.log("\nPhase 2: Late Chunking with Jina v3...");
  const chunks = [];
  for (const file of files) {
    const fileChunks = await lateChunk(file.content, file.path);
    chunks.push(...fileChunks);
  }
  console.log(`  → ${chunks.length} chunks with global context`);

  // Step 4: Build HNSW index (256-dim)
  console.log("\nPhase 3: Building HNSW Index (256-dim)...");
  for (const chunk of chunks) {
    await hnsw.add(chunk.id, chunk.embedding_256);
  }
  await hnsw.build();
  console.log(`  → HNSW index ready`);

  // Step 5: Build ColBERT token index
  console.log("\nPhase 4: Building ColBERT Token Index...");
  for (const chunk of chunks) {
    await colbert.add(chunk.id, chunk.token_embeddings);
  }
  console.log(`  → ColBERT index ready`);

  // Step 6: Build FTS5 index
  console.log("\nPhase 5: Building BM25/FTS5 Index...");
  await buildFTS5Index(entities, chunks);
  console.log(`  → FTS5 index ready`);

  console.log("\n=========================================");
  console.log("Indexing complete!");
}
```

---

---

## File Structure

```
search-100x/
├── config.js                     # Centralized configuration
├── graph-extractor.js            # AST → Knowledge Graph
├── graph-search.js               # Graph-expanded BM25
├── late-chunker.js               # Jina v3 late chunking
├── embedding-server-mmap.js      # Shared memory server
├── embedding-client-mmap.js      # Shared memory client
├── hnsw-index.js                 # 256-dim HNSW wrapper
├── colbert-index.js              # ColBERT token index
├── late-interaction.js           # MaxSim scoring
├── flashrank.js                  # Fallback re-ranker
├── smart-search-v21.js           # Unified pipeline
├── query-router.js               # BM25 vs semantic routing
├── mcp-server.js                 # MCP integration
├── startup.sh                    # Service startup
├── benchmark.js                  # Performance benchmarks
└── index-codebase-v21.js         # Full indexing pipeline

.agentdb/
├── code-graph.db                 # SQLite: entities + relationships
├── codebase-hnsw.db              # 256-dim HNSW vectors
├── codebase-colbert.db           # Token-level embeddings
├── codebase-fts.db               # FTS5 BM25 index
└── sloth-vectors.db              # Existing learning episodes
```

---

## Implementation Checklist

### Phase 1: Code Graph (Day 1)

- [ ] Create graph schema (entities, relationships)
- [ ] Implement AST relationship extraction
- [ ] Build graph traversal queries
- [ ] Test graph-expanded BM25 (<3ms target)

### Phase 2: Jina v3 + Late Chunking (Day 2)

- [ ] Download Jina v3 ONNX model
- [ ] Implement late chunking with token embeddings
- [ ] Test context preservation on large files
- [ ] Benchmark vs traditional chunking

### Phase 3: Shared Memory IPC (Day 2-3)

- [ ] Implement mmap embedding server
- [ ] Implement mmap client
- [ ] Test zero-copy embedding transfer
- [ ] Benchmark IPC latency (<0.1ms target)

### Phase 4: ColBERT Late Interaction (Day 3)

- [ ] Store token embeddings during indexing
- [ ] Implement MaxSim scoring
- [ ] Benchmark scoring latency (~12ms target)
- [ ] Compare accuracy vs cross-encoder

### Phase 5: FlashRank Fallback (Day 4)

- [ ] Integrate FlashRank library
- [ ] Implement uncertainty detection
- [ ] Test fallback routing
- [ ] Benchmark fallback latency (~15ms target)

### Phase 6: Unified Pipeline (Day 4)

- [ ] Create smart-search-v21.js
- [ ] Implement full search flow
- [ ] Add CLI with --show-graph
- [ ] Integration tests

### Phase 7: MCP Integration (Day 5)

- [ ] Create mcp-server.js
- [ ] Add startup scripts
- [ ] Update MCP/tool settings (repo-specific location)
- [ ] End-to-end testing
- [ ] Documentation

---

## Model Downloads

```bash
# Download models for offline use
mkdir -p models

# Jina v3 (ONNX, quantized)
npx @xenova/transformers download jinaai/jina-embeddings-v3 \
  --quantized --output models/jina-v3

# FlashRank (lightweight)
npm install flashrank
```

---

## References

- [Jina Embeddings v3](https://huggingface.co/jinaai/jina-embeddings-v3)
- [Late Chunking Paper](https://arxiv.org/abs/2409.04701)
- [ColBERT: Efficient Passage Retrieval](https://arxiv.org/abs/2004.12832)
- [FlashRank](https://github.com/PrithivirajDamodaran/FlashRank)
- [Matryoshka Representation Learning](https://arxiv.org/abs/2205.13147)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [HNSW Algorithm](https://arxiv.org/abs/1603.09320)
- [Shared Memory IPC](https://man7.org/linux/man-pages/man7/shm_overview.7.html)
