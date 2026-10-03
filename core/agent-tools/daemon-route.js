/**
 * POST /agent-tool — the resident daemon runs one ss-* call for the native client.
 *
 * Request (JSON): { v: 1, tool, args, cwd, env, pid }
 *   tool  subcommand (grep | find | read | semantic | trace | agent-search)
 *   args  the arguments after the tool name, unchanged
 *   cwd   the caller's absolute working directory
 *   env   the caller's environment (string → string)
 *   pid   the caller's pid (harness detection walks up from it)
 * Reply 200 (JSON): { v: 1, code, stdout, stderr } — the call's exit code and output.
 *
 * Every other status means the tool did NOT run, and the client runs it in a fresh
 * process instead: 409 the call belongs to another repository's daemon, 503 this daemon
 * is not ready, 400/413 a malformed request. A run is never retried after it started.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runInVirtualProcess } from './virtual-process.js';
import { AGENT_TOOL_SUBCOMMANDS, SEARCHER_SUBCOMMANDS, SEARCH_LOADING_WAIT_MS, searchNotReadyLine } from './tools.js';

export const AGENT_TOOL_BODY_MAX_BYTES = 1024 * 1024;
const MAX_ARGS = 256;
const READY_WAIT_MS = 60_000;

class ProjectRootMismatch extends Error {}

function canonical(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function json(status, body) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/** Throws a 400-status Error when the payload is not a well-formed call. */
export function validateAgentToolPayload(payload) {
  const bad = (message) => Object.assign(new Error(message), { status: 400 });
  if (!payload || typeof payload !== 'object' || payload.v !== 1) throw bad('expected { v: 1, … }');
  if (!AGENT_TOOL_SUBCOMMANDS.has(payload.tool)) throw bad(`unknown tool: ${payload.tool}`);
  if (!Array.isArray(payload.args) || payload.args.length > MAX_ARGS || !payload.args.every(a => typeof a === 'string')) {
    throw bad('args must be an array of strings');
  }
  if (typeof payload.cwd !== 'string' || !path.isAbsolute(payload.cwd)) throw bad('cwd must be an absolute path');
  if (!payload.env || typeof payload.env !== 'object' || Array.isArray(payload.env)
      || !Object.values(payload.env).every(v => typeof v === 'string')) {
    throw bad('env must map names to strings');
  }
  if (!Number.isInteger(payload.pid) || payload.pid < 1) throw bad('pid must be a positive integer');
  return payload;
}

/**
 * @param {object} payload
 * @param {object} deps
 * @param {boolean} deps.isUnixSocket
 * @param {object} deps.searcher                 the daemon's SweetSearch
 * @param {() => boolean} deps.isReady
 * @param {() => boolean} [deps.isFailed]       its index load failed
 * @param {() => Promise<void>} deps.waitForServerReady
 * @param {(sub, args, host) => Promise<void>} [deps.runTool]  test seam
 */
export async function buildAgentToolDaemonResponse(payload, {
  isUnixSocket = false,
  searcher = null,
  isReady = () => false,
  isFailed = () => false,
  waitForServerReady = async () => {},
  runTool = null,
} = {}) {
  if (!isUnixSocket) return json(403, { error: '/agent-tool is only available via Unix socket' });
  let call;
  try { call = validateAgentToolPayload(payload); }
  catch (err) { return json(err.status || 400, { error: err.message }); }

  if (SEARCHER_SUBCOMMANDS.has(call.tool)) {
    // The tools always allowed a cold daemon 60 s to load (ensureWarmServerReady). A 503
    // sends the call to the in-process fallback, which would only wait again.
    // ss-search has no cold fallback worth having (the fallback would wait on this same
    // daemon), so it waits the ss-search budget and then answers with the retry line.
    const search = call.tool === 'agent-search';
    const started = Date.now();
    if (!isReady()) await waitForServerReady(search ? SEARCH_LOADING_WAIT_MS : READY_WAIT_MS);
    if (!isReady()) {
      if (search && !isFailed()) {
        return json(200, { v: 1, code: 1, stdout: '', stderr: searchNotReadyLine(Math.round((Date.now() - started) / 1000)) });
      }
      return json(503, { error: 'Server is not ready', status: isFailed() ? 'failed' : 'starting' });
    }
  }

  const daemonRoot = canonical(searcher?.projectRoot || process.cwd());
  const host = {
    getSearcher: () => searcher,
    assertProjectRoot(root) {
      if (canonical(root) !== daemonRoot) throw new ProjectRootMismatch(root);
    },
  };
  const run = runTool || (async (sub, args, h) => {
    const { runAgentTool } = await import('../../eval/agent-read-workflows/bin/_ss-helpers.mjs');
    await runAgentTool(sub, args, h);
  });

  let mismatch = null;
  const result = await runInVirtualProcess(
    { env: { ...call.env }, cwd: call.cwd, pid: call.pid },
    async () => {
      try { await run(call.tool, call.args, host); }
      catch (err) {
        if (err instanceof ProjectRootMismatch) { mismatch = err; return; }
        throw err;
      }
    },
  );
  if (mismatch) {
    return json(409, { error: 'Daemon project root mismatch', serverProjectRoot: daemonRoot, requestedProjectRoot: canonical(mismatch.message) });
  }
  return json(200, {
    v: 1,
    code: result.code,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
  });
}
