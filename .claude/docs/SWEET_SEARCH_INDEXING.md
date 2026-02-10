# Smart Search Indexing System - Complete Technical Specification

> **Version:** 2.3 (Sweet Search)
> **Last Updated:** 2026-01-02
> **Location:** `./`

## Table of Contents

1. [Overview](#overview)
2. [Indexing Entry Points](#indexing-entry-points)
3. [Index Files Created](#index-files-created)
4. [Full Indexing Pipeline](#full-indexing-pipeline)
5. [Incremental Reindexing](#incremental-reindexing)
6. [HCGS (Hierarchical Code Graph Summary)](#hcgs-hierarchical-code-graph-summary)
7. [Vocabulary and Embedding Warmup](#vocabulary-and-embedding-warmup)
8. [CLI Flags and Options](#cli-flags-and-options)
9. [Index Preheating and Caching](#index-preheating-and-caching)
10. [Performance Characteristics](#performance-characteristics)

---

## Overview

The Smart Search indexing system builds a hybrid search infrastructure combining:

- **Lexical Search**: FTS5/BM25 full-text search with trigram fuzzy matching
- **Semantic Search**: HNSW Approximate Nearest Neighbor with vector embeddings
- **Graph Search**: Code entity relationships (calls, implements, extends)
- **ColBERT Reranking**: Token-level late interaction for precision

### Architecture Summary

```
Source Files
     |
     v
[Graph Extractor] -----> code-graph.db (entities + relationships + FTS5)
     |
     v
[Embedding Service] ---> codebase.db (vector embeddings)
     |
     v
[HNSW Builder] --------> codebase-hnsw.idx + codebase-hnsw.meta.json
     |
     v
[Binary HNSW] ---------> codebase-binary-hnsw.idx (binary quantized)
     |
     v
[ColBERT Tokenizer] ---> codebase-colbert.db (token embeddings)
     |
     v
[Vocabulary Warmup] ---> query-vocabulary.json (embedding-service.js)
                         vocabulary.bin (vocabulary-utils.js, optional)
```

---

## Indexing Entry Points

### 1. Primary Command: `/index-codebase`

**Location:** `.claude/commands/index-codebase.md`

**Underlying Script:** `node ./index-codebase-v21.js`

```bash
# Incremental index (DEFAULT - only changed files)
/index-codebase

# Full reindex (ignore previous state)
/index-codebase --full

# Graph only (lexical search)
/index-codebase --graph-only

# Vectors only (semantic search)
/index-codebase --vectors-only

# Statistics
/index-codebase --stats

# Dry run
/index-codebase --dry-run
```

### 2. Search Client: `ss` (C binary) / `ss.sh` (Bash fallback)

**Location:**
- `./ss` - Compiled C binary (from `ss-fast/ss-fast.c`)
- `./ss.sh` - Bash fallback wrapper

The `ss` binary is a compiled C program (~19KB), NOT a symlink. It provides the primary search interface with ~2-5ms client overhead (vs ~10-20ms for shell wrapper).

> **Sources of truth:**
> - Binary: `ss-fast/ss-fast.c` (compiled with `make` in `ss-fast/`)
> - Fallback: `ss.sh`

```bash
# Search (not indexing)
./ss "AuthService"
./ss "how does auth work" --mode semantic
```

### 3. Direct Script Invocation

```bash
# Main indexer
node ./index-codebase-v21.js [options]

# Graph extraction only
node ./graph-extractor.js

# HNSW index building
node ./hnsw-index.js build

# Binary HNSW building
node ./binary-hnsw-index.js build

# ColBERT token indexing
node ./colbert-index.js index

# Vocabulary warmup
node ./vocabulary-warmup.js
node ./prewarm-vocab.js

# Embedding service warmup
node ./embedding-service.js warmup
```

---

## Index Files Created

All index files are stored in `.sweet-search/` directory.

> **Sources of truth:** `DB_PATHS` in `config.js` (lines 55-85)

| File | Purpose | Size (typical) | Created By |
|------|---------|----------------|------------|
| `code-graph.db` | FTS5 entities + relationships | 2-15 MB | `graph-extractor.js` |
| `codebase.db` | Vector embeddings (SQLite) | 30-60 MB | `index-codebase-v21.js` |
| `codebase-hnsw.idx` | HNSW index (hnswlib-node format) | 20-25 MB | `hnsw-index.js` |
| `codebase-binary-hnsw.meta.json` | Binary HNSW metadata | <1 KB | `binary-hnsw-index.js` |
| `codebase-binary-hnsw.vectors.json` | Binary vectors | 5-10 MB | `binary-hnsw-index.js` |
| `codebase-binary-hnsw.graph.json` | Binary HNSW graph structure | 2-5 MB | `binary-hnsw-index.js` |
| `codebase-binary-hnsw.int8.json` | **Int8 vectors for Stage 2 (CANONICAL)** | 10-20 MB | `binary-hnsw-index.js` |
| `codebase-colbert.db` | ColBERT token embeddings | 15-40 MB | `colbert-index.js` |
| `query-vocabulary.json` | Cached query embeddings (JSON) | 150-170 MB | `embedding-service.js` |
| `query-vocabulary-stats.json` | Query frequency statistics | 2-3 MB | `embedding-service.js` |
| `vocabulary.bin` | Binary vocabulary (optional, 256d truncated) | 1-2 MB | `vocabulary-utils.js` |
| `vocabulary.meta.json` | Binary vocabulary metadata | ~500 KB | `vocabulary-utils.js` |
| `code-summaries.json` | HCGS summaries cache | ~1 MB | HCGS generator |
| `merkle-state.json` | Incremental indexing state | ~100 KB | `incremental-tracker.js` |
**Note on Int8 Storage:** The `.int8.json` sidecar alongside binary HNSW is the canonical source for stage-2 rescoring. The SQLite approach (`codebase-int8.db`) was deprecated and removed.

**Note:** `vocabulary.bin` is created by `vocabulary-utils.js` for optional binary format (Matryoshka 256d truncation). The primary vocabulary cache used by `embedding-service.js` is `query-vocabulary.json` (JSON format, full 1024d embeddings).

### File Relationships

```
merkle-state.json
  └── Tracks file hashes (SHA-256 truncated to 16 hex chars) for incremental detection

code-graph.db
  ├── entities table (classes, methods, functions, etc.)
  ├── relationships table (calls, implements, extends)
  ├── entities_fts (FTS5 full-text index)
  └── entities_trigram (FTS5 trigram tokenizer for fuzzy)

codebase.db
  └── vectors table (id, embedding BLOB, text, metadata JSON)

codebase-hnsw.idx
  └── Native hnswlib-node binary index

codebase-binary-hnsw.* (meta.json, vectors.json, graph.json, int8.json)
  ├── Binary quantized HNSW for 3-stage retrieval (Stage 1: Hamming distance)
  └── .int8.json is the CANONICAL source for Stage 2 rescoring (O(1) Map lookup)

codebase-colbert.db
  └── tokens table (doc_id, token_embeddings BLOB)

query-vocabulary.json (embedding-service.js)
  └── JSON object: { "term": [1024d float array], ... }
      Primary vocabulary cache with full-dimension embeddings

vocabulary.bin (vocabulary-utils.js, optional)
  ├── Header: VCAB magic, version, dimension, term count
  └── Float32 embeddings (256d Matryoshka truncated)

vocabulary.meta.json (vocabulary-utils.js, optional)
  └── Term list, dimension, timestamps for vocabulary.bin
```

---

## Full Indexing Pipeline

The indexer (`index-codebase-v21.js`) runs a 5-phase pipeline:

### Phase 1: File Discovery and Change Detection

> **Sources of truth:** `incremental-tracker.js` - `hashContent()` function (line 140), `getChangedFiles()` function (line 195)

```javascript
// Uses incremental-tracker.js
const { toIndex, toRemove, unchanged, currentHashes, configValidation } = await getChangedFiles(allFiles, projectRoot);
```

**What it does:**
1. Scans all source files matching include patterns
2. Computes content hashes using **SHA-256 truncated to 16 hex characters** (NOT xxHash)
3. Compares against `merkle-state.json`
4. Validates config fingerprint (provider/model/dimension changes)
5. Returns lists of files to index, remove, and unchanged files

**Hash function (from incremental-tracker.js line 140):**
```javascript
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}
```

**Configuration (config.js):**
```javascript
FILES_CONFIG: {
  includePatterns: [
    '**/*.java', '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx',
    '**/*.proto', '**/*.md', '**/*.json', '**/*.xml', '**/*.yml'
  ],
  excludePatterns: [
    '**/node_modules/**', '**/target/**', '**/build/**',
    '**/.git/**', '**/dist/**', '**/*.min.js'
  ]
}
```

### Phase 2: Code Graph Extraction

```javascript
// Uses graph-extractor.js
const extractor = new GraphExtractor(codeGraphPath);
await extractor.extractFromFiles(changedFiles);
```

**What it does:**
1. Parses source files using tree-sitter (Java, JS/TS)
2. Extracts entities: classes, interfaces, methods, functions, fields, enums
3. Extracts relationships: extends, implements, calls, uses, throws, imports
4. Generates summaries for HCGS
5. Builds FTS5 full-text indexes with trigram support

**Schema (code-graph.db):**
```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  file_path TEXT,
  type TEXT,           -- 'class', 'method', 'function', 'interface', etc.
  name TEXT,
  signature TEXT,
  doc_comment TEXT,
  summary TEXT,        -- HCGS: Generated 1-line summary
  start_line INTEGER,
  end_line INTEGER,
  package TEXT,
  parent_class TEXT,
  search_text TEXT     -- Concatenated searchable text
);

CREATE TABLE relationships (
  id INTEGER PRIMARY KEY,
  source_id TEXT,
  target_id TEXT,
  target_name TEXT,    -- For unresolved references
  type TEXT,           -- 'calls', 'implements', 'extends', 'uses', 'throws'
  weight REAL,
  context_line INTEGER
);

-- Full-text search indexes
CREATE VIRTUAL TABLE entities_fts USING fts5(
  name, signature, doc_comment, search_text,
  content=entities, content_rowid=rowid
);

-- Trigram index for fuzzy matching ("Auth" -> "AuthenticationService")
CREATE VIRTUAL TABLE entities_trigram USING fts5(
  name, search_text,
  tokenize='trigram'
);
```

### Phase 3: Vector Embedding Generation

```javascript
// Uses embedding-service.js
const { getEmbedding, warmup } = require('./embedding-service.js');
await warmup({ initVocabulary: true, initSemanticCache: true });

for (const chunk of astChunks) {
  const embedding = await getEmbedding(chunk.text);
  await db.insert('vectors', { id, embedding, text, metadata });
}
```

**What it does:**
1. Chunks source code at semantic boundaries (functions, classes, methods)
2. Generates embeddings using Voyage AI (voyage-code-3, 1024d)
3. Falls back to local all-MiniLM-L6-v2 (384d) if API unavailable
4. Stores embeddings in SQLite BLOB format

**Embedding Configuration:**
```javascript
EMBEDDING_CONFIG: {
  provider: 'voyage',
  model: 'voyage-code-3',
  dimension: 1024,        // Full dimension from API
  hnswDimension: 512,     // Matryoshka truncation for HNSW
  batchSize: 32,
  maxRetries: 3,
  timeout: 30000
}
```

### Phase 4: HNSW Index Building

```javascript
// Uses hnsw-index.js and binary-hnsw-index.js
const hnswIndex = new HNSWIndex({ indexPath });
await hnswIndex.buildFromDB(codebaseDbPath);
await hnswIndex.save();

const binaryIndex = new BinaryHNSWIndex({ indexPath });
await binaryIndex.buildFromDB(codebaseDbPath);
await binaryIndex.save();
```

**What it does:**
1. Loads all embeddings from codebase.db
2. Truncates to 512d (Matryoshka dimensionality reduction)
3. Builds HNSW graph structure using hnswlib-node
4. Builds binary quantized index using usearch
5. Saves index and metadata files

**HNSW Configuration:**
```javascript
HNSW_CONFIG: {
  dimension: 512,         // Truncated dimension
  M: 16,                  // HNSW graph connectivity
  efConstruction: 200,    // Build-time search depth
  efSearch: 100,          // Query-time search depth
  metric: 'cosine',       // Distance metric
  maxElements: 100000     // Max vectors
}

BINARY_HNSW_CONFIG: {
  enabled: true,
  dimension: 512,
  metric: 'hamming',      // Binary distance
  connectivity: 32,       // Higher for binary
  efConstruction: 400,
  efSearch: 200,
  retrieval: {
    stage1Candidates: 1000,   // Binary HNSW
    stage2Candidates: 100,    // Int8 rescore
    stage3Candidates: 20      // Rerank
  }
}
```

### Phase 5: ColBERT Token Indexing

```javascript
// Uses colbert-index.js
const colbert = new ColBERTIndex({ indexPath });
await colbert.indexFromDB(codebaseDbPath);
```

**What it does:**
1. Tokenizes each document using BERT tokenizer
2. Generates per-token embeddings (64d, int8 quantized)
3. Stores token embeddings for MaxSim late interaction
4. Enables cross-encoder quality at bi-encoder speed

**ColBERT Configuration:**
```javascript
COLBERT_CONFIG: {
  enabled: true,
  tokenDimension: 64,     // Per-token embedding size
  maxTokens: 512,         // Max tokens per document
  quantize: true,         // Int8 quantization (4x compression)
  blendWeight: 0.3        // Weight in 3-stage scoring
}
```

---

## Incremental Reindexing

### How It Works

> **Sources of truth:** `incremental-tracker.js` - `getChangedFiles()` (line 195), `hashContent()` (line 140)

The incremental tracker uses **SHA-256 hashes truncated to 16 hex characters** for change detection:

```javascript
// From incremental-tracker.js (actual implementation)
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// getChangedFiles() returns:
// { toIndex, toRemove, unchanged, currentHashes, configInvalidated, configValidation }
```

**Key features:**
1. **Config-aware invalidation:** If embedding provider/model/dimension changes, forces full reindex
2. **SHA-256 hashing:** Content hashes are SHA-256 truncated to 16 hex chars (NOT xxHash)
3. **State versioning:** Version 2.2 with config fingerprint tracking

### State File Structure (`merkle-state.json`)

```json
{
  "version": "2.2",
  "config_fingerprint": {
    "provider": "voyage",
    "model": "voyage-code-3",
    "dimension": 1024,
    "hnswDimension": 512
  },
  "files": {
    "CLAUDE.md": "b15db2de0432761d",
    "src/AuthService.java": "8f6ccd030a3d6858",
    "...": "..."
  },
  "lastIndexed": "2025-12-30T12:41:00.000Z",
  "stats": {
    "totalFiles": 930,
    "totalVectors": 11924,
    "totalEntities": 2847
  }
}
```

### Incremental vs Full Reindex

| Aspect | Incremental | Full |
|--------|-------------|------|
| Command | `/index-codebase` | `/index-codebase --full` |
| Time | 10-30 seconds | 3-5 minutes |
| Scope | Changed files only | All files |
| HNSW | Updated in place | Rebuilt from scratch |
| Merkle state | Updated | Regenerated |

### Config Fingerprint Invalidation

If the embedding configuration changes, the entire index is automatically rebuilt:

```javascript
// Fingerprint includes model, dimension, provider
const fingerprint = {
  provider: config.provider,
  model: config.model,
  dimension: config.dimension,
  hnswDimension: config.hnswDimension,
  version: config.version
};

if (!deepEqual(previousFingerprint, fingerprint)) {
  console.log('Config changed, forcing full reindex');
  return { forceFullReindex: true };
}
```

---

## HCGS (Hierarchical Code Graph Summary)

### What is HCGS?

HCGS generates human-readable summaries for code entities, enabling:
- 10x token reduction in search results
- Quick understanding without reading full code
- Progressive disclosure (summary -> signature -> full code)

### Summary Generation

The `hcgs-generator.js` creates summaries during graph extraction:

```javascript
class HCGSGenerator {
  generateSummary(entity) {
    const { type, name, signature, docComment, relationships } = entity;

    // Use doc comment first line if available
    if (docComment) {
      const firstLine = docComment.split('\n')[0].replace(/^[\/*\s]+/, '');
      if (firstLine.length > 10) return firstLine.slice(0, 100);
    }

    // Generate from signature and relationships
    const verbs = this.inferVerbs(type, name, relationships);
    return `${verbs.join(', ')} for ${this.humanize(name)}`;
  }

  inferVerbs(type, name, relationships) {
    const verbs = [];
    if (type === 'method') {
      if (name.startsWith('get')) verbs.push('Retrieves');
      if (name.startsWith('set')) verbs.push('Sets');
      if (name.startsWith('is') || name.startsWith('has')) verbs.push('Checks');
      if (name.startsWith('create')) verbs.push('Creates');
      if (name.startsWith('delete') || name.startsWith('remove')) verbs.push('Deletes');
    }
    return verbs.length ? verbs : ['Handles'];
  }
}
```

### Output Formats

The search system supports three output resolutions:

1. **Summary View** (`--summary`): 10x fewer tokens
   ```
   1. [method] authenticate @ AuthService.java:45
      Validates user credentials and returns JWT token
   ```

2. **Middle-Res View** (`--mid`): 5x fewer tokens
   ```
   1. [method] authenticate
      AuthService.java:45
      public String authenticate(String username, String password)
      Validates user credentials against database
   ```

3. **Full View** (default): Full signatures and content

---

## Vocabulary and Embedding Warmup

> **Sources of truth:**
> - `embedding-service.js` - Primary vocabulary cache via `query-vocabulary.json` (JSON format)
> - `vocabulary-utils.js` - Optional binary vocabulary format via `vocabulary.bin`

### Two Vocabulary Systems

**1. Primary: `query-vocabulary.json` (embedding-service.js)**
- JSON format with full 1024d embeddings
- Auto-populated by `embedding-service.js` based on query frequency
- Used by `Vocabulary` class in embedding-service.js

**2. Optional: `vocabulary.bin` (vocabulary-utils.js)**
- Binary format with 256d Matryoshka-truncated embeddings
- Created via `node vocabulary-utils.js migrate` or `warmup`
- Used by `BinaryVocabulary` class in vocabulary-utils.js

### Embedding Service Warmup

The `embedding-service.js` loads vocabulary from `query-vocabulary.json`:

```javascript
// From embedding-service.js (actual implementation)
class Vocabulary {
  constructor(vocabPath) {
    this.vocabPath = vocabPath;  // DB_PATHS.vocabulary = query-vocabulary.json
    this.terms = new Map();
  }

  async load() {
    if (existsSync(this.vocabPath)) {
      const data = JSON.parse(await fs.readFile(this.vocabPath, 'utf-8'));
      // Check provider compatibility
      if (data.metadata?.provider && data.metadata.provider !== EMBEDDING_CONFIG.provider) {
        console.log(`Vocabulary: Provider changed, clearing cache`);
        this.terms.clear();
      } else {
        for (const [term, embedding] of Object.entries(data.terms || {})) {
          this.terms.set(term, embedding);
        }
      }
    }
  }
}
```

### Query Vocabulary Caching

The `query-vocabulary.json` structure (from embedding-service.js):

```javascript
// query-vocabulary.json actual structure
{
  "metadata": {
    "provider": "voyage",
    "lastUpdated": "2025-12-31T03:38:00.000Z",
    "created": "2025-12-30T15:22:00.000Z"
  },
  "terms": {
    "authservice": [0.123, -0.456, ...],   // 1024d float array (normalized term as key)
    "how does authentication work": [...], // 1024d float array
  }
}
```

### Auto-Persist on Exit

The embedding service registers an exit handler to persist frequent queries:

```javascript
// From embedding-service.js (actual implementation)
export function registerAutoPersistOnExit(threshold = 2) {
  process.on('beforeExit', persist);
  process.on('SIGINT', async () => { await persist(); process.exit(0); });
  process.on('SIGTERM', async () => { await persist(); process.exit(0); });
}
```

### Binary Vocabulary (Optional - vocabulary-utils.js)

For faster loading, `vocabulary-utils.js` provides a binary format:

```javascript
// vocabulary.bin format (from vocabulary-utils.js BinaryVocabulary class)
// Header (32 bytes): VCAB magic, version=2, dimension=256, termCount
// Embeddings: Float32Array (256 * termCount * 4 bytes)

// vocabulary.meta.json structure
{
  "version": 2,
  "dimension": 256,  // Matryoshka truncated
  "termCount": 1500,
  "created": "2025-12-31T00:00:00.000Z",
  "terms": ["authservice", "employeeservice", ...]
}
```

---

## CLI Flags and Options

### `/index-codebase` Command

| Flag | Description | Default |
|------|-------------|---------|
| (none) | Incremental index - only changed files | - |
| `--full` | Full reindex - ignore previous state | false |
| `--graph-only` | Only build code graph (lexical search) | false |
| `--vectors-only` | Only build vector embeddings (semantic) | false |
| `--stats` | Show indexing statistics | false |
| `--dry-run` | Show what would be indexed | false |
| `--verbose` | Enable verbose logging | false |

### Smart Search (`ss`) Command

| Flag | Description | Default |
|------|-------------|---------|
| `--mode <mode>` | Search mode: auto, lexical, semantic, hybrid | auto |
| `--top <n>`, `-k <n>` | Number of results | 10 |
| `--no-expand` | Disable graph expansion | false |
| `--no-rerank` | Disable reranking | false |
| `--fusion <type>` | Hybrid fusion: cc or rrf | cc |
| `--colbert` | Enable ColBERT late interaction | config |
| `--summary` | HCGS summary-first output | false |
| `--mid` | Middle-res view (signature + doc) | false |
| `--json` | Output as JSON | false |
| `--verbose`, `-v` | Enable verbose logging | false |
| `--cold` | Force cold start (skip server) | false |

### Graph Search Command

```bash
node ./graph-search.js <query> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--no-expand` | Disable graph expansion (BM25 only) | false |
| `--force-expand` | Force graph expansion even for exact matches | false |
| `--top <n>` | Number of results | 10 |
| `--stats` | Show database statistics | false |
| `--json` | Output as JSON | false |

### HNSW Index Command

```bash
node ./hnsw-index.js <command>
```

| Command | Description |
|---------|-------------|
| `build` | Build HNSW index from codebase.db |
| `search <query>` | Search the index |
| `stats` | Show index statistics |

---

## Index Preheating and Caching

### HTTP Warm Server

The search system includes an auto-starting HTTP server for index preheating:

```javascript
// sweet-search.js
const SEARCH_SERVER_PORT = 9876;
const SEARCH_SERVER_SOCKET = '/tmp/sweet-search.sock';

async function startServer() {
  const searcher = new SweetSearch({ verbose: false });
  await searcher.init();  // Loads all indexes into memory

  // TCP server (backward compatible)
  const tcpServer = http.createServer(handleRequest);
  tcpServer.listen(SEARCH_SERVER_PORT);

  // Unix socket (30-50% faster)
  const unixServer = http.createServer(handleRequest);
  unixServer.listen(SEARCH_SERVER_SOCKET);
}
```

**Auto-start behavior:**
1. First search checks if server is running
2. If not, spawns server in background
3. Waits up to 5s for server to be ready
4. Falls back to cold start if timeout

### Index Loading Sequence

```javascript
async init() {
  // 1. Load Binary HNSW (3-stage retrieval)
  if (this.hasBinaryHnswIndex && this.use3Stage) {
    await this.binaryHnswIndex.load();  // ~50ms, 26MB
  }

  // 2. Load Float HNSW (fallback)
  if (this.hasHnswIndex) {
    await this.hnswIndex.load();  // ~100ms, 25MB
  }

  // 3. Load ColBERT tokens
  if (this.hasColbertIndex && this.useColBERT) {
    await this.colbertIndex.init();  // ~50ms, 19MB
  }

  // 4. Warm embedding service
  await warmupEmbedding({
    initVocabulary: true,      // Load query-vocabulary.json (JSON format)
    initSemanticCache: true    // Initialize semantic cache local model
  });
}
```

### Memory Footprint

| Component | Memory | Load Time |
|-----------|--------|-----------|
| Binary HNSW | ~26 MB | ~50ms |
| Float HNSW | ~25 MB | ~100ms |
| ColBERT | ~19 MB | ~50ms |
| Vocabulary | ~16 MB | ~30ms |
| Query Cache | ~170 MB | ~200ms |
| **Total** | **~256 MB** | **~430ms** |

---

## Performance Characteristics

> **Sources of truth:**
> - Targets: `PERFORMANCE_TARGETS` in `config.js` (lines 597-607)
> - Typical: Code comments in `sweet-search.js` header (~275ms semantic)
> - Measured: Run `node benchmark.js` for actual measurements

### Indexing Performance

| Operation | Time (930 files) | Notes |
|-----------|------------------|-------|
| Full index | 3-5 minutes | All phases |
| Incremental (no changes) | <1 second | Hash check only |
| Incremental (10 files) | 10-30 seconds | Delta processing |
| Graph extraction | ~60 seconds | AST parsing |
| Embedding generation | ~120 seconds | API calls |
| HNSW building | ~30 seconds | In-memory |
| ColBERT indexing | ~60 seconds | Token generation |

### Search Performance (Warm)

| Mode | Latency | Source |
|------|---------|--------|
| Query routing | <1ms | (target) `PERFORMANCE_TARGETS.latency` |
| Lexical (FTS5) | <10ms | (target) `lexicalP50: 10` |
| Lexical (actual) | 6-10ms | (typical) code observation |
| HNSW lookup | <1ms | (target) `hnswLookupP50: 1` |
| Semantic (end-to-end) | <150ms | (target) `semanticP50: 150` |
| Semantic (actual) | ~275ms | (typical) sweet-search.js header |
| Reranking (FlashRank only) | ~15ms | (typical) cascaded Stage 1 |
| Reranking (cascaded full) | ~100-350ms | (typical) FlashRank + Voyage/Jina |
| Semantic (cached) | <10ms | (typical) vocabulary/LRU hit |
| Structural (graph) | <10ms | (typical) code observation |

### Cache Hit Rates

| Cache | Typical Hit Rate | Impact |
|-------|------------------|--------|
| Vocabulary | 70-80% | Skip embedding |
| Query cache | 40-60% | Skip API call |
| Graph (FTS5) | 100% (index) | Always fast |
| HNSW | 100% (index) | Always fast |

---

## Automatic File Change Detection

The indexing system automatically detects and processes ALL file changes, regardless of source.

### Detection Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  index-maintainer.mjs (Daemon v3)                                    │
│  ├─ DEFERRED first check (7s delay, ZERO startup latency)           │
│  ├─ Global lock file (.sweet-search/indexing.lock) - RACE PROTECTION     │
│  └─ Every 45 seconds: Full filesystem merkle check                  │
│      ├─ fs.stat() for all indexable files (~0.1ms each)             │
│      ├─ Compare (size, mtime_ns) with stored values                 │
│      └─ Only read content if metadata changed                       │
│                                                                      │
│  If changes detected:                                               │
│     └─ Run full incremental index                                   │
│        ├─ FTS5: DELETE old entries, INSERT new                      │
│        ├─ HNSW: Remove old vectors, add new                         │
│        ├─ Binary HNSW: Rebuild from float HNSW                      │
│        ├─ Code Graph: Full rebuild (~10s, FREE, cross-file safe)    │
│        ├─ HCGS: Regenerate for changed files                        │
│        │   └─ Fallback: Cerebras → Ollama → Transformers → Static   │
│        └─ Vocabulary: Skipped (warmup on session start)             │
└─────────────────────────────────────────────────────────────────────┘
```

### Detection Intervals

| Source | Detection Method | Latency |
|--------|------------------|---------|
| Claude Code edits | PostToolUse hooks → queue → daemon poll | ~30 seconds (avg ~15s) |
| External IDE edits (Cursor, VS Code) | Periodic merkle check | ~45 seconds (avg ~22s) |
| Git operations | Merkle check detects | ~45 seconds |

**Configuration:**
- **Queue polling**: 30 seconds - processes Claude Code edits queued by hooks
- **Merkle check**: 45 seconds - full filesystem scan for external changes
- **Startup delay**: 7 seconds - allows editor to settle before first check
- **Indexing timeout**: 5 minutes - fail fast for stuck operations

### What Gets Updated

| Component | Update Strategy | API Cost |
|-----------|-----------------|----------|
| FTS5 lexical index | DELETE old, INSERT new | FREE |
| HNSW semantic vectors | Incremental (changed files only) | Voyage API |
| Binary HNSW index | Rebuild if >5% vectors changed | FREE |
| Code graph | Full rebuild (~10s) | FREE (regex only) |
| HCGS summaries | Regenerate for changed files | LLM API |
| Vocabulary cache | Skipped (warmup on session start) | FREE |

### HCGS Fallback Chain

When generating summaries for entities, the system uses a 4-tier fallback:

```
1. Cerebras GLM-4.6 (PRIMARY)
   • Speed: ~1000 tokens/second
   • Cost: ~$0.001 per summary
   • Quality: Excellent for code
   └─ If fails (rate limit, API down) →

2. Ollama Local (FALLBACK 1)
   • Model: qwen2.5-coder:7b-instruct
   • Speed: ~50-100 tokens/second (GPU dependent)
   • Cost: Free (local)
   • Requires: Ollama running at localhost:11434
   └─ If fails (not running, timeout) →

3. Transformers.js (FALLBACK 2)
   • Model: phi-3-mini-4k-instruct
   • Speed: ~5-10 tokens/second (CPU)
   • Cost: Free (local)
   • No external dependencies
   └─ If fails (OOM, timeout) →

4. Static Fallback (ULTIMATE)
   • Uses: doc_comment if available
   • Otherwise: "{type} {name}" (e.g., "method authenticate")
   • Always succeeds
```

### Soft Delete Strategy

Files removed from the filesystem are marked as "stale" rather than immediately deleted:

```javascript
// Mark file as stale (soft delete)
UPDATE entities SET stale_since = unixepoch() WHERE file_path = ?

// Search queries exclude stale entries
WHERE stale_since IS NULL

// Prune entries stale > 30 days
DELETE FROM entities WHERE stale_since IS NOT NULL
  AND stale_since < (unixepoch() - 30*24*60*60)
```

**Benefits:**
- Branch switches don't lose HCGS summaries
- Stale entries can be restored without regeneration
- 30-day retention prevents unbounded growth

---

## Security Hardening

### Lock File Management

> **Source:** `.claude/hooks/index-maintainer.mjs`

All lock files use a security-first pattern with ownership verification:

```javascript
// === Lock Management ===
// SECURITY INVARIANT: All lock release functions MUST verify ownership before releasing.
// Pattern: read lock file → verify PID matches process.pid → then release
// This prevents Process A from accidentally releasing Process B's lock.

// Lock file locations (in .sweet-search directory, not /tmp)
const LOCK_FILE = path.join(DATA_DIR, 'index-maintainer.lock');
const GLOBAL_INDEX_LOCK = path.join(DATA_DIR, 'indexing.lock');

// Lock file format
`${process.pid}\n${Date.now()}\n`

// File permissions: 0o600 (owner-only read/write)
```

### Ownership Verification Pattern

**refreshLock() with ownership check:**
```javascript
function refreshLock() {
  try {
    const existing = readLockFile();
    if (existing && existing.pid === process.pid) {
      writeLock();
      return true;
    } else {
      // Lost lock ownership - another process took over
      console.error('[index-maintainer] WARNING: Lost lock ownership');
      return false;
    }
  } catch (err) {
    return false;
  }
}
```

**releaseGlobalIndexLock() with PID verification:**
```javascript
function releaseGlobalIndexLock() {
  try {
    const content = readFileSync(GLOBAL_INDEX_LOCK, 'utf-8');
    const [pidStr] = content.trim().split('\n');
    const lockPid = parseInt(pidStr, 10);

    if (lockPid === process.pid) {
      unlinkSync(GLOBAL_INDEX_LOCK);
    } else {
      console.error(`Not releasing - owned by PID ${lockPid}, we are ${process.pid}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Error releasing global lock: ${err.message}`);
    }
  }
}
```

---

## Error Handling Patterns

### Circuit Breaker for Voyage API

> **Source:** `./embedding-service.js`

Prevents cascading failures during API outages:

```javascript
const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED',  // CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)

  // Configuration
  FAILURE_THRESHOLD: 5,      // Open circuit after 5 consecutive failures
  COOLDOWN_MS: 60000,        // Wait 60s before testing recovery
  SUCCESS_TO_CLOSE: 2,       // Need 2 successes to close circuit

  canRequest() {
    if (this.state === 'CLOSED') return { allowed: true };
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.COOLDOWN_MS) {
        this.state = 'HALF_OPEN';
        return { allowed: true };
      }
      return { allowed: false, reason: `Circuit OPEN - retry in ${cooldownRemaining}s` };
    }
    return { allowed: true }; // HALF_OPEN
  },

  recordSuccess() { /* ... */ },
  recordFailure() { /* ... */ }
};
```

### ENOSPC (Disk Full) Handling

> **Source:** `.claude/hooks/index-maintainer.mjs`, `./incremental-tracker.js`

Safe write with atomic temp+rename pattern:

```javascript
async function safeWriteFile(filePath, content) {
  const tempPath = `${filePath}.tmp.${process.pid}`;

  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    // Always try to clean up temp file
    try { await fs.unlink(tempPath); } catch {}

    if (err.code === 'ENOSPC') {
      throw new Error(`CRITICAL: Disk full, cannot write to ${filePath}`);
    }
    throw err;
  }
}
```

### State File Recovery

Differentiates between corrupt and missing state:

```javascript
async function loadMerkleState() {
  try {
    const content = await fs.readFile(MERKLE_STATE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Missing - normal for first run
      return { files: {}, version: '2.2' };
    }
    if (err instanceof SyntaxError) {
      // Corrupt - backup and recreate
      await backupCorruptState();
      return { files: {}, version: '2.2' };
    }
    throw err;
  }
}
```

---

## Implemented Fixes Summary (v2.3)

### Fix Categories

| Category | Count | Critical Issues |
|----------|-------|-----------------|
| Security (S) | 5 | Lock files, permissions, PID validation |
| Error Handling (E) | 8 | Circuit breaker, ENOSPC, state recovery |
| Performance (P) | 9 | stale_since index, N+1 batching, async patterns |
| Architecture (A) | 3 | Vector filtering, module loader, DRY indexer |
| Tests (T) | 3 | Integration tests for real modules |
| Documentation (D) | 6 | Latency claims, version strings, intervals |
| **Total** | **34** | Comprehensive hardening |

### P0 Workstreams (Completed)

| Workstream | Description | Status |
|------------|-------------|--------|
| A | Fix incremental vector indexing (stop wiping codebase.db) | DONE |
| B | Fix HCGS regeneration pipeline (remove sql.js misuse) | DONE |
| C | Fix HCGS generator correctness (hierarchy + embeddings) | DONE |
| D | Fix index maintainer queue race (rename-before-read) | DONE |
| E | Implement targeted indexing flags (--files-from-stdin, --quiet) | DONE |

### Key Fixes

| Fix | Description | File |
|-----|-------------|------|
| C1 | refreshLock() ownership check | index-maintainer.mjs |
| C2 | releaseGlobalIndexLock() PID verification | index-maintainer.mjs |
| H1 | Circuit breaker for Voyage API | embedding-service.js |
| H2 | Corrected latency claims (~30s queue, ~45s merkle) | CLAUDE.md |
| H3 | ENOSPC handling with atomic writes | index-maintainer.mjs |
| S1 | Lock files moved to .sweet-search | index-maintainer.mjs |
| S2 | Lock file permissions 0o600 | index-maintainer.mjs |
| P1 | stale_since column + covering index | graph-extractor.js |

> **Full changelog:** See `.claude/docs/search/INDEXING_FIXES_CHANGELOG.md`

---

## Summary

The Smart Search indexing system is a sophisticated multi-layer infrastructure:

1. **Entry Point**: `/index-codebase` command or direct script invocation
2. **Incremental Tracking**: SHA-256 content hashes (16 hex chars) in `merkle-state.json`
3. **Code Graph**: FTS5 + trigram for fast lexical search (`code-graph.db`)
4. **Vector Index**: HNSW + Binary HNSW for semantic search (`codebase-hnsw.idx`, `codebase-binary-hnsw.idx`)
5. **ColBERT**: Token-level precision for reranking (`codebase-colbert.db`)
6. **Vocabulary**: Pre-computed embeddings via `query-vocabulary.json` (JSON, 1024d) or optional `vocabulary.bin` (binary, 256d)
7. **Warm Server**: Persistent HTTP server for index preheating

Key design principles:
- **Incremental by default**: Only process changed files (SHA-256 based)
- **Multi-resolution**: Summary -> signature -> full code
- **3-stage retrieval**: Binary HNSW -> Int8 rescore -> Rerank
- **Graceful fallback**: Voyage -> FlashRank, HNSW -> scan
- **Cache everywhere**: Queries, embeddings, indexes

> **Key Sources of Truth:**
> - `config.js`: `DB_PATHS`, `PERFORMANCE_TARGETS`, embedding provider config
> - `incremental-tracker.js`: `hashContent()` (SHA-256), `getChangedFiles()`
> - `embedding-service.js`: `Vocabulary` class, `query-vocabulary.json` format
> - `vocabulary-utils.js`: `BinaryVocabulary` class, `vocabulary.bin` format
> - `ss-fast/ss-fast.c`: C binary client source
