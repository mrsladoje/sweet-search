# Sweet Search MCP Integration (Executed)

This document captures the MCP integration that is currently implemented in this repository.
It replaces the previous planning document and reflects the code as it exists now.

## Implemented Components

- MCP server entrypoint: `mcp/server.js`
- MCP config generator: `mcp/config-gen.js`
- MCP contract tests: `__tests__/mcp-server.test.js`
- Package/bin wiring: `package.json`
- Local dev MCP registration: `.mcp.json`

## Runtime Behavior

### Transport

- Implemented transport: **stdio** (`StdioServerTransport`)
- HTTP/streamable transport is **not implemented** (only a TODO comment exists in `mcp/server.js`)

### Stdout safety

`mcp/server.js` re-routes `console.log` to `console.error` before loading search modules so stdio JSON-RPC output is not corrupted.

### Project root resolution

Resolved once at startup with this precedence:

1. `--project-root <path>`
2. `SWEET_SEARCH_PROJECT_ROOT`
3. `process.cwd()`

Behavior:

- Path is normalized with `path.resolve(...)`
- Server exits with code `1` if path does not exist or is not a directory
- Resolved root is written back to `process.env.SWEET_SEARCH_PROJECT_ROOT` so `core/config.js` uses the same root

### Searcher lifecycle

- Search engine is lazy-loaded via dynamic import from `core/sweet-search.js`
- Singleton warm searcher is obtained with `getWarmSearcher({ verbose: false })`

## MCP Server Surface

### Capabilities declared

The server is created with:

- `tools: { listChanged: false }`
- `resources: { subscribe: false, listChanged: false }`
- `prompts: { listChanged: false }`

Server info:

- `name: "sweet-search"`
- `version: "2.3.0"`

Note: `protocolVersion` is negotiated/returned by the MCP SDK at initialization; it is not hardcoded in this file.

## Implemented Tools

### 1) `search`

Input schema:

- `query: string` (required)
- `k: number` (default `10`)
- `mode: "auto" | "lexical" | "semantic" | "hybrid"` (default `"auto"`)

Execution:

- Calls `searcher.search(query, { k, mode, expand: true, rerank: true })`
- Returns `content` (human-readable text) and `structuredContent`

Structured output shape:

- `results[]` with `file`, `line?`, `score`, `snippet`, `signature?`, `language?`
- `totalFound`
- `mode`
- `queryTimeMs`

Annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

### 2) `index`

Input schema:

- `mode: "incremental" | "full"` (default `"incremental"`)

Execution:

- Spawns `node core/index-codebase-v21.js --quiet`
- Adds `--full` for `mode: "full"`
- Child runs with `cwd = PROJECT_ROOT`
- Passes `SWEET_SEARCH_PROJECT_ROOT=PROJECT_ROOT` in child env

Progress and output:

- Indexer stderr is logged to MCP server stderr (`[sweet-search-mcp] index: ...`)
- No `notifications/progress` messages are emitted by the current implementation
- Returns `structuredContent`:
  - `success`
  - `filesIndexed?` (regex extracted from output)
  - `durationMs`
  - `mode`
  - `errors[]`
- Sets `isError: true` on failure

Annotations:

- `readOnlyHint: false`
- `destructiveHint: false`
- `idempotentHint: false`
- `openWorldHint: false`

### 3) `health`

Input schema:

- No input parameters

Checks:

- `graph-index`
- `hnsw`
- `binary-hnsw`
- `colbert`
- `embedding-service`
- `reranker`
- `query-router`
- `translation`

Output:

- `healthy`
- `projectRoot`
- `subsystems` (`ok | degraded | error | not_initialized` in schema)
- `indexStats` (`totalFiles?`, `lastIndexed?`)

Notes:

- Current implementation can emit `ok`, `not_initialized`, and `error`
- `degraded` exists in schema but is not currently emitted by logic
- `indexStats.totalFiles` is filled by querying `entities` count in `code-graph.db` when available
- `indexStats.lastIndexed` is defined in schema but not currently populated

Annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

## Implemented Resources

### `sweet-search://status`

- MIME type: `application/json`
- Returns JSON from the same shared `checkHealth()` path used by the `health` tool

### `sweet-search://config`

- MIME type: `application/json`
- Returns:
  - `searchMode: "auto"`
  - `reranker.flashrank: true`
  - `reranker.localReranker` from `config.shouldUseLocalReranker?.()`
  - `embeddingModel` from `config.EMBEDDING_CONFIG?.model`
  - `supportedLanguages: ["en", "de", "fr", "es", "pl", "ja", "ko", "zh", "ru"]`
  - `projectRoot`
- Returns `{ error: <message> }` if config loading fails

## Implemented Prompts

### `search-codebase`

Arguments:

- `query` (required)
- `focus` (optional)

Behavior:

- Returns one user message instructing the client to run search and summarize with file paths/snippets

### `explain-code`

Arguments:

- `topic` (required)

Behavior:

- Returns one user message instructing the client to find and explain topic-related code

## Configuration Generation (`mcp/config-gen.js`)

Supported platforms:

- `claude`
- `codex`

Supported profiles:

- `dev-local`
- `external-project`
- `published`

Command:

```bash
node mcp/config-gen.js [claude|codex] [--profile dev-local|external-project|published] [--target <path>]
```

Profile behavior:

- `dev-local`: runs `node ./mcp/server.js`
- `external-project`: points at server path and target project root (`--project-root` for Claude output; `cwd` + env for Codex output)
- `published`: runs `npx -y sweet-search-mcp`

## Package and Local Config Wiring

### `package.json`

- `bin.sweet-search-mcp = "./mcp/server.js"`
- `scripts.mcp = "node mcp/server.js"`
- `files` includes `mcp/`
- Dependencies include `@modelcontextprotocol/sdk` and `zod`

### `.mcp.json`

Project-local MCP registration includes:

- `sweet-search` server using `node` with `args: ["./mcp/server.js"]`

## Test Coverage for MCP Integration

`__tests__/mcp-server.test.js` verifies:

- MCP initialize handshake works
- Tools list contains exactly `search`, `index`, `health`
- Tool annotations and `outputSchema` exist
- Resources list contains `sweet-search://status` and `sweet-search://config`
- Prompts list contains `search-codebase` and `explain-code`
- Stdout hygiene: stdout lines are valid JSON-RPC only

## Current Limitations (Code-Accurate)

- No streamable HTTP transport path is implemented
- No explicit MCP Tasks primitive integration is implemented for long-running `index`
- `indexStats.lastIndexed` is not currently populated
