/**
 * Search daemon client: query, health, stop and spawn calls against a running daemon.
 * The daemon itself lives in search-server.js; this module never imports it.
 */

import { projectSocketPath, resolveProjectRoot } from './server-identity.js';
import { currentCall } from '../infrastructure/call-context.js';
import { daemonRequest } from './daemon-client.js';
import { exactRereadOmissionEnabled, resolveAgentSessionId } from './agent-span-ledger.js';

// A backstop for a hung daemon, not a budget; matches the native client's IO timeout.
const QUERY_CLIENT_TIMEOUT_MS = 600_000;

/**
 * Bound a daemon query on the client side and name its failures. Without this, a daemon that
 * closed the socket surfaced as a bare `socket hang up` stack trace in the agent's output.
 */
function guardQueryRequest(req, reject, route) {
  req.setTimeout(QUERY_CLIENT_TIMEOUT_MS, () => {
    req.destroy(daemonError(`Sweet Search daemon did not answer ${route} within ${QUERY_CLIENT_TIMEOUT_MS / 1000} s`));
  });
  req.on('error', (err) => {
    if (err?.userFacing) { reject(err); return; }
    if (err?.code === 'ECONNRESET' || /socket hang up/.test(err?.message || '')) {
      reject(daemonError(`Sweet Search daemon closed the connection before answering ${route} (it stopped or restarted); run the call again`));
      return;
    }
    reject(err);
  });
}

// Set by startServer: this process's own /search handler (see there).
let inProcessSearch = null;
let httpModule = null;

export function setInProcessSearch(handler) {
  inProcessSearch = handler;
}
/** A failure the agent should read as one line: the tool host prints the message, not a stack. */
function daemonError(message) {
  return Object.assign(new Error(message), { userFacing: true });
}

