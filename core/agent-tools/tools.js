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

// How long ss-search waits for a daemon that is still loading its indexes. Under the
// shortest harness command cap (Claude Code Bash and opencode bash: 120 s by default), so
// the agent reads a retry line instead of a killed command. Codex keeps a long command
// running in its exec session.
export const SEARCH_LOADING_WAIT_MS = 90_000;

// Epoch ms at which the agent's ss-* command started, set by the native client and kept
// through the daemon route and the in-process fallback, so the 90 s budget covers the
// whole command, not each hop.
export const CALL_STARTED_ENV = 'SWEET_SEARCH_CALL_STARTED_MS';

/** When this call started (`env[CALL_STARTED_ENV]`, else now). */
export function callStartedMs(env, now = Date.now()) {
  const t = Number(env?.[CALL_STARTED_ENV]);
  return Number.isFinite(t) && t > 0 && t <= now ? t : now;
}

/** The one line ss-search prints when the daemon is not ready in time (exit 1). */
export function searchNotReadyLine(seconds, failed = false) {
  return failed
    ? `sweet-search: index server failed to start (${seconds}s); retry this command in a minute\n`
    : `sweet-search: index server still loading (${seconds}s); retry this command in a minute\n`;
}

// Printed by `sweet-search --agent-tools-protocol` and embedded in the native binary.
// A binary without it predates the native ss-* tools and must never be run as one: it
// would read the tool's arguments as a search query.
export const AGENT_TOOLS_PROTOCOL_MARKER = 'sweet-search-agent-tools-protocol=1';

/** `ss-grep` → `grep`; a bare subcommand passes through; anything else → null. */
export function subcommandFor(name) {
  if (Object.hasOwn(AGENT_TOOLS, name)) return AGENT_TOOLS[name];
  return AGENT_TOOL_SUBCOMMANDS.has(name) ? name : null;
}
