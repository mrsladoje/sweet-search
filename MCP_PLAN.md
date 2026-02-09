# Plan v3: Reorganize Sweet Search + Add MCP Server (Claude Code + Codex)

## Context

Sweet Search is a hybrid code search engine with 40+ JS files dumped in the root directory. It integrates with Claude Code via hooks/HTTP server but is **not** an MCP server. To support both Claude Code and Codex CLI, it needs to become an MCP server (the universal plugin protocol both support via stdio transport). The user also wants the root cleaned up.

**Project is ESM** (`"type": "module"` in package.json) — all `.js` files use ES module syntax.

**Two goals in one PR:**
1. Reorganize root files into `core/` and `scripts/`
2. Add MCP server layer in `mcp/`

### Target Codebase Modes

The MCP server must support two deployment modes:

| Mode | Description | Root Resolution |
|------|-------------|-----------------|
| **A: Same-repo** (default) | Sweet Search indexes/searches its own project or the project it's installed in | `process.cwd()` |
| **C: External project** (plugin) | Sweet Search is installed globally or in one repo, but targets a different project (e.g., `../sloth`) | `SWEET_SEARCH_PROJECT_ROOT` env var or `--project-root <path>` CLI flag |

Root selection is resolved **once at server startup**. Per-tool arbitrary path overrides are NOT supported. The resolved root is validated (must exist, must be a directory) and normalized to an absolute path. Non-existent roots produce a clear MCP error at init time.

### Source-of-Truth Policy

