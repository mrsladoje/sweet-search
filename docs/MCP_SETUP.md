# MCP Setup Guide

Sweet Search includes a Model Context Protocol (MCP) server for integration
with Claude Code, Codex, and other MCP-compatible tools.

## Prerequisites

- Node.js >= 22.0.0
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
      "command": "sweet-search-mcp",
      "args": []
    }
  }
}
```

`sweet-search-mcp` is a command the install puts on your PATH (a project install:
`sweet-search init` copies it into `~/.local/bin`). It runs the server with the Node.js
that installed sweet-search, so the MCP host needs no `node` or `npx` on its PATH.
A host started outside a shell (a macOS app opened from the Dock) does not get your
shell's PATH: give it the absolute path that `command -v sweet-search-mcp` prints.

Restart Claude Code, then verify with `/mcp list`.

## Codex Setup

Add the server to `.codex/config.toml` (project) or `~/.codex/config.toml`:

```toml
[mcp_servers.sweet-search]
command = "sweet-search-mcp"
```

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

The server serves the nearest ancestor of its working directory that holds a
`.sweet-search/` index (the same rule as the `ss-*` tools), else the working
directory. MCP hosts start the server in the project, so the config needs no path.
To pin a project anyway, pass `--project-root /absolute/path/to/project`.

Environment variables:
- `SWEET_SEARCH_DATA_DIR` -- override data directory name (default: `.sweet-search`)
- `SWEET_SEARCH_PROJECT_ROOT` -- alternative to `--project-root` flag

## Troubleshooting

**Server not starting**: verify `command -v sweet-search-mcp` finds the command (re-run
`sweet-search init` if not). The server logs its project root to stderr at startup.

**No search results**: Run the `index` tool first. Check `health` tool for
subsystem status.

**Performance**: The background warm server auto-starts on first search.
Subsequent lexical queries run in < 10ms.

## Support

- Issues: https://github.com/mrsladoje/sweet-search/issues
- Docs: https://github.com/mrsladoje/sweet-search/tree/main/docs
