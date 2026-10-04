#!/usr/bin/env node
/**
 * In-process ss-* runner: `node core/agent-tools/cli.js <ss-tool|subcommand> [args…]`.
 *
 * The fallback behind the native client. It runs the tool code in this fresh process,
 * inside the same virtual process the daemon uses, and applies the output contract the
 * old bash wrappers applied: stdout always, stderr only on a non-zero exit (stderr holds
 * engine load logs and meta lines the agent must not see on success).
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installVirtualProcess, runInVirtualProcess } from './virtual-process.js';
import { subcommandFor } from './tools.js';
import { resolveChainPosition } from './chain.js';

function writeAll(write, stream, buf) {
  if (!buf.length) return Promise.resolve();
  return new Promise((resolve) => { write.call(stream, buf, () => resolve()); });
}

/**
 * @param {string} subcommand
 * @param {string[]} args
 * @param {{stderr?: 'on-failure'|'always', runTool?: Function}} [opts]  `runTool`: the tool
 *   module's runAgentTool when the caller IS that module (importing it again from inside
 *   its own top-level await would never settle).
 */
export async function runAgentToolInProcess(subcommand, args, { stderr = 'on-failure', runTool = null } = {}) {
  const { real } = installVirtualProcess();
  // Before the tool runs: a later call of a chained command prints a boundary line.
  resolveChainPosition(real.env);
  const result = await runInVirtualProcess(
    // The real environment object: the tool's writes to it (SWEET_SEARCH_PROJECT_ROOT)
    // reach anything it spawns, as they did when the tool owned the process.
    { env: real.env, cwd: real.cwd.call(process), pid: process.pid },
    async () => {
      const run = runTool || (await import('../../eval/agent-read-workflows/bin/_ss-helpers.mjs')).runAgentTool;
      await run(subcommand, args);
    },
  );
  await writeAll(real.stdoutWrite, process.stdout, result.stdout);
  if (stderr === 'always' || result.code !== 0) await writeAll(real.stderrWrite, process.stderr, result.stderr);
  // Exit now: a cold in-process engine leaves timers and handles that would otherwise
  // keep this process alive after the answer is out.
  real.exit.call(process, result.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const sub = subcommandFor(process.argv[2] || '');
  if (!sub) {
    process.stderr.write(`usage: cli.js <ss-search|ss-grep|ss-find|ss-read|ss-semantic|ss-trace> [args…]\n`);
    process.exit(2);
  }
  await runAgentToolInProcess(sub, process.argv.slice(3));
}