For all standards claims in this plan, only primary documentation is authoritative:
- [modelcontextprotocol.io/specification](https://modelcontextprotocol.io/specification/2025-11-25) (spec + changelog)
- [developers.openai.com/codex](https://developers.openai.com/codex/config-reference/) (Codex config reference)
- [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) (Claude Code MCP docs)
- [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) (SDK source)
- [github.com/modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector) (MCP Inspector)

---

## Phase A: File Reorganization

> Phase A is unchanged from v2. All steps (A1–A11) remain valid.

### A1. Create `core/` — move 24 search engine modules

These files all import each other via `./filename.js`. Since they all move together, **their mutual imports don't change**.

```
core/
  config.js
  constants.js
  smart-search-v21.js
  query-router.js
  query-router-catboost.js
  query-router-ml.js
  graph-search.js
  graph-extractor.js
  embedding-service.js
  flashrank.js
  local-reranker.js
  hnsw-index.js
  binary-hnsw-index.js
  colbert-index.js
  mmr.js
  onnx-mutex.js
  incremental-tracker.js
  hcgs-generator.js
  llm-provider.js
  summary-manager.js
  relationship-resolver.js
  intent-detector.js
  vocabulary-utils.js
  index-codebase-v21.js
  artifact-builder.js
```

### A2. Create `scripts/` — move 13 utility/benchmark/diagnostic files

```
scripts/
  benchmark.js
  benchmark-harness.js
  benchmark-model-comparison.js
  benchmark-rerank.js
  diagnose-early-exit.js
  diagnose-flashrank-scores.js
  diagnose-int8.js
  diagnose-score-distribution.js
  test-router-phase1.js
  test-routing-performance.js
  prewarm-vocab.js
  vocabulary-warmup.js
  benchmark-constrained.sh
```

> **v1 fix:** `benchmark-harness.js` belongs in `scripts/`, not `core/`. It imports only Node builtins, not search engine modules. Also `benchmark-constrained.sh` was missing from v1.

### A3. Fix `__dirname`-relative paths in moved core files

Three core files use `__dirname` to resolve paths to sibling directories at root. After moving to `core/`, they need `..` prepended:

| File | Current path | Updated path |
|------|-------------|-------------|
| `core/query-router.js:49` | `join(__dirname, 'wasm-router', 'pkg', ...)` | `join(__dirname, '..', 'wasm-router', 'pkg', ...)` |
| `core/local-reranker.js:25` | `join(__dirname, 'models', 'gte-reranker-int8')` | `join(__dirname, '..', 'models', 'gte-reranker-int8')` |
| `core/config.js:45` | `path.join(__dirname, '.env')` | `path.join(__dirname, '..', '.env')` |

### A4. Fix `__dirname`-relative paths in moved script files

| File | Current path | Updated path |
|------|-------------|-------------|
| `scripts/benchmark-harness.js:55` | `path.join(__dirname, 'index-codebase-v21.js')` | `path.join(__dirname, '..', 'core', 'index-codebase-v21.js')` |
| `scripts/benchmark-harness.js:56` | `path.join(__dirname, 'ss')` | `path.join(__dirname, '..', 'ss')` |
| `scripts/benchmark.js:567` | `__dirname + '/index-codebase-v21.js'` | `join(__dirname, '..', 'core', 'index-codebase-v21.js')` |
| `scripts/benchmark-model-comparison.js:494` | `join(__dirname, 'benchmark-results', ...)` | `join(__dirname, '..', 'benchmark-results', ...)` |
| `scripts/benchmark-rerank.js:252` | same `benchmark-results` pattern | same fix |
| `scripts/benchmark-constrained.sh:30` | `$SCRIPT_DIR/index-codebase-v21.js` | `$SCRIPT_DIR/../core/index-codebase-v21.js` |
| `scripts/benchmark-constrained.sh:31` | `$SCRIPT_DIR/benchmark-harness.js` | stays `$SCRIPT_DIR/benchmark-harness.js` (co-located) |

### A5. Fix cross-directory imports

Files in subdirectories that import root files need path updates:

**`translation/` (4 files):** `../config.js` → `../core/config.js`
- `fallback-pipeline.js`, `llm-translator.js`, `transformers-translator.js`, `translation-cache.js`

**`training/reviewers/`:**
- `llm-labeler.js`: `../../config.js` → `../../core/config.js` AND `../../llm-provider.js` → `../../core/llm-provider.js`
- `ensemble-labeler.js`: `../../config.js` → `../../core/config.js` (does NOT import `llm-provider.js` — v1 was wrong to group them)

**`evaluation/` (4 files):**
- `run-evaluation.js`: `../smart-search-v21.js` → `../core/smart-search-v21.js`
- `benchmark-translation.js`: `../smart-search-v21.js` → `../core/smart-search-v21.js`
- `run-translation-benchmarks.js:792`: `../smart-search-v21.js` → `../core/smart-search-v21.js`
- `run-translation-benchmarks.js:803`: `../config.js` → `../core/config.js`
- `lib/metrics.js:22`: `../../benchmark-harness.js` → `../../scripts/benchmark-harness.js`
- `lib/report-generator.js:15`: `../../benchmark-harness.js` → `../../scripts/benchmark-harness.js`

> **v1 fix:** `run-translation-benchmarks.js` was completely missing from v1 plan.

**`__tests__/` (test files with static imports):**
- `graph-search.test.js` → `../core/graph-search.js`
- `local-reranker.test.js` → `../core/local-reranker.js`
- `schema.test.js` → `../core/graph-extractor.js`
- `backup-restore.test.js` → `../core/summary-manager.js`
- `hcgs-indexer.integration.test.js` → `../core/summary-manager.js`
- `indexing.bench.js` → `../core/graph-extractor.js`, `../core/hcgs-generator.js`, `../core/query-router.js`

**`__tests__/` (test files with `__dirname` paths):**
- `phase1-fixes.test.js:18` → `path.join(__dirname, '..', 'core', 'smart-search-v21.js')`
- `hcgs-defaults.test.js:22` → `join(__dirname, '..', 'core', 'hcgs-generator.js')`
- `full-flag.integration.test.js:24` → `join(__dirname, '..', 'core', 'index-codebase-v21.js')`
- `cli-flags.integration.test.js:27` → `join(__dirname, '..', 'core', 'index-codebase-v21.js')`
- `indexing.bench.js:32` → `join(__dirname, '..', 'core', 'index-codebase-v21.js')`
- `flag-semantics.test.js:23` → `join(__dirname, '..', 'core', 'index-codebase-v21.js')`

**`__tests__/translation/` (nested test):**
- `output-cleaning.test.js:10`: `../../config.js` → `../../core/config.js`

> **v1 fix:** `output-cleaning.test.js` was completely missing from v1 plan. CRITICAL — would have caused a test failure.

**Scripts that moved to `scripts/`:** Their imports change from `./` to `../core/`
- `scripts/benchmark.js`: `./config.js` → `../core/config.js`, etc.
- `scripts/prewarm-vocab.js`: `./embedding-service.js` → `../core/embedding-service.js`
- `scripts/vocabulary-warmup.js`: `./config.js` → `../core/config.js`
- (enumerate remaining scripts during implementation)

### A6. Fix `core/smart-search-v21.js` subdirectory import

One core file imports from a subdirectory:
- `./translation/index.js` → `../translation/index.js`

### A7. Update `ss.sh`

Update the reference to `smart-search-v21.js` → `core/smart-search-v21.js`

### A8. Update `.claude/hooks/index-maintainer.mjs`

Four references to root-level files:

| Line | Current | Updated |
|------|---------|---------|
| `164` | `join(PROJECT_ROOT, 'index-codebase-v21.js')` | `join(PROJECT_ROOT, 'core', 'index-codebase-v21.js')` |
| `948` | `await import('../../incremental-tracker.js')` | `await import('../../core/incremental-tracker.js')` |
| `1074` | `await import('../../config.js')` | `await import('../../core/config.js')` |
| `1117` | `await import('../../config.js')` | `await import('../../core/config.js')` |

> **v1 fix:** v1 said "check if it references root files" with no specifics. These 4 references (3 distinct modules) are all confirmed.

### A9. Update `.claude/helpers/session-preheat.sh`

This file is **performance-critical for Claude Code** (warm startup + daemon lifecycle). It references 8 root-level JS files via an `importFromSearch()` helper that takes relative paths.

**Strategy:** Change `importFromSearch('config.js')` → `importFromSearch('core/config.js')` etc. The `$SEARCH_DIR` variable stays pointing at project root.

Specific changes:

| Line | Current | Updated |
|------|---------|---------|
| `36` | `"$SEARCH_DIR/smart-search-v21.js"` | `"$SEARCH_DIR/core/smart-search-v21.js"` |
| `93` | `node "$SEARCH_DIR/smart-search-v21.js" --serve` | `node "$SEARCH_DIR/core/smart-search-v21.js" --serve` |
| `~200` | `importFromSearch('config.js')` | `importFromSearch('core/config.js')` |
| `~203` | `importFromSearch('hnsw-index.js')` | `importFromSearch('core/hnsw-index.js')` |
| `~214` | re-check config.js ref | `importFromSearch('core/config.js')` |
| `~217` | `importFromSearch('binary-hnsw-index.js')` | `importFromSearch('core/binary-hnsw-index.js')` |
| `~228` | re-check config.js ref | `importFromSearch('core/config.js')` |
| `~243` | re-check config.js ref | `importFromSearch('core/config.js')` |
| `~246` | `importFromSearch('colbert-index.js')` | `importFromSearch('core/colbert-index.js')` |
| `~257` | re-check config.js ref | `importFromSearch('core/config.js')` |
| `~283` | re-check config.js ref | `importFromSearch('core/config.js')` |
| `~299` | `importFromSearch('query-router.js')` | `importFromSearch('core/query-router.js')` |
| `~315` | re-check config.js ref | `importFromSearch('core/config.js')` |
| `~323` | `importFromSearch('local-reranker.js')` | `importFromSearch('core/local-reranker.js')` |

> **v1 fix:** v1 said "check if it references root files" with no details. This is a high-risk area with 14+ path references. Note: Codex does NOT run `.claude/` hooks, so this only matters for Claude Code.

### A10. Update `package.json` paths

```json
{
  "main": "core/smart-search-v21.js",
  "files": [
    "core/",
    "scripts/benchmark-harness.js",
    "translation/",
    "training/features/extractor.js",
    "training/output/",
    "wasm-router/pkg/",
    "ss",
    "LICENSE",
    "NOTICE"
  ],
  "scripts": {
    "search": "node core/smart-search-v21.js",
    "index": "node core/index-codebase-v21.js",
    "index:full": "node core/index-codebase-v21.js --full",
    "hcgs": "node core/hcgs-generator.js generate",
    "warmup": "node scripts/prewarm-vocab.js",
    "benchmark": "node scripts/benchmark.js",
    ... (update all script paths)
  }
}
```

### A11. Run tests to verify

```bash
npm test -- --run
```

---

## Phase B: MCP Server (Protocol Version `2025-11-25`)

### B1. Install dependencies

```bash
npm install @modelcontextprotocol/sdk@^1.26.0 zod@^3.23.0
```

> Note: `zod` is already a transitive dependency of the SDK but is listed as a direct dependency because `mcp/server.js` uses it for tool input schema definitions.

### B2. Create `mcp/server.js` — MCP server entry point

**First line MUST be a shebang** for `npx` executability:
```js
#!/usr/bin/env node
```

**Protocol version:** Server declares `protocolVersion: "2025-11-25"` in its `InitializeResult`.

**Server capabilities declared at init:**

```js
{
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: false, listChanged: true },
    prompts: { listChanged: false }
  }
}
```

#### B2a. ESM-safe stdout protection

Since the project uses `"type": "module"`, static `import` statements are hoisted before any module body code executes. "Override console.log before imports" does NOT work in ESM. Instead, use a **single-file dynamic-import pattern:**

1. `mcp/server.js` overrides `console.log = console.error` as first executable statement (after shebang)
2. ALL application module imports use dynamic `await import()` — no static `import` for search modules
3. SDK imports (`@modelcontextprotocol/sdk`, `zod`) CAN be static since they don't write to stdout

The override MUST happen before any search engine module loads, since those modules call `console.log` at import time.

#### B2b. Project root resolution

Startup resolves the target project root **once**, using this precedence:

1. `--project-root <path>` CLI flag (highest priority)
2. `SWEET_SEARCH_PROJECT_ROOT` environment variable
3. `process.cwd()` (default — same-repo mode)

Validation at startup:
- Resolve to absolute path via `path.resolve()`
- Verify the path exists and is a directory
- If validation fails, log error to stderr and exit with code 1 (before MCP transport starts)
- Pass resolved root to `SmartSearch` constructor and indexer child process

#### B2c. Warm searcher initialization

Use `getWarmSearcher()` singleton from `core/smart-search-v21.js:2155`. Note: the HTTP server (`startServer()` at line 2191) does NOT use this — it instantiates `SmartSearch` directly. The MCP server should use `getWarmSearcher()` for the singleton/caching benefit.

#### B2d. Transport selection

**Default: stdio** (universal baseline for both Claude Code and Codex).

**Optional: Streamable HTTP** via `--transport http --port <port>` flag:
- Single `/mcp` endpoint supporting GET, POST, DELETE per [spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- Session management via `Mcp-Session-Id` header (cryptographically secure UUID)
- SSE streaming for server-to-client messages
- No OAuth/auth in v1 (local-only); document as future work

When running in HTTP mode, stdout protection is not needed (no stdio transport).

#### B2e. Tools (3 tools)

**`search`** (primary tool):
- Params: `query` (string, required), `k` (number, default 10), `mode` (enum: auto/lexical/semantic/hybrid, default auto)
- Wraps `SmartSearch.search(query, { k, mode, expand: true, rerank: true })`
- Returns both `content` (formatted text with file paths, line numbers, scores, signatures) and `structuredContent` (machine-parseable JSON)
- **Annotations:** `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
- **`outputSchema`:** JSON Schema describing the structured result:
  ```json
  {
    "type": "object",
    "properties": {
      "results": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "file": { "type": "string" },
            "line": { "type": "integer" },
            "score": { "type": "number" },
            "snippet": { "type": "string" },
            "signature": { "type": "string" },
            "language": { "type": "string" }
          },
          "required": ["file", "score", "snippet"]
        }
      },
      "totalFound": { "type": "integer" },
      "mode": { "type": "string" },
      "queryTimeMs": { "type": "number" }
    },
    "required": ["results", "totalFound", "mode", "queryTimeMs"]
  }
  ```

**`index`** (secondary tool):
- Params: `mode` (enum: incremental/full, default incremental)
- Runs `core/index-codebase-v21.js` as a **child process** via `spawn()` with `--quiet` flag (not in-process, because the indexer calls `process.exit()` on error and writes to stdout). Route child stdout to stderr.
- **Progress reporting:** Emit MCP progress notifications with `message` field (e.g., "Parsing files... 45/120", "Building HNSW index...") using progress tokens per [spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress).
- **Task support (experimental, optional):** Model `ToolExecution.taskSupport` so clients aware of the 2025-11-25 Tasks primitive can poll for completion. Not required for v1 but the tool should return a task handle if the client advertises task support in its capabilities. Can be upgraded to required later.
- **Annotations:** `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
- **`outputSchema`:**
  ```json
  {
    "type": "object",
    "properties": {
      "success": { "type": "boolean" },
      "filesIndexed": { "type": "integer" },
      "durationMs": { "type": "number" },
      "mode": { "type": "string" },
      "errors": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["success", "mode"]
  }
  ```

