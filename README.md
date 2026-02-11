# Sweet Search

State-of-the-art hybrid code search engine with semantic, lexical, and structural search capabilities.

## Features

- **Hybrid Search**: Combines semantic embeddings, lexical BM25, and structural code graph search
- **Intelligent Query Routing**: WASM CatBoost model automatically selects optimal search strategy
- **Tiered Embedding Providers**: Voyage Code 3, Mistral Codestral, Jina v3, local Xenova fallback
- **High-Performance Indexing**: HNSW ANN index with 3-stage retrieval (binary + float + reranking)
- **Advanced Reranking**: FlashRank and ModernBERT cascade with ColBERT late interaction
- **Code Intelligence**: Entity extraction, relationship mapping, FTS5 full-text search
- **Hierarchical Summaries**: HCGS for multi-level code understanding
- **Multilingual Support**: Language detection with translation fallback
- **MCP Integration**: Model Context Protocol server for Claude Code and Codex
- **Background Server**: Auto-warm daemon for sub-10ms lexical search

## Installation

```bash
npm install sweet-search
```

## Quick Start

### Indexing

```javascript
const { SweetSearch } = require('sweet-search');

const search = new SweetSearch('/path/to/project');
await search.initialize();

// Index the entire project
await search.indexCodebase('/path/to/project');
```

### Searching

```javascript
// Semantic search
const results = await search.search('authentication middleware', {
  limit: 10,
  mode: 'semantic'
});

// Hybrid search (automatic query routing)
const results = await search.search('user login function', {
  limit: 10,
  mode: 'hybrid'
});

// Lexical search
const results = await search.search('class UserService', {
  limit: 10,
  mode: 'lexical'
});
```

## CLI (Fast Native Client)

The `ss` command is a compiled C binary (~19KB) that queries the warm search server
via Unix socket for sub-millisecond search invocations:

```bash
# Start the warm server (auto-starts on first search, or manually):
npm run search -- --server

# Search from the command line:
ss "authentication middleware" -k 10
ss "class UserService" -m lexical -k 5
ss "how does caching work" -s        # summary mode
```

The `ss` binary requires a running warm server. It connects via `/tmp/sweet-search.sock`
(with fallback to TCP port 9876). Linux and macOS only.

## MCP Server Setup

Sweet Search includes a Model Context Protocol (MCP) server for integration with Claude Code, Codex, and other MCP-compatible tools.

### Quick Setup

Add to your `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "sweet-search": {
      "command": "npx",
      "args": ["sweet-search-mcp", "--project-root", "/absolute/path/to/project"]
    }
  }
}
```

Or if installed locally:

```json
{
  "mcpServers": {
    "sweet-search": {
      "command": "node",
      "args": ["node_modules/sweet-search/mcp/server.js", "--project-root", "/absolute/path/to/project"]
    }
  }
}
```

### Available MCP Tools

- `mcp__sweet-search__search` - Search codebase with hybrid/semantic/lexical modes
- `mcp__sweet-search__index` - Index files or directories
- `mcp__sweet-search__health` - Check search engine status

### Available MCP Resources

- `sweet-search://status` - Current index statistics and configuration
- `sweet-search://config` - Search engine configuration details

### Available MCP Prompts

- `search-codebase` - Interactive codebase search with context
- `explain-code` - Find and explain code patterns

For detailed MCP setup instructions, see [docs/MCP_SETUP.md](docs/MCP_SETUP.md).

## Configuration

Sweet Search uses `.sweet-search/` directory for data storage (configurable via `SWEET_SEARCH_DATA_DIR`).

Project-specific configuration can be set in `.sweet-search.config.json`:

```json
{
  "include": ["**/*.{js,ts,py,go,rs,java}"],
  "exclude": ["vendor/**", "generated/**"]
}
```

## Requirements

- Node.js >= 18.0.0
- Sufficient disk space for index storage (typically 10-50MB per 1000 files)

## Documentation

- [MCP Setup Guide](docs/MCP_SETUP.md)
- [API Reference](docs/API.md)
- [Architecture Overview](docs/ARCHITECTURE.md)

## License

Apache-2.0

## Author

Marko Sladojevic (PanonIT)

## Repository

https://github.com/panonitorg/sweet-search