export async function queryServer(query, options = {}) {
  const http = await (httpModule ||= import('http').catch((err) => { httpModule = null; throw err; }));
  const {
    mode = 'auto',
    regex = '',
    topK = 10,
    maxMatches = 0,
    contextLines = 0,
    contextBefore,
    contextAfter,
    fileFilter,
    perFileCap = 0,
    maxFiles = 0,
    grepFileOrder,
    grepFileWeight,
    grepLineClasses = false,
    grepOutsideProbe = 0,
    grepOutsideScopedTotal,
    fixedString = false,
    type = '',
    globs = [],
    pathGlobs = [],
    literalFilter = true,
    gramIndex = true,
    expand = true,
    rerank = true,
    fusion = 'cc',  // Legacy (ignored for hybrid)
    useLateInteraction = true,
    summary = false,
    mid = false,
    format,
    tokenBudget,
    firstUnit,
    projectRoot,
    trackAgentSpans = true,
    _isAgentFormat = false,
    _siblingLine = true,
    _cwdScope = false,
  } = options;

  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      q: query,
      mode,
      k: topK.toString(),
      fusion,
    });
    if (regex) params.set('regex', regex);
    if (maxMatches > 0) params.set('maxMatches', maxMatches.toString());
    if (contextLines > 0) params.set('contextLines', contextLines.toString());
    if (contextBefore != null) params.set('contextBefore', String(contextBefore));
    if (contextAfter != null) params.set('contextAfter', String(contextAfter));
    // One param per scope. `set` would stringify an array into "a,b,c", which
    // the server then treats as one literal path that matches nothing.
    for (const f of (Array.isArray(fileFilter) ? fileFilter : [fileFilter])) {
      if (f) params.append('fileFilter', f);
    }
    if (perFileCap > 0) params.set('perFileCap', perFileCap.toString());
    if (maxFiles > 0) params.set('maxFiles', maxFiles.toString());
    if (grepFileOrder === 'weight') params.set('fileOrder', 'weight');
    if (grepFileWeight === 'sat2') params.set('fileWeight', 'sat2');
    if (grepLineClasses === true) params.set('lineClasses', '1');
    if (grepOutsideProbe > 0) params.set('outsideProbe', String(grepOutsideProbe));
    if (Number.isInteger(grepOutsideScopedTotal)) params.set('outsideScopedTotal', String(grepOutsideScopedTotal));
    if (fixedString) params.set('fixedString', 'true');
    if (type) params.set('type', type);
    if (!literalFilter) params.set('literalFilter', 'false');
    if (!gramIndex) params.set('gramIndex', 'false');
    for (const glob of globs) params.append('glob', glob);
    for (const glob of pathGlobs) if (glob) params.append('pathGlob', glob);
    if (!expand) params.set('expand', 'false');
    if (!rerank) params.set('rerank', 'false');
    if (!useLateInteraction) params.set('late-interaction', 'false');
    if (summary) params.set('summary', 'true');
    if (mid) params.set('mid', 'true');
    if (format && format.startsWith('agent')) params.set('format', format);
    if (tokenBudget) params.set('budget', tokenBudget.toString());
    if (firstUnit === 'calibrated' || firstUnit === 'all') params.set('firstUnit', firstUnit);
    if (projectRoot) params.set('projectRoot', projectRoot);
    if (_isAgentFormat) params.set('agent', 'true');
    if (_siblingLine === false) params.set('siblingLine', 'false');
    if (_cwdScope) params.set('cwdScope', 'true');
    if (!trackAgentSpans) params.set('trackAgentSpans', 'false');
    if (trackAgentSpans && format?.startsWith('agent') && exactRereadOmissionEnabled()) {
      const sessionId = resolveAgentSessionId();
      if (sessionId) {
        params.set('exactRereadOmission', 'true');
        params.set('agentSessionId', sessionId);
      }
    }

    // Inside the daemon, asking its own socket: call the handler directly. An ss-* call the
    // daemon runs for its own repository (daemon-route.js checked the root) always asks it.
    if (inProcessSearch && (currentCall()?.inDaemon === true || inProcessSearch.socketPath === projectSocketPath())) {
      inProcessSearch.request(`/search?${params.toString()}`).then((data) => {
        if (typeof data !== 'string') { resolve(data); return; }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Invalid server response'));
        }
      }, reject);
      return;
    }

    // Per-project Unix socket (C3) — the canonical local transport.
    const req = http.request({
      socketPath: projectSocketPath(),
      path: `/search?${params.toString()}`,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Invalid server response'));
        }
      });
    });
    guardQueryRequest(req, reject, '/search');
    req.end();
  });
}

/**
 * Query the warm daemon's read-semantic route as JSON. The caller may retain
 * its existing renderer while reusing the daemon's resident model/index.
 *
 * @param {{ path: string, query: string, projectRoot: string, maxChars?: number,
 *          wholeFileMaxChars?: number, exactRanges?: boolean, pickExcerpt?: boolean }} request
 * @returns {Promise<object>}
 */
export async function queryReadSemanticServer({ path: file, query, projectRoot, maxChars, wholeFileMaxChars, topK, exactRanges, pickExcerpt } = {}) {
  if (!file || !query || !projectRoot) {
    throw new TypeError('path, query, and projectRoot are required');
  }
  const http = await import('http');
  const params = new URLSearchParams({
    path: file,
    q: query,
    projectRoot,
    format: 'json',
  });
  if (maxChars > 0) params.set('maxChars', String(maxChars));
  if (wholeFileMaxChars > 0) params.set('wholeFileMaxChars', String(wholeFileMaxChars));
  if (topK > 0) params.set('topK', String(topK));
  if (exactRanges === true) params.set('exactRanges', '1');
  if (pickExcerpt === true) params.set('pick', '1');

  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: projectSocketPath(),
      path: `/read-semantic?${params.toString()}`,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid server response')); }
      });
    });
    guardQueryRequest(req, reject, '/read-semantic');
    req.end();
  });
}

