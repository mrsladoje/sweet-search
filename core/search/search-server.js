/**
 * Search Server Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains HTTP/Unix socket server for warm search and server management.
 *
 * IMPORTANT: Uses dynamic import() for sweet-search.js references
 * to avoid circular dependencies.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { clearCache } from '../embedding/embedding-cache.js';
import { launchMaintainer } from '../indexing/maintainer-launcher.mjs';
import { projectSocketPath, projectPidFile, tcpPort } from './server-identity.js';

// =============================================================================
// Server constants
// =============================================================================

// Default TCP port — only bound when the operator opts in via
// SWEET_SEARCH_TCP_PORT (C3: a single global TCP port collides across projects
// and leaks queries between them; the per-project Unix socket is the default
// transport). Exported for back-compat references.
export const SEARCH_SERVER_PORT = 9876;
export const SEARCH_SERVER_TIMEOUT_MS = 30_000;
export const SEARCH_SERVER_MAX_URL_LENGTH = 16_384;
export const SEARCH_SERVER_MAX_QUERY_LENGTH = 2_000;

function buildTextSearchResponse(results, stats, totalTime, { summary = false, mid = false, color = true, decorate = true } = {}) {
  const routeMode = stats?.routing?.mode || 'auto';
  const icon = routeMode === 'lexical' ? '⚡' : routeMode === 'semantic' ? '🧠' : '✨';
  // Color is opt-out: the native CLI passes color=false whenever its result
  // stream is captured (an agent pipe / Claude side-channel), so ANSI never
  // enters captured output. A real human terminal keeps color.
  const W = color ? '\x1b[1;38;5;231m' : '';
  const D = color ? '\x1b[38;5;245m' : '';
  const G = color ? '\x1b[38;5;114m' : '';
  const R = color ? '\x1b[0m' : '';
  const Y = color ? '\x1b[38;5;220m' : '';
  const C = color ? '\x1b[38;5;51m' : '';

  // The stats prelude (mode | ms ●) is decoration: the native CLI passes
  // decorate=false for captured output so the body is results-only.
  let out = '';
  if (decorate) {
    out += `  ${icon} ${W}${routeMode}${R} ${D}|${R} ${W}${totalTime}ms${R} ${G}●${R}\n`;
    out += '\n';
  }

  if (!results || results.length === 0) {
    out += 'No results\n';
  } else if (stats?.path === 'grep') {
    out += `${Y}GREP${R} (${results.length} matches)\n`;
    out += `${'─'.repeat(50)}\n\n`;
    results.forEach((r) => {
      out += `${C}${r.file}:${r.line}:${r.column || 1}${R}\n`;
      for (const line of r.contextBefore || []) out += `  ${line}\n`;
      out += `> ${r.content || r.text || ''}\n`;
      for (const line of r.contextAfter || []) out += `  ${line}\n`;
      out += '\n';
    });
  } else if (summary) {
    out += `${Y}SUMMARY VIEW${R} (${results.length} results) - 10x fewer tokens\n`;
    out += `${'─'.repeat(50)}\n\n`;
    results.forEach((r, i) => {
      const m = r.metadata || {};
      const name = r.name || m.name || '?';
      const type = r.type || m.type || '?';
      const file = r.file || r.file_path || m.file || '?';
      const idParts = r.id?.split(':') || [];
      const line = r.startLine || r.start_line || (idParts.length >= 2 ? idParts[1].split('-')[0] : '?');
      const summ = r.summary || r.signature?.slice(0, 100) || '';

      out += `${W}${i + 1}. [${type}] ${name}${R}\n`;
      out += `   ${C}${file}:${line}${R}\n`;
      if (summ) out += `   ${summ}\n`;
      out += '\n';
    });
    out += `${D}Use: Read <file:line> for full code${R}\n`;
  } else if (mid) {
    out += `${Y}MIDDLE-RES VIEW${R} (${results.length} results) - Signature + Doc\n`;
    out += `${'─'.repeat(50)}\n\n`;
    results.forEach((r, i) => {
      const m = r.metadata || {};
      const name = r.name || m.name || '?';
      const type = r.type || m.type || '?';
      const file = r.file || r.file_path || m.file || '?';
      const idParts = r.id?.split(':') || [];
      const line = r.startLine || r.start_line || (idParts.length >= 2 ? idParts[1].split('-')[0] : '?');
      const sig = r.signature || '';
      const doc = (r.docComment || r.doc_comment || '').slice(0, 150);

      out += `${W}${i + 1}. [${type}] ${name}${R}\n`;
      out += `   ${C}${file}:${line}${R}\n`;
      if (sig) out += `   ${sig}\n`;
      if (doc) out += `   ${D}${doc}${R}\n`;
      out += '\n';
    });
  } else {
    out += `${results.length} results:\n\n`;
    results.forEach((r, i) => {
      const m = r.metadata || {};
      const name = r.name || m.name || '?';
      const type = r.type || m.type || '?';
      const file = r.file || r.file_path || m.file || '?';
      const idParts = r.id?.split(':') || [];
      const line = r.startLine || r.start_line || (idParts.length >= 2 ? idParts[1].split('-')[0] : '?');
      const score = (r.score || 0).toFixed(4);
      const path = r.searchPath || '?';
      const sig = (r.signature || r.docComment || m.signature || '').slice(0, 70);

      out += `${W}${i + 1}. ${name}${R} (${type})\n`;
      out += `   File: ${file}:${line}\n`;
      out += `   Path: ${path}\n`;
      out += `   Score: ${score}\n`;
      if (sig) out += `   ${sig}\n`;
      out += '\n';
    });
  }

  return out;
}

function buildJsonSearchResponse(results, stats, totalTime) {
  return JSON.stringify({
    results,
    stats: { ...stats, server_ms: totalTime },
  });
}

// =============================================================================
// Server implementation
// =============================================================================

export async function startServer() {
  const http = await import('http');

  // Per-project server identity (C3). The Unix socket + pidfile are derived from
  // the canonical project root so each project gets its own server and never
  // answers another project's queries. TCP is opt-in (off by default) — a single
  // global TCP port both collides (EADDRINUSE) and leaks across projects.
  const socketPath = projectSocketPath();
  const pidFile = projectPidFile();
  const httpPort = tcpPort();

  // Dynamic import to avoid circular dependency
  const { default: SweetSearch } = await import('./sweet-search.js');

  const searcher = new SweetSearch({ verbose: false });
  const initStartedAt = Date.now();
  let serverReady = false;
  let initError = null;
  let initTimeMs = null;

  // Track request count for periodic cache clearing in long-running sessions.
  let requestCount = 0;
  const CACHE_CLEAR_INTERVAL = 1000;  // Clear caches every 1000 requests

  let tcpServer;
  let unixServer;

  // Shared request handler for both TCP and Unix socket
  const handleRequest = async (req, res) => {
    const reqUrl = req.url || '';

    const componentState = {
      graphIndex: Boolean(searcher.hasGraphIndex),
      hnswIndex: Boolean(searcher.hasHnswIndex),
      binaryHnswIndex: Boolean(searcher.hasBinaryHnswIndex),
      lateInteractionIndex: Boolean(searcher.hasLateInteractionIndex && searcher.useLateInteraction),
      embeddingService: serverReady,
      reranker: serverReady,
    };

    // Periodic cache clearing to prevent unbounded memory growth.
    requestCount++;
    if (requestCount % CACHE_CLEAR_INTERVAL === 0) {
      // Clear module-level embedding cache singleton
      clearCache();
      // Force garbage collection if available (run with --expose-gc)
      if (global.gc) {
        global.gc();
      }
      console.log(`[Server] Cache cleared after ${requestCount} requests`);
    }

    if (req.method === 'GET' && reqUrl.startsWith('/search?')) {
      if (!serverReady) {
        const reason = initError?.message
          ? `Server initialization failed: ${initError.message}`
          : 'Server is starting, please retry';
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: reason, status: initError ? 'failed' : 'starting' }));
        return;
      }

      if (reqUrl.length > SEARCH_SERVER_MAX_URL_LENGTH) {
        res.writeHead(414, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Request URL too long (max ${SEARCH_SERVER_MAX_URL_LENGTH} chars)` }));
        return;
      }
      const url = new URL(reqUrl, `http://localhost:${SEARCH_SERVER_PORT}`);
      const query = url.searchParams.get('q') || '';
      const mode = url.searchParams.get('mode') || 'auto';
      const topK = parseInt(url.searchParams.get('k') || '10', 10);

      // Additional search options
      const expand = url.searchParams.get('expand') !== 'false';
      const rerank = url.searchParams.get('rerank') !== 'false';
      const fusion = url.searchParams.get('fusion') || 'cc';  // Legacy (ignored for hybrid)
      // Late interaction: explicit param overrides config, else use config default
      const useLateInteraction = url.searchParams.has('late-interaction')
        ? url.searchParams.get('late-interaction') === 'true'
        : LATE_INTERACTION_CONFIG.enabled;

      // Output format options
      const format = url.searchParams.get('format') || 'json';
      const useColor = url.searchParams.get('color') !== 'false';
      const decorate = url.searchParams.get('decorate') !== 'false';
      const summary = url.searchParams.get('summary') === 'true';
      const mid = url.searchParams.get('mid') === 'true';

      // Pattern mode: regex param (ColGrep hybrid search)
      const regex = url.searchParams.get('regex') || '';
      const SEARCH_SERVER_MAX_REGEX_LENGTH = 4096;
      if (regex.length > SEARCH_SERVER_MAX_REGEX_LENGTH) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Regex too long (max ${SEARCH_SERVER_MAX_REGEX_LENGTH} chars)` }));
        return;
      }
      const maxMatches = parseInt(url.searchParams.get('maxMatches') || '0', 10);
      const contextLines = parseInt(url.searchParams.get('contextLines') || '0', 10);
      const fixedString = url.searchParams.get('fixedString') === 'true';
      const symbolType = url.searchParams.get('type') || '';
      const useLiteralFilter = url.searchParams.get('literalFilter') !== 'false';
      const useSparseGrams = url.searchParams.get('gramIndex') !== 'false';
      const globs = url.searchParams.getAll('glob');

      // Agent mode: context packaging (ColGrep agent format)
      const rawFormat = url.searchParams.get('format');
      const AGENT_FORMATS = new Set(['agent', 'agent_preview', 'agent_full', 'agent_full_xl']);
      const agentFormat = AGENT_FORMATS.has(rawFormat) ? rawFormat : undefined;
      const tokenBudget = url.searchParams.has('budget')
        ? parseInt(url.searchParams.get('budget'), 10)
        : undefined;

      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing query parameter ?q=' }));
        return;
      }
      if (query.length > SEARCH_SERVER_MAX_QUERY_LENGTH) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Query too long (max ${SEARCH_SERVER_MAX_QUERY_LENGTH} chars)` }));
        return;
      }

      try {
        const start = Date.now();
        const searchResult = await searcher.search(query, {
          k: topK,
          mode,
          regex,
          maxMatches,
          contextLines,
          fixedString,
          type: symbolType,
          globs,
          literalFilter: useLiteralFilter,
          gramIndex: useSparseGrams,
          expand,
          rerank,
          fusion,
          useLateInteraction,
          ...(agentFormat && { format: agentFormat, tokenBudget }),
        });

        // Agent mode: return the packaged response directly as JSON.
        // Inject server-side repo identity so callers can prove which repo
        // produced these results (defends against multi-repo bench reusing
        // a stale daemon — see eval/agent-read-workflows/run-bench.js).
        if (searchResult.format === 'agent') {
          searchResult.serverProjectRoot = searcher.projectRoot || null;
          searchResult.serverPid = process.pid;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(searchResult));
        } else {
          let { results, stats } = searchResult;

          // Enrich with summaries if summary mode
          if (summary) {
            results = await searcher.enrichWithSummaries(results);
          }

          const totalTime = Date.now() - start;

          if (format === 'text') {
            const out = buildTextSearchResponse(results, stats, totalTime, { summary, mid, color: useColor, decorate });
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(out);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(buildJsonSearchResponse(results, stats, totalTime));
          }
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'GET' && reqUrl === '/health') {
      const status = initError ? 'failed' : (serverReady ? 'ready' : 'starting');
      // Repo identity — harness uses these to verify the daemon serves the
      // expected repo, not a leftover from a previous benchmark subprocess.
      // We resolve the path so symlinks/relative differences are normalised.
      const rawProjectRoot = searcher.projectRoot || null;
      let resolvedProjectRoot = null;
      try { if (rawProjectRoot) resolvedProjectRoot = (await import('path')).default.resolve(rawProjectRoot); } catch { /* */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status,
        warm: serverReady,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        projectRoot: rawProjectRoot,
        resolvedProjectRoot,
        codebaseDbPath: searcher.codebaseDbPath || null,
        initialized: serverReady && !initError,
        init: {
          startedAt: new Date(initStartedAt).toISOString(),
          elapsedMs: initTimeMs ?? (Date.now() - initStartedAt),
          error: initError?.message || null,
        },
        components: componentState,
      }));
    } else if (req.method === 'GET' && reqUrl === '/stop') {
      // Only allow /stop via Unix socket (OS-level access control).
      const isUnixSocket = !req.socket.remoteAddress;
      if (!isUnixSocket) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: /stop is only available via Unix socket\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Shutting down...\n');
      if (tcpServer) tcpServer.close();
      if (unixServer) unixServer.close();
      try { await fs.unlink(pidFile); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
      try { await fs.unlink(socketPath); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
      process.exit(0);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Use GET /search?q=<query>&mode=auto&k=10\n');
    }
  };

  // TCP server — opt-in only (SWEET_SEARCH_TCP_PORT). Bound non-fatally so a
  // port already in use never crashes the server (C3: it used to be bound
  // unconditionally on 9876 and a second project's server died on EADDRINUSE).
  if (httpPort != null) {
    tcpServer = http.createServer(handleRequest);
    tcpServer.setTimeout(SEARCH_SERVER_TIMEOUT_MS);
    if ('requestTimeout' in tcpServer) tcpServer.requestTimeout = SEARCH_SERVER_TIMEOUT_MS;
    if ('headersTimeout' in tcpServer) tcpServer.headersTimeout = SEARCH_SERVER_TIMEOUT_MS + 5_000;
    tcpServer.on('error', (err) => {
      console.error(`[Server] TCP bind on ${httpPort} failed (continuing on Unix socket): ${err?.code || err?.message || err}`);
      try { tcpServer.close(); } catch { /* ignore */ }
      tcpServer = null;
    });
    tcpServer.listen(httpPort, '127.0.0.1');
    console.log(`[Server] TCP listening on http://127.0.0.1:${httpPort}`);
  }

  // Unix socket server (per-project) - primary transport, 30-50% faster than TCP
  unixServer = http.createServer(handleRequest);
  unixServer.setTimeout(SEARCH_SERVER_TIMEOUT_MS);
  if ('requestTimeout' in unixServer) unixServer.requestTimeout = SEARCH_SERVER_TIMEOUT_MS;
  if ('headersTimeout' in unixServer) unixServer.headersTimeout = SEARCH_SERVER_TIMEOUT_MS + 5_000;
  try { await fs.unlink(socketPath); } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  } // Remove stale socket
  // Set restrictive umask while the socket file is created.
  const prevUmask = process.umask(0o077);
  try {
    await new Promise((resolve, reject) => {
      const onListening = () => {
        unixServer.off('error', onError);
        resolve();
      };
      const onError = (err) => {
        unixServer.off('listening', onListening);
        reject(err);
      };
      unixServer.once('listening', onListening);
      unixServer.once('error', onError);
      unixServer.listen(socketPath);
    });
  } finally {
    process.umask(prevUmask);
  }
  // Belt-and-suspenders: also chmod explicitly in case umask was ineffective.
  try { (await import('node:fs')).chmodSync(socketPath, 0o700); } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }
  console.log(`[Server] Unix socket listening on ${socketPath}`);
  console.log(`[Server] Fast access: curl --unix-socket ${socketPath} "http://localhost/search?q=query"`);

  console.log('[Server] Initializing indexes (one-time cost)...');
  (async () => {
    try {
      await searcher.init();
      initTimeMs = Date.now() - initStartedAt;
      serverReady = true;
      await fs.writeFile(pidFile, process.pid.toString(), { mode: 0o644 });
      console.log(`[Server] Indexes loaded in ${initTimeMs}ms`);
    } catch (err) {
      initError = err;
      initTimeMs = Date.now() - initStartedAt;
      console.error(`[Server] Initialization failed after ${initTimeMs}ms: ${err?.message || err}`);
    }
  })();

  // Durable, non-MCP incremental-indexing guarantee: every normal sweet-search
  // use spins up the warm search server (the native CLI auto-starts it on first
  // query), so starting the default-on reconcile maintainer here means the index
  // stays fresh regardless of Claude/Codex/MCP hooks. We deliberately just start
  // the daemon detached and return — NOT run a blocking reconcile tick — because
  // the maintainer runs its own first tick at t=0 in its own process; blocking
  // server readiness / the first query on indexing work would add latency and
  // risk flakiness. The launcher is idempotent + lock-guarded (no duplicates).
  try {
    launchMaintainer({ cwd: process.cwd() });
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] maintainer launch: ${err?.message || err}\n`);
  }

  // Alias for graceful shutdown
  const server = tcpServer;

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    if (tcpServer) tcpServer.close();
    unixServer.close();
    searcher.close();
    try { await fs.unlink(pidFile); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    try { await fs.unlink(socketPath); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    process.exit(0);
  });
}

// =============================================================================
// Server query and management
// =============================================================================

export async function queryServer(query, options = {}) {
  const http = await import('http');
  const {
    mode = 'auto',
    regex = '',
    topK = 10,
    maxMatches = 0,
    contextLines = 0,
    fixedString = false,
    type = '',
    globs = [],
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
  } = options;

  return new Promise((resolve, reject) => {
    // Build URL with all parameters
    const params = new URLSearchParams({
      q: query,
      mode,
      k: topK.toString(),
      fusion,
    });
    if (regex) params.set('regex', regex);
    if (maxMatches > 0) params.set('maxMatches', maxMatches.toString());
    if (contextLines > 0) params.set('contextLines', contextLines.toString());
    if (fixedString) params.set('fixedString', 'true');
    if (type) params.set('type', type);
    if (!literalFilter) params.set('literalFilter', 'false');
    if (!gramIndex) params.set('gramIndex', 'false');
    for (const glob of globs) params.append('glob', glob);
    if (!expand) params.set('expand', 'false');
    if (!rerank) params.set('rerank', 'false');
    if (!useLateInteraction) params.set('late-interaction', 'false');
    if (summary) params.set('summary', 'true');
    if (mid) params.set('mid', 'true');
    if (format && format.startsWith('agent')) params.set('format', format);
    if (tokenBudget) params.set('budget', tokenBudget.toString());

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
    req.on('error', reject);
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
    const http = await import('http');
    return await new Promise((resolve) => {
      const req = http.request({ socketPath: projectSocketPath(), path: '/health', method: 'GET' }, (res) => {
        let payload = '';
        res.on('data', chunk => { payload += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) { resolve(null); return; }
          try { resolve(JSON.parse(payload)); }
          catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
      req.end();
    });
  } catch {
    return null;
  }
}

/**
 * Send /stop to the running daemon (Unix-socket only — TCP is forbidden).
 * Returns true if the request reached the daemon (200 reply or connection
 * closed by the dying server). Caller is expected to poll until the socket
 * disappears or wait a short cool-down.
 */
export async function stopServer({ timeoutMs = 5000 } = {}) {
  try {
    const http = await import('http');
    return await new Promise((resolve) => {
      const req = http.request({
        socketPath: projectSocketPath(), path: '/stop', method: 'GET',
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });
      // The server may close the socket abruptly as it exits before sending an
      // end-of-response. Treat that as success too.
      req.on('error', (err) => {
        const msg = (err && err.code) || '';
        if (msg === 'ECONNRESET' || msg === 'EPIPE' || msg === 'ENOENT') resolve(true);
        else resolve(false);
      });
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
      req.end();
    });
  } catch {
    return false;
  }
}

/**
 * Best-effort wait for the daemon to exit. Returns true once /health stops
 * answering (within timeoutMs); false otherwise.
 */
export async function waitForServerExit({ timeoutMs = 8000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isServerRunning())) return true;
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
    // Wrong-repo daemon. Stop it and respawn with the correct env.
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

export async function isServerRunning() {
  try {
    const http = await import('http');
    return new Promise((resolve) => {
      const req = http.request({ socketPath: projectSocketPath(), path: '/health', method: 'GET' }, (res) => {
        let payload = '';
        res.on('data', chunk => { payload += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }
          try {
            const body = JSON.parse(payload);
            resolve(body?.status === 'ready' || body?.warm === true);
          } catch {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
      req.end();
    });
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return false;
  }
}

/**
 * Auto-spawn warm server in background
 * Returns true if server started successfully
 */
export async function autoSpawnServer() {
  const { spawn } = await import('child_process');
  const { fileURLToPath } = await import('url');
  const path = await import('path');

  // Spawn the real CLI entrypoint with --serve. sweet-search.js is a library
  // module and does not process argv, so launching it directly never starts
  // the daemon.
  const __filename = fileURLToPath(import.meta.url);
  const sweetSearchPath = path.join(path.dirname(__filename), '..', 'cli.js');

  console.error('[AutoStart] Starting warm server in background...');

  // Spawn detached process — run sweet-search with --serve
  const child = spawn(process.execPath, [sweetSearchPath, '--serve'], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(__filename),
  });

  child.unref();

  // Wait for server to be ready (up to 5 seconds)
  const maxWait = 5000;
  const checkInterval = 100;
  let waited = 0;

  while (waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waited += checkInterval;

    if (await isServerRunning()) {
      console.error(`[AutoStart] Server ready in ${waited}ms`);
      return true;
    }
  }

  console.error('[AutoStart] Server startup timeout, using cold start');
  return false;
}