**`health`** (diagnostic tool):
- No params
- Returns JSON status of all subsystems (graph index, HNSW, binary HNSW, ColBERT, embedding service, reranker, query router, translation)
- **Annotations:** `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
- **`outputSchema`:**
  ```json
  {
    "type": "object",
    "properties": {
      "healthy": { "type": "boolean" },
      "projectRoot": { "type": "string" },
      "subsystems": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "properties": {
            "status": { "type": "string", "enum": ["ok", "degraded", "error", "not_initialized"] },
            "details": { "type": "string" }
          }
        }
      },
      "indexStats": {
        "type": "object",
        "properties": {
          "totalFiles": { "type": "integer" },
          "lastIndexed": { "type": "string" }
        }
      }
    },
    "required": ["healthy", "projectRoot", "subsystems"]
  }
  ```

#### B2f. Resources (2 resources)

Resources expose read-only data per [spec](https://modelcontextprotocol.io/specification/2025-11-25/server/resources).

**`sweet-search://status`** — Index health and statistics:
- Returns: file count, last index time, subsystem status summary, project root
- MIME type: `application/json`

**`sweet-search://config`** — Current search configuration:
- Returns: active search mode, reranker status, embedding model, supported languages
- MIME type: `application/json`

#### B2g. Prompts (2 prompts)