/**
 * Fetch /health from the running daemon. Returns the parsed body, or null if
 * the daemon is unreachable / replies non-200.
 *
 * Use this (not isServerRunning alone) when you need repo identity to make a
 * decision — e.g., the agent-bench harness must know which repo the daemon
 * is currently serving so it can refuse cross-repo contamination.
 */
export async function getServerHealth({ timeoutMs = 1000 } = {}) {
  try {
    const { status, body } = await daemonRequest(projectSocketPath(), '/health', { timeoutMs });
    if (status !== 200) return null;
    try { return JSON.parse(body); }
    catch { return null; }
  } catch {
    return null;
  }
}

/** True when a /stop request reached the daemon: it replied, or dropped the connection as it exited. */
async function requestStop(socketPath, timeoutMs) {
  try {
    await daemonRequest(socketPath, '/stop', { timeoutMs });
    return true;
  } catch (err) {
    const code = (err && err.code) || '';
    return code === 'ECONNRESET' || code === 'EPIPE' || code === 'ENOENT';
  }
}

/**
 * Send /stop to the running daemon (Unix-socket only — TCP is forbidden).
 * Returns true if the request reached the daemon (200 reply or connection
 * closed by the dying server). Caller is expected to poll until the socket
 * disappears or wait a short cool-down.
 */
export async function stopServer({ timeoutMs = 5000 } = {}) {
  return requestStop(projectSocketPath(), timeoutMs);
}

/**
 * Send /stop to a daemon on an EXPLICIT socket (variant of stopServer, which
 * always targets this process's own socket). Used by the resident-daemon LRU
 * cap to evict a least-recently-active PEER. Returns true if the request
 * reached the daemon (200, or the connection dropped as it exited).
 */
export async function sendStopToSocket(socketPath, { timeoutMs = 5000 } = {}) {
  if (!socketPath) return false;
  return requestStop(socketPath, timeoutMs);
}

/**
 * Best-effort wait for the daemon to exit. Returns true once /health stops
 * answering at all (within timeoutMs); false otherwise. This intentionally
 * uses getServerHealth(), not isServerRunning(), because a failed/starting
 * daemon still owns the socket and must not be mistaken for "gone".
 */
export async function waitForServerExit({ timeoutMs = 8000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await getServerHealth({ timeoutMs: Math.max(1000, intervalMs) }))) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Ensure the warm daemon serves the requested projectRoot. If a daemon is
 * already running with a different projectRoot, stop it first, then re-spawn.
 *
 * Returns:
 *   { ok: true,  health, action: 'reused'|'spawned'|'restarted' }
 *   { ok: false, reason, health? }
 *
 * Used by the agent-bench harness to fail closed against cross-repo
 * contamination (see eval/agent-read-workflows/run-bench.js warmup phase).
 */
