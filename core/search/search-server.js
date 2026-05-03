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

// =============================================================================
// Server constants
// =============================================================================

export const SEARCH_SERVER_PORT = 9876;
export const SEARCH_SERVER_SOCKET = process.env.SWEET_SEARCH_SOCKET_PATH || '/tmp/sweet-search.sock';
export const SEARCH_SERVER_SOCKET_LEGACY = '/tmp/search.sock';
export const SEARCH_SERVER_PIDFILE = '/tmp/sweet-search-server.pid';
export const SEARCH_SERVER_TIMEOUT_MS = 30_000;
export const SEARCH_SERVER_MAX_URL_LENGTH = 16_384;
export const SEARCH_SERVER_MAX_QUERY_LENGTH = 2_000;

function buildTextSearchResponse(results, stats, totalTime, { summary = false, mid = false } = {}) {
  const routeMode = stats?.routing?.mode || 'auto';
  const icon = routeMode === 'lexical' ? '⚡' : routeMode === 'semantic' ? '🧠' : '✨';
  const W = '\x1b[1;38;5;231m';
  const D = '\x1b[38;5;245m';
  const G = '\x1b[38;5;114m';
  const R = '\x1b[0m';
  const Y = '\x1b[38;5;220m';
  const C = '\x1b[38;5;51m';

  let out = `  ${icon} ${W}${routeMode}${R} ${D}|${R} ${W}${totalTime}ms${R} ${G}●${R}\n`;

  out += '\n';

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

        // Agent mode: return the packaged response directly as JSON
        if (searchResult.format === 'agent') {
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
            const out = buildTextSearchResponse(results, stats, totalTime, { summary, mid });
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status,
        warm: serverReady,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
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
      try { await fs.unlink(SEARCH_SERVER_PIDFILE); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
      try { await fs.unlink(SEARCH_SERVER_SOCKET); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
      try { await fs.unlink(SEARCH_SERVER_SOCKET_LEGACY); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
      process.exit(0);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Use GET /search?q=<query>&mode=auto&k=10\n');
    }
  };

  // TCP server (port 9876) - backward compatible
  tcpServer = http.createServer(handleRequest);
  tcpServer.setTimeout(SEARCH_SERVER_TIMEOUT_MS);
  if ('requestTimeout' in tcpServer) tcpServer.requestTimeout = SEARCH_SERVER_TIMEOUT_MS;
  if ('headersTimeout' in tcpServer) tcpServer.headersTimeout = SEARCH_SERVER_TIMEOUT_MS + 5_000;
  tcpServer.listen(SEARCH_SERVER_PORT);
  console.log(`[Server] TCP listening on http://localhost:${SEARCH_SERVER_PORT}`);

  // Unix socket server (/tmp/sweet-search.sock) - 30-50% faster
  unixServer = http.createServer(handleRequest);
  unixServer.setTimeout(SEARCH_SERVER_TIMEOUT_MS);
  if ('requestTimeout' in unixServer) unixServer.requestTimeout = SEARCH_SERVER_TIMEOUT_MS;
  if ('headersTimeout' in unixServer) unixServer.headersTimeout = SEARCH_SERVER_TIMEOUT_MS + 5_000;
  try { await fs.unlink(SEARCH_SERVER_SOCKET); } catch (err) {
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
      unixServer.listen(SEARCH_SERVER_SOCKET);
    });
  } finally {
    process.umask(prevUmask);
  }
  // Belt-and-suspenders: also chmod explicitly in case umask was ineffective.
  try { (await import('node:fs')).chmodSync(SEARCH_SERVER_SOCKET, 0o700); } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }
  console.log(`[Server] Unix socket listening on ${SEARCH_SERVER_SOCKET}`);
  console.log(`[Server] Fast access: curl --unix-socket ${SEARCH_SERVER_SOCKET} "http://localhost/search?q=query"`);

  // Legacy socket symlink for backward compatibility (/tmp/search.sock -> /tmp/sweet-search.sock)
  try { await fs.unlink(SEARCH_SERVER_SOCKET_LEGACY); } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }
  try { await fs.symlink(SEARCH_SERVER_SOCKET, SEARCH_SERVER_SOCKET_LEGACY); } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  console.log('[Server] Initializing indexes (one-time cost)...');
  (async () => {
    try {
      await searcher.init();
      initTimeMs = Date.now() - initStartedAt;
      serverReady = true;
      await fs.writeFile(SEARCH_SERVER_PIDFILE, process.pid.toString(), { mode: 0o644 });
      console.log(`[Server] Indexes loaded in ${initTimeMs}ms`);
    } catch (err) {
      initError = err;
      initTimeMs = Date.now() - initStartedAt;
      console.error(`[Server] Initialization failed after ${initTimeMs}ms: ${err?.message || err}`);
    }
  })();

  // Alias for graceful shutdown
  const server = tcpServer;

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    tcpServer.close();
    unixServer.close();
    searcher.close();
    try { await fs.unlink(SEARCH_SERVER_PIDFILE); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    try { await fs.unlink(SEARCH_SERVER_SOCKET); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    try { await fs.unlink(SEARCH_SERVER_SOCKET_LEGACY); } catch (err) {
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

    const url = `http://localhost:${SEARCH_SERVER_PORT}/search?${params.toString()}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Invalid server response'));
        }
      });
    }).on('error', reject);
  });
}

export async function isServerRunning() {
  try {
    const http = await import('http');
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${SEARCH_SERVER_PORT}/health`, (res) => {
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