Prompts are reusable templates per [spec](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts).

**`search-codebase`** — Guided codebase search:
- Arguments: `query` (string, required), `focus` (string, optional — e.g., "functions", "types", "tests")
- Returns a structured message sequence that instructs the LLM to search, then summarize findings with file paths and code snippets

**`explain-code`** — Find and explain code:
- Arguments: `topic` (string, required)
- Returns a message sequence that searches for the topic, then asks the LLM to explain the relevant code with context

### B3. Create `mcp/config-gen.js` — configuration generator

Outputs config snippets for both platforms. Supports two profiles:

#### Profile: `dev-local` (default)
For development in the same repo where Sweet Search lives.

**Claude Code** (`.mcp.json`):
```json
{
  "mcpServers": {
    "sweet-search": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
```

**Codex CLI** (`.codex/config.toml`):
```toml
[mcp_servers.sweet-search]
command = "node"
args = ["./mcp/server.js"]
```

#### Profile: `external-project`
For targeting a different codebase (e.g., `../sloth`).

**Claude Code** (`.mcp.json`):
```json
{
  "mcpServers": {
    "sweet-search": {
      "command": "node",
      "args": ["/absolute/path/to/sweet-search/mcp/server.js", "--project-root", "/absolute/path/to/target-project"],
      "env": {
        "SWEET_SEARCH_PROJECT_ROOT": "/absolute/path/to/target-project"
      }
    }
  }
}
```

