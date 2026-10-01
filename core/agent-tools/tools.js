/**
 * The ss-* agent tools: command name → subcommand of runAgentTool
 * (eval/agent-read-workflows/bin/_ss-helpers.mjs). One table for the bin stubs, the
 * in-process fallback, the daemon route and the native-binary installer. The Rust client
 * keeps the same table (crates/sweet-search-cli/src/agent_tools.rs).
 */

export const AGENT_TOOLS = Object.freeze({
  'ss-search': 'agent-search',
  'ss-grep': 'grep',
  'ss-find': 'find',
  'ss-read': 'read',
  'ss-semantic': 'semantic',
  'ss-trace': 'trace',
});

export const AGENT_TOOL_SUBCOMMANDS = Object.freeze(new Set(Object.values(AGENT_TOOLS)));

// Subcommands that query the search engine. The daemon runs them only once its indexes
// are loaded; ss-read and ss-trace open their own databases and run at once.
export const SEARCHER_SUBCOMMANDS = Object.freeze(new Set(['agent-search', 'grep', 'find', 'semantic']));

// Printed by `sweet-search --agent-tools-protocol` and embedded in the native binary.
// A binary without it predates the native ss-* tools and must never be run as one: it
// would read the tool's arguments as a search query.
export const AGENT_TOOLS_PROTOCOL_MARKER = 'sweet-search-agent-tools-protocol=1';

/** `ss-grep` → `grep`; a bare subcommand passes through; anything else → null. */
export function subcommandFor(name) {
  if (Object.hasOwn(AGENT_TOOLS, name)) return AGENT_TOOLS[name];
  return AGENT_TOOL_SUBCOMMANDS.has(name) ? name : null;
}
