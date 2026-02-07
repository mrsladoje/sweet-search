# Plan v2: Reorganize Sweet Search + Add MCP Server (Claude Code + Codex)

## Context

Sweet Search is a hybrid code search engine with 40+ JS files dumped in the root directory. It integrates with Claude Code via hooks/HTTP server but is **not** an MCP server. To support both Claude Code and Codex CLI, it needs to become an MCP server (the universal plugin protocol both support via stdio transport). The user also wants the root cleaned up.

**Project is ESM** (`"type": "module"` in package.json) — all `.js` files use ES module syntax.

**Two goals in one PR:**
1. Reorganize root files into `core/` and `scripts/`
2. Add MCP server layer in `mcp/`

---

## Phase A: File Reorganization

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
npm test
```

---

## Phase B: MCP Server

### B1. Install dependencies

```bash
npm install @modelcontextprotocol/sdk@^1.26.0 zod@^3.23.0
```

### B2. Create `mcp/server.js`

Entry point for MCP stdio transport. Key design:

- **ESM-safe stdout protection:** Since the project uses `"type": "module"`, static `import` statements are hoisted before any module body code executes. "Override console.log before imports" does NOT work in ESM. Instead, use a **two-file bootstrap pattern:**
  1. `mcp/server.js` (entry point): overrides `console.log = console.error`, then uses dynamic `await import()` for all application modules.
  2. OR use a single file with ONLY dynamic imports (no static `import` for search modules).

  The override MUST happen before any search engine module loads, since those modules call `console.log` at import time.

- **Use `getWarmSearcher()` singleton** from `core/smart-search-v21.js:2155`. Note: the HTTP server (`startServer()` at line 2191) does NOT use this — it instantiates `SmartSearch` directly. The MCP server should use `getWarmSearcher()` for the singleton/caching benefit.

- **Three tools:**

**`search`** (primary tool):
- Params: `query` (string), `k` (number, default 10), `mode` (auto/lexical/semantic/hybrid, default auto)
- Wraps `SmartSearch.search(query, { k, mode, expand: true, rerank: true })`
- Returns formatted text with file paths, line numbers, scores, signatures

**`index`** (secondary tool):
- Params: `mode` (incremental/full, default incremental)
- Runs `core/index-codebase-v21.js` as a **child process** via `spawn()` with `--quiet` flag (not in-process, because the indexer calls `process.exit()` on error and writes to stdout). Route child stdout to stderr.

**`health`** (diagnostic tool):
- No params
- Returns JSON status of all subsystems (graph index, HNSW, binary HNSW, ColBERT, etc.)

### B3. Create `mcp/config-gen.js`

Outputs config snippets for both platforms:

**Claude Code** (`.mcp.json`) — note the `mcpServers` wrapper:
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

> **v1 fix:** v1 omitted the `mcpServers` wrapper in the Claude Code snippet.

**Codex CLI** (`~/.codex/config.toml` or `.codex/config.toml`):
```toml
[mcp_servers.sweet-search]
command = "npx"
args = ["-y", "sweet-search-mcp"]
```

> **v1 fix:** Removed hardcoded `startup_timeout_sec = 30` and `tool_timeout_sec = 120`. Codex defaults are 10/60; users can override if needed. Codex also supports `streamable-http` transport but stdio is the universal baseline — works for both Claude Code and Codex.

Usage: `node mcp/config-gen.js claude` or `node mcp/config-gen.js codex`

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
    ...
  ],
  "scripts": {
    "mcp": "node mcp/server.js",
    ...
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "zod": "^3.23.0",
    ...existing
  }
}
```

### B5. Update `.mcp.json`

Add sweet-search alongside existing claude-flow:
```json
{
  "mcpServers": {
    "claude-flow": { ...existing... },
    "sweet-search": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
```

### B6. Test MCP server — validation matrix

| # | Test | Command | Expected |
|---|------|---------|----------|
| 1 | Initialize handshake | `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \| node mcp/server.js` | Returns capabilities + server info |
| 2 | Tool listing | Send `tools/list` after init | Returns 3 tools: search, index, health |
| 3 | No stdout leakage | `node -e "const {stdout,stderr} = require('child_process').spawnSync('node',['mcp/server.js'],{input:'...',encoding:'utf8'}); assert(JSON.parse(stdout))"` | stdout is only valid JSON-RPC, all logs on stderr |
| 4 | Search invocation | Send `tools/call` with search tool | Returns search results |
| 5 | npm test | `npm test` | All existing tests pass |
| 6 | HTTP server | `node core/smart-search-v21.js --serve` | HTTP server starts on expected port |
| 7 | CLI | `./ss.sh "test query"` | Returns results |
| 8 | Claude Code integration | Add to `.mcp.json`, start session, invoke search | Tool appears and works |
| 9 | Codex integration (if available) | Add to `.codex/config.toml`, invoke | Tool appears and works |

> **v1 fix:** v1 only tested `tools/list` directly without initialize handshake. Added full validation matrix.

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
| `mcp/server.js` | CREATE (ESM-safe bootstrap) | B2 |
| `mcp/config-gen.js` | CREATE | B3 |
| `.mcp.json` | ADD sweet-search entry | B5 |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Broken imports after move | All core files move together (mutual imports unchanged). Cross-dir imports are mechanical `../` → `../core/` changes. **Exhaustive file list** (not "3+ files"). Run `npm test` after. |
| `__dirname` path breakage | 3 core files + 4 script files need `..` insertion. Each explicitly listed with line numbers. |
| `console.log` corrupts MCP stdio | **ESM-safe:** bootstrap file overrides `console.log` then uses dynamic `import()` for all search modules. No static imports of search code. |
| `process.exit()` in indexer kills MCP | Run indexer as child process with `--quiet`; route child stdout → stderr |
| Cold start latency | `getWarmSearcher()` caches (note: HTTP server does NOT use this, MCP server will) |
| session-preheat.sh breakage | 14+ paths explicitly enumerated. Claude-only concern (Codex ignores `.claude/` hooks). |
| index-maintainer.mjs breakage | 4 references explicitly enumerated with line numbers. |
| Codex compatibility | Use stdio (universal baseline). Don't hardcode timeouts — let Codex use its defaults (10s startup, 60s tool). |

## Verification

Full validation matrix in B6 above. Summary:

1. `npm test` — all existing tests pass after reorganization
2. `node core/smart-search-v21.js --serve` — HTTP server still works
3. `./ss.sh "test query"` — CLI still works
4. MCP initialize handshake + tools/list — protocol compliance
5. MCP search tool invocation — end-to-end search works
6. No stdout leakage — only JSON-RPC on stdout
7. Configure in `.mcp.json`, use from Claude Code session
8. Configure in `.codex/config.toml`, use from Codex session (if available)

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
| 7 | ESM `console.log` override impossible with static imports | Two-file bootstrap or dynamic-import-only pattern (B2) |
| 8 | "same warm cache pattern used by HTTP server" — incorrect | Corrected: HTTP server instantiates directly; MCP should use `getWarmSearcher()` |
| 9 | B3 Claude Code snippet missing `mcpServers` wrapper | Fixed |
| 10 | Codex hardcoded timeouts 30/120 without rationale | Removed; let Codex use defaults |
| 11 | `ensemble-labeler.js` grouped with `llm-labeler.js` incorrectly | Separated: ensemble-labeler only imports config, not llm-provider |
| 12 | Verification was `tools/list` only | Full validation matrix with initialize handshake + 9 test scenarios |
