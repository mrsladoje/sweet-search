# MCP Setup Guide

Sweet Search includes a Model Context Protocol (MCP) server for integration
with Claude Code, Codex, and other MCP-compatible tools.

## Prerequisites

- Node.js >= 18.0.0
- Sweet Search installed (`npm install sweet-search`)

## Claude Code Setup

The fastest path is `sweet-search init --mcp`, which writes the entry below into
`.mcp.json` for you (idempotently, preserving any other servers).

To do it by hand, edit `.mcp.json` at your project root — the project-scoped MCP
config Claude Code reads (create it if needed):

```json
{
  "mcpServers": {
    "sweet-search": {
      "command": "npx",
      "args": ["-y", "sweet-search-mcp", "--project-root", "/absolute/path/to/project"]
    }
  }
}
```

Or with a local installation:

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

Restart Claude Code, then verify with `/mcp list`.

## Codex Setup

Add the same `mcpServers` block to your Codex MCP configuration file.
Restart Codex to apply.

## MCP Tools

### search

Hybrid semantic/lexical/structural code search.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string (1-1000) | required | Search query |
| `k` | integer (1-200) | 10 | Number of results |
| `mode` | enum | `auto` | `auto`, `lexical`, `semantic`, `hybrid` |

### index

Index or re-index the codebase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | enum | `incremental` | `incremental` or `full` |

Includes a 5-minute timeout. Progress reported via MCP notifications.

### health

Check status of all search subsystems. No parameters.

## MCP Resources

| URI | Description |
|-----|-------------|
| `sweet-search://status` | Index health and statistics (JSON) |
| `sweet-search://config` | Current search configuration (JSON) |

## MCP Prompts

| Name | Description |
|------|-------------|
| `search-codebase` | Guided codebase search with focused results |
| `explain-code` | Find and explain code related to a topic |

## Configuration

The `--project-root` argument must be an absolute path. It determines where
the `.sweet-search/` data directory is created.

Environment variables:
- `SWEET_SEARCH_DATA_DIR` -- override data directory name (default: `.sweet-search`)
- `SWEET_SEARCH_PROJECT_ROOT` -- alternative to `--project-root` flag

## Troubleshooting

**Server not starting**: Check `node --version` >= 18, verify `npx sweet-search-mcp`
resolves, ensure project root exists and is absolute.

**No search results**: Run the `index` tool first. Check `health` tool for
subsystem status.

**Performance**: The background warm server auto-starts on first search.
Subsequent lexical queries run in < 10ms.

## Support

- Issues: https://github.com/mrsladoje/sweet-search/issues
- Docs: https://github.com/mrsladoje/sweet-search/tree/main/docs
