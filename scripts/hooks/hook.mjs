#!/usr/bin/env node
/**
 * `sweet-search-hook` — every harness hook sweet-search registers runs this file:
 *
 *   sweet-search-hook --agent-session-hook   Claude Code / Codex SessionStart (daemon prewarm,
 *                                            receipt reset on clear/compact)
 *   sweet-search-hook --agent-session-drop   Claude Code SessionEnd (drop the session's receipts)
 *   sweet-search-hook                        opencode plugin load (daemon prewarm)
 *   sweet-search-hook --read-hint            Claude Code PreToolUse Read hint (init --enforce-tools)
 *
 * The command is the native binary (core/agent-tools/tools.js NODE_ENTRY_COMMANDS): it finds
 * the package and runs this file with the node that installed it, so a harness without node
 * on PATH still runs the hooks, and the hook commands hold no path.
 */

if (process.argv.includes('--read-hint')) {
  await import('./intercept-read.mjs');
} else {
  await import('../../core/search/session-daemon-prewarm.mjs');
}