**Codex CLI** (`.codex/config.toml`):
```toml
[mcp_servers.sweet-search]
command = "node"
args = ["/absolute/path/to/sweet-search/mcp/server.js"]
cwd = "/absolute/path/to/target-project"
env = { "SWEET_SEARCH_PROJECT_ROOT" = "/absolute/path/to/target-project" }
# enabled = true
# startup_timeout_sec = 15
# tool_timeout_sec = 120
# enabled_tools = ["search", "health"]
# disabled_tools = []
```

#### Profile: `published` (npx)
For users who install Sweet Search from npm.

**Claude Code** (`.mcp.json`):
```json
{
  "mcpServers": {
    "sweet-search": {
      "command": "npx",
      "args": ["-y", "sweet-search-mcp"]
    }
  }
}
```

**Codex CLI** (`.codex/config.toml`):
```toml
[mcp_servers.sweet-search]
command = "npx"
args = ["-y", "sweet-search-mcp"]
# env = { "SWEET_SEARCH_PROJECT_ROOT" = "/path/to/project" }
# enabled = true
# startup_timeout_sec = 15
# tool_timeout_sec = 120
```

Usage: `node mcp/config-gen.js [claude|codex] [--profile dev-local|external-project|published]`

### B4. Update `package.json` for MCP

```json
{
  "bin": {
    "ss": "./ss",
    "sweet-search-mcp": "./mcp/server.js"
  },
  "files": [
    "core/",
    "mcp/",
    "scripts/benchmark-harness.js",
    "translation/",
    "training/features/extractor.js",
    "training/output/",
    "wasm-router/pkg/",
    "ss",
    "LICENSE",
    "NOTICE"
  ],
  "scripts": {
    "mcp": "node mcp/server.js",
    "mcp:http": "node mcp/server.js --transport http --port 3100",
    ... (existing scripts with updated paths from A10)
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "zod": "^3.23.0",
    ...existing
  }
}
```

### B5. Update `.mcp.json` (project development config)

This is the project's OWN `.mcp.json` for development. Separate from the published user config templates in B3.

```json
{
  "mcpServers": {
    "agentic-qe": { ...existing... },
    "sweet-search": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
```

