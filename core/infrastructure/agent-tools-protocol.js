// Printed by `sweet-search --agent-tools-protocol` and embedded in the native binary.
// A binary without it (or with an older version) does not answer to every name in
// NATIVE_COMMANDS (core/agent-tools/tools.js) and must never be linked as one: it would
// read the arguments as a search query. Version 2 added NODE_ENTRY_COMMANDS.
// Rust copy: crates/sweet-search-cli/src/agent_tools.rs PROTOCOL_MARKER.
export const AGENT_TOOLS_PROTOCOL_MARKER = 'sweet-search-agent-tools-protocol=2';