export async function ensureDaemonForProjectRoot(expectedProjectRoot, {
  timeoutMs = 60000, intervalMs = 500,
} = {}) {
  const path = (await import('path')).default;
  const expected = path.resolve(expectedProjectRoot);
  let action = null;

  let health = await getServerHealth();
  if (health && health.resolvedProjectRoot && health.resolvedProjectRoot === expected) {
    return { ok: true, health, action: 'reused' };
  }

  if (health && health.resolvedProjectRoot && health.resolvedProjectRoot !== expected) {
    await stopServer();
    const exited = await waitForServerExit();
    if (!exited) {
      return { ok: false, reason: 'previous-daemon-failed-to-exit', health };
    }
    action = 'restarted';
  } else {
    action = 'spawned';
  }

  // Spawn detached daemon. autoSpawnServer inherits env, so the caller must
  // already have SWEET_SEARCH_PROJECT_ROOT set to expectedProjectRoot.
  if (process.env.SWEET_SEARCH_PROJECT_ROOT) {
    const envResolved = path.resolve(process.env.SWEET_SEARCH_PROJECT_ROOT);
    if (envResolved !== expected) {
      return {
        ok: false,
        reason: `caller env SWEET_SEARCH_PROJECT_ROOT=${envResolved} differs from expected=${expected}`,
      };
    }
  }
  await autoSpawnServer();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    health = await getServerHealth();
    if (health && health.resolvedProjectRoot === expected && (health.warm === true || health.status === 'ready')) {
      return { ok: true, health, action };
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { ok: false, reason: 'daemon-did-not-become-ready-with-expected-root', health };
}

/**
 * True when a process accepts connections on this project's socket. The kernel accepts
 * even while the daemon's event loop is busy loading indexes or answering a long query,
 * so this tells "a daemon exists" apart from "no daemon" where a /health probe with a
 * short timeout cannot.
 */
export async function isServerListening({ timeoutMs = 2000 } = {}) {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const sock = net.connect(projectSocketPath());
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

export async function isServerRunning() {
  try {
    let reply;
    try { reply = await daemonRequest(projectSocketPath(), '/health', { timeoutMs: 500 }); }
    catch { return false; }
    if (reply.status !== 200) return false;
    try {
      const body = JSON.parse(reply.body);
      return body?.status === 'ready' || body?.warm === true;
    } catch {
      return false;
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return false;
  }
}

/**
 * Auto-spawn warm server in background
 * Returns true if server started successfully
 */
export async function autoSpawnServer({ quiet = false } = {}) {
  const note = quiet ? () => {} : (msg) => console.error(msg);
  const { spawn } = await import('child_process');
  const { fileURLToPath } = await import('url');
  const path = await import('path');

  // Spawn the real CLI entrypoint with --serve. sweet-search.js is a library
  // module and does not process argv, so launching it directly never starts
  // the daemon.
  const __filename = fileURLToPath(import.meta.url);
  const sweetSearchPath = path.join(path.dirname(__filename), '..', 'cli.js');

  note('[AutoStart] Starting warm server in background...');

  const { daemonNodeArgs } = await import('./daemon-heap.js');
  // The daemon outlives this call: it must not carry the call's start stamp (CALL_STARTED_ENV),
  // or every later call it serves would start with its budget spent.
  const { CALL_STARTED_ENV } = await import('../agent-tools/tools.js');
  const env = { ...process.env };
  delete env[CALL_STARTED_ENV];
  // The daemon runs from the package directory, so it cannot find the project from its
  // cwd: pin the caller's project root, as the native CLI does.
  if (!env.SWEET_SEARCH_PROJECT_ROOT) env.SWEET_SEARCH_PROJECT_ROOT = resolveProjectRoot();
  const { openDaemonLog, closeDaemonLog } = await import('./daemon-log.js');
  const logFd = openDaemonLog(env.SWEET_SEARCH_PROJECT_ROOT);
  let child;
  try {
    child = spawn(process.execPath, [...daemonNodeArgs(), sweetSearchPath, '--serve'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: path.dirname(__filename),
      env,
    });
  } finally {
    closeDaemonLog(logFd);
  }

  child.unref();
  // Bench-only pid ledger (no-op unless SWEET_SEARCH_SPAWN_LEDGER_DIR is set):
  // lets the harness that caused this spawn find and stop the detached daemon.
  try {
    const { recordSpawn } = await import('../infrastructure/spawn-ledger.js');
    recordSpawn({ pid: child.pid, role: 'daemon' });
  } catch { /* best-effort */ }

  // Wait for server to be ready (up to 5 seconds)
  const maxWait = 5000;
  const checkInterval = 100;
  let waited = 0;

  while (waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waited += checkInterval;

    if (await isServerRunning()) {
      note(`[AutoStart] Server ready in ${waited}ms`);
      return true;
    }
  }

  note('[AutoStart] Server startup timeout, using cold start');
  return false;
}