### B6. Verification — Contract Test Matrix

> **v2 → v3 upgrade:** Expanded from manual smoke tests to a structured contract test matrix. `--mcp-debug` is listed as optional troubleshooting guidance, not a hard verification requirement.

#### B6a. Protocol compliance tests

| # | Test | Method | Expected |
|---|------|--------|----------|
| 1 | Initialize handshake | `initialize` with `protocolVersion: "2025-11-25"` | Returns `protocolVersion`, `capabilities` (tools, resources, prompts), `serverInfo` |
| 2 | Tool listing | `tools/list` | Returns 3 tools: `search`, `index`, `health` — each with `inputSchema`, `annotations`, `outputSchema` |
| 3 | Resource listing | `resources/list` | Returns 2 resources: `sweet-search://status`, `sweet-search://config` |
| 4 | Resource read | `resources/read` with `uri: "sweet-search://status"` | Returns valid JSON with `healthy`, `projectRoot`, `subsystems` |
| 5 | Prompt listing | `prompts/list` | Returns 2 prompts: `search-codebase`, `explain-code` with argument schemas |
| 6 | Prompt get | `prompts/get` with `name: "search-codebase"` and `arguments: { query: "test" }` | Returns `messages` array with user/assistant roles |
| 7 | Search invocation | `tools/call` with `name: "search"` | Returns `content` (text) + `structuredContent` matching `outputSchema` |
| 8 | Index invocation | `tools/call` with `name: "index"` | Returns success status; progress notifications emitted during run |
| 9 | Health invocation | `tools/call` with `name: "health"` | Returns `structuredContent` matching health `outputSchema` |

#### B6b. Structured output validation

| # | Test | Expected |
|---|------|----------|
| 10 | `search` outputSchema conformance | `structuredContent` validates against declared `outputSchema` (use `ajv` or `zod`) |
| 11 | `health` outputSchema conformance | Same — `structuredContent` matches schema |
| 12 | `index` outputSchema conformance | Same — `structuredContent` matches schema |

#### B6c. Transport & stdout hygiene

| # | Test | Expected |
|---|------|----------|
| 13 | No stdout leakage (stdio) | Spawn `node mcp/server.js`, send init + tools/call. Assert stdout contains ONLY valid JSON-RPC lines. All logs on stderr. |
| 14 | Streamable HTTP init (optional) | `node mcp/server.js --transport http --port 3100` starts and responds to POST `/mcp` with initialize |

#### B6d. Sloth compatibility (external project targeting)

| # | Test | Expected |
|---|------|----------|
| 15 | Start with `--project-root ../sloth` | Server initializes, `health` tool returns `projectRoot` pointing at sloth |
| 16 | Index sloth | `index` tool completes, indexes files under `../sloth` |
| 17 | Search sloth | `search` tool returns results with file paths that resolve under `../sloth` |
| 18 | Artifact cleanup | Generated index artifacts (`.sweet-search/`, `.agentdb/`) are created under `../sloth`, not under sweet-search root. Document cleanup expectations. (Alternative: use a disposable sloth worktree.) |

#### B6e. Existing functionality regression

| # | Test | Expected |
|---|------|----------|
| 19 | `npm test -- --run` | All existing unit/integration tests pass |
| 20 | HTTP server | `node core/smart-search-v21.js --serve` starts on expected port |
| 21 | CLI | `./ss.sh "test query"` returns results |

#### B6f. Integration tests (manual, not gated)

| # | Test | Expected |
|---|------|----------|
| 22 | Claude Code integration | Add to `.mcp.json`, start session, invoke search tool | Tool appears and works |
| 23 | Codex integration | Add to `.codex/config.toml`, invoke search tool | Tool appears and works |
| 24 | MCP Inspector | `npx @modelcontextprotocol/inspector node mcp/server.js` — interactive tool testing works |

> **Troubleshooting tip:** Claude Code's `--mcp-debug` flag enables detailed MCP communication logging. Use when investigating connection or protocol issues.

---

## Files Summary

