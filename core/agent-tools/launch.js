/**
 * Entry of the `bin/ss-*` stubs that npm links onto the PATH.
 *
 * An install that ran the postinstall step never reaches this file: the step replaces
 * each stub with the native binary itself (scripts/link-native-tools.js), so `ss-grep`
 * is the Rust client and no node process starts. This file serves the installs where the
 * step could not run (--ignore-scripts, a package manager that blocks install scripts, a
 * platform without a native binary): it hands the call to the native binary when one is
 * available, and otherwise runs the tool in this process.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveNativeBinary } from '../infrastructure/native-resolver.js';
import { AGENT_TOOLS, AGENT_TOOLS_PROTOCOL_MARKER } from './tools.js';
import { CHAIN_PID_ENV } from './chain.js';

function envFalsey(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

// Read, not run: a binary from before the native tools would take the arguments as a
// search query. The marker is a string literal in the binary.
function hasAgentTools(binaryPath) {
  try { return readFileSync(binaryPath).includes(AGENT_TOOLS_PROTOCOL_MARKER); }
  catch { return false; }
}

export async function launchAgentTool(toolName) {
  const args = process.argv.slice(2);
  if (!envFalsey('SWEET_SEARCH_AGENT_TOOLS_VIA_DAEMON')) {
    const nativeBin = resolveNativeBinary();
    if (nativeBin && hasAgentTools(nativeBin)) {
      // argv0 selects the tool: the binary dispatches on the name it was called by.
      // This process sits between the shell and the binary: it stands for the call when
      // the binary decides whether the call is part of a chained command (chain.js).
      const env = { ...process.env, [CHAIN_PID_ENV]: process.env[CHAIN_PID_ENV] || String(process.pid) };
      const result = spawnSync(nativeBin, args, { stdio: 'inherit', argv0: toolName, env });
      if (!result.error) process.exit(result.status ?? 1);
    }
  }
  const { runAgentToolInProcess } = await import('./cli.js');
  await runAgentToolInProcess(AGENT_TOOLS[toolName], args);
}