| File | Action | Phase |
|------|--------|-------|
| `core/` (25 files) | MOVE from root | A1 |
| `scripts/` (13 files, incl. benchmark-constrained.sh) | MOVE from root | A2 |
| `core/query-router.js` | FIX `__dirname` path | A3 |
| `core/local-reranker.js` | FIX `__dirname` path | A3 |
| `core/config.js` | FIX `__dirname` path | A3 |
| `scripts/benchmark-harness.js` | FIX `__dirname` paths (2) | A4 |
| `scripts/benchmark.js` | FIX `__dirname` path | A4 |
| `scripts/benchmark-model-comparison.js` | FIX `__dirname` path | A4 |
| `scripts/benchmark-rerank.js` | FIX `__dirname` path | A4 |
| `scripts/benchmark-constrained.sh` | FIX `$SCRIPT_DIR` path | A4 |
| `core/smart-search-v21.js` | FIX translation import | A6 |
| `translation/*.js` (4 files) | FIX imports | A5 |
| `training/reviewers/llm-labeler.js` | FIX 2 imports (config + llm-provider) | A5 |
| `training/reviewers/ensemble-labeler.js` | FIX 1 import (config only) | A5 |
| `evaluation/run-evaluation.js` | FIX import | A5 |
| `evaluation/benchmark-translation.js` | FIX import | A5 |
| `evaluation/run-translation-benchmarks.js` | FIX 2 imports (smart-search + config) | A5 |
| `evaluation/lib/metrics.js` | FIX import (benchmark-harness → scripts/) | A5 |
| `evaluation/lib/report-generator.js` | FIX import (benchmark-harness → scripts/) | A5 |
| `__tests__/` (6 test files + __dirname tests) | FIX imports | A5 |
| `__tests__/translation/output-cleaning.test.js` | FIX import (`../../config.js`) | A5 |
| `scripts/*.js` (moved files) | FIX imports (`./` → `../core/`) | A5 |
| `ss.sh` | FIX path | A7 |
| `.claude/hooks/index-maintainer.mjs` | FIX 4 path references | A8 |
| `.claude/helpers/session-preheat.sh` | FIX 14+ path references | A9 |
| `package.json` | UPDATE paths + deps + bin | A10, B4 |
| `mcp/server.js` | CREATE (ESM-safe, shebang, 2025-11-25) | B2 |
| `mcp/config-gen.js` | CREATE (3 profiles) | B3 |
| `.mcp.json` | ADD sweet-search entry | B5 |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Broken imports after move | All core files move together (mutual imports unchanged). Cross-dir imports are mechanical `../` → `../core/` changes. **Exhaustive file list** (not "3+ files"). Run `npm test -- --run` after. |
| `__dirname` path breakage | 3 core files + 4 script files need `..` insertion. Each explicitly listed with line numbers. |
| `console.log` corrupts MCP stdio | **ESM-safe:** bootstrap overrides `console.log` then uses dynamic `import()` for all search modules. No static imports of search code. SDK imports can be static (they don't write to stdout). |
| `process.exit()` in indexer kills MCP | Run indexer as child process with `--quiet`; route child stdout → stderr. |
| Cold start latency | `getWarmSearcher()` caches (note: HTTP server does NOT use this, MCP server will). |
| session-preheat.sh breakage | 14+ paths explicitly enumerated. Claude-only concern (Codex ignores `.claude/` hooks). |
| index-maintainer.mjs breakage | 4 references explicitly enumerated with line numbers. |
| Codex compatibility | Use stdio (universal baseline). Don't hardcode timeouts — let Codex use its defaults (10s startup, 60s tool). |
| External project root resolution | Validated once at startup. Non-existent roots fail fast with clear error before MCP transport starts. |
| Index artifacts in wrong directory | Indexer child process receives `--root <resolved_path>`; artifacts are written under the target project, not the sweet-search installation. |
| `outputSchema` conformance drift | Contract tests (B6b) validate structured output against declared schemas on every test run. |
| Streamable HTTP security | HTTP transport is local-only in v1 (no auth). Document OAuth as future work per [MCP auth spec](https://modelcontextprotocol.io/docs/tutorials/security/authorization). |

---

## Verification Summary

1. `npm test -- --run` — all existing tests pass after reorganization
2. `node core/smart-search-v21.js --serve` — HTTP server still works
3. `./ss.sh "test query"` — CLI still works
4. MCP initialize handshake (protocol `2025-11-25`) — capabilities include tools, resources, prompts
5. `tools/list` — 3 tools with annotations + outputSchema
6. `resources/list` + `resources/read` — 2 resources return valid JSON
7. `prompts/list` + `prompts/get` — 2 prompts with argument schemas
8. `tools/call` search — returns `content` + `structuredContent` matching schema
9. `tools/call` index — returns success; progress notifications during run
10. No stdout leakage — only JSON-RPC on stdout
11. External project targeting — index + search `../sloth` with correct paths
12. `outputSchema` conformance — structured output validates against declared schemas
13. MCP Inspector — `npx @modelcontextprotocol/inspector node mcp/server.js` works
14. Configure in `.mcp.json`, use from Claude Code session
15. Configure in `.codex/config.toml`, use from Codex session (if available)

---

## Changelog from v2

| # | Issue | Fix |
|---|-------|-----|
| 1 | Protocol version `2024-11-05` (obsolete) | Updated to `2025-11-25` (latest stable, Nov 2025). Three spec revisions shipped since v2's target. |
| 2 | No tool annotations | Added `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` to all 3 tools per 2025-03-26 spec. |
| 3 | No `outputSchema` / structured output | Added `outputSchema` + `structuredContent` to all 3 tools per 2025-06-18 spec. |
| 4 | No Resources or Prompts | Added 2 Resources (`status`, `config`) and 2 Prompts (`search-codebase`, `explain-code`) — full MCP primitive coverage. |
| 5 | Missing shebang `#!/usr/bin/env node` | Added to `mcp/server.js` — required for `npx` executability. |
| 6 | stdio only, no Streamable HTTP option | Added optional `--transport http` flag for local Streamable HTTP per 2025-03-26 spec. Default remains stdio. |
| 7 | No project root selection | Added `SWEET_SEARCH_PROJECT_ROOT` env var + `--project-root` flag, resolved once at startup with validation. |
| 8 | No external-project (plugin mode) support | Added Mode A (same-repo) and Mode C (external project) with explicit config profiles. |
| 9 | No sloth compatibility testing | Added B6d section: start targeting `../sloth`, index, search, verify file paths resolve under sloth. |
| 10 | B6 was manual smoke tests only | Expanded to full contract test matrix: protocol compliance (B6a), structured output validation (B6b), transport hygiene (B6c), sloth compat (B6d), regression (B6e), integration (B6f). |
| 11 | No progress reporting for index | Added MCP progress notifications with `message` field during indexing. |
| 12 | No task support for long-running index | Added experimental 2025-11-25 Tasks primitive support for `index` tool (optional, upgradeable). |
| 13 | Codex config too minimal | Config-gen now produces full Codex fields: `enabled`, `env`, `env_vars`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled_tools`, `disabled_tools` (commented out as examples). |
| 14 | No separation of dev vs published config | Config-gen now supports 3 profiles: `dev-local`, `external-project`, `published`. |
| 15 | No MCP Inspector testing | Added to B6f: `npx @modelcontextprotocol/inspector node mcp/server.js`. |
| 16 | `--mcp-debug` listed as hard requirement | Downgraded to optional troubleshooting guidance — not always available by version. |
| 17 | No source-of-truth policy | Added policy: only primary docs (modelcontextprotocol.io, Codex config reference, Claude Code MCP docs) are authoritative. |
| 18 | Index artifacts may land in wrong directory | Documented: indexer child process receives `--root <resolved_path>`, artifacts go under target project. |

---

## Changelog from v1

| # | Issue | Fix |
|---|-------|-----|
| 1 | `benchmark-harness.js` listed in both `core/` and `scripts/` | Moved to `scripts/` only; `__dirname` fixes listed in A4 |
| 2 | `evaluation/run-translation-benchmarks.js` missing | Added to A5 with both imports |
| 3 | `__tests__/translation/output-cleaning.test.js` missing | Added to A5 |
| 4 | `benchmark-constrained.sh` missing | Added to A2 (move) and A4 (path fix) |
| 5 | `.claude/hooks/index-maintainer.mjs` — "check" with no details | 4 references enumerated with line numbers (A8) |
| 6 | `.claude/helpers/session-preheat.sh` — "check" with no details | 14+ references enumerated (A9) |
| 7 | ESM `console.log` override impossible with static imports | Two-file bootstrap or dynamic-import-only pattern (B2a) |
| 8 | "same warm cache pattern used by HTTP server" — incorrect | Corrected: HTTP server instantiates directly; MCP should use `getWarmSearcher()` (B2c) |
| 9 | B3 Claude Code snippet missing `mcpServers` wrapper | Fixed |
| 10 | Codex hardcoded timeouts 30/120 without rationale | Removed; let Codex use defaults |
| 11 | `ensemble-labeler.js` grouped with `llm-labeler.js` incorrectly | Separated: ensemble-labeler only imports config, not llm-provider |
| 12 | Verification was `tools/list` only | Full contract test matrix with 24 test scenarios across 6 categories |
