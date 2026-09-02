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
import { existsSync, realpathSync } from 'fs';
import path from 'node:path';
import { LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { clearCache } from '../embedding/embedding-cache.js';
import { createSupervisionState, runSupervisionTick } from '../indexing/maintainer-launcher.mjs';
import { projectSocketPath, projectPidFile, tcpPort, resolveProjectRoot } from './server-identity.js';
import {
  AgentSpanLedger,
  applyReadOmissionDecisions,
  collectAgentShownSpans,
  collectReadShownSpans,
  collectSemanticShownSpans,
  exactRereadOmissionEnabled,
  flagEnabled,
  resolveAgentSessionId,
  validAgentSessionId,
} from './agent-span-ledger.js';
import {
  upsertSelf as registryUpsertSelf,
  touchSelf as registryTouchSelf,
  removeSelf as registryRemoveSelf,
  pruneAndList as registryPruneAndList,
  selectEvictionTargets as registrySelectEvictionTargets,
} from './daemon-registry.js';
import { renderRegexDialectHint } from './regex-dialect.js';
import {
  executeSearchBatch,
  searchBatchRequiresServerReady,
  validateSearchBatchRequest,
} from './search-batch.js';
import { renderSearchBatchCliResult } from './search-batch-format.js';
import { lineGutterEnabled, numberCodeLines, resolveGutterForm } from './search-read.js';

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
export const SEARCH_SERVER_MAX_READ_PATH_LENGTH = 8_192;
const AGENT_SPAN_BODY_MAX_BYTES = 64 * 1024;
export const SEARCH_BATCH_BODY_MAX_BYTES = 64 * 1024;

const AGENT_FORMATS = new Set(['agent', 'agent_preview', 'agent_full', 'agent_full_xl']);

export function resolveAgentSearchRequest(rawFormat, agentRequested = false) {
  const explicit = AGENT_FORMATS.has(rawFormat) ? rawFormat : undefined;
  const requested = agentRequested === true;
  return {
    agentFormat: explicit || (requested ? 'agent' : undefined),
    renderText: requested && rawFormat === 'text' && !explicit,
  };
}

function canonicalProjectRoot(root) {
  const resolved = path.resolve(root || process.cwd());
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function parseFiniteNumber(value, name) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
  return n;
}

function parseInteger(value, name) {
  if (value == null || value === '') return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function parseBoundedSearchInteger(value, name, max) {
  if (value == null || value === '') return 0;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) throw new Error(`${name} must be <= ${max}`);
  return n;
}

function reusableLateInteractionIndex(searcher) {
  const idx = searcher?.lateInteractionIndex || null;
  if (!idx) return null;
  if (idx.modelMismatch === true) return null;
  if (!idx.documents || idx.documents.size === 0) return null;
  return idx;
}

function readSemanticError(status, message, extra = {}) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: message, ...extra }),
  };
}

export function buildAgentSpanDaemonResponse(payload, {
  isUnixSocket = false,
  ledger = null,
} = {}) {
  if (!isUnixSocket) return readSemanticError(403, '/agent-spans is only available via Unix socket');
  if (!ledger || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return readSemanticError(400, 'Invalid agent-span request');
  }
  const { operation, sessionId, force = false } = payload;
  if (!validAgentSessionId(sessionId)) return readSemanticError(400, 'Invalid session id');
  if (operation === 'reset' || operation === 'drop') {
    ledger.reset(sessionId);
    return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) };
  }
  if (operation !== 'observe' && operation !== 'read') {
    return readSemanticError(400, 'Invalid agent-span operation');
  }
  if (!Array.isArray(payload.spans) || payload.spans.length > 20) {
    return readSemanticError(400, 'Invalid agent-span receipts');
  }
  if ((payload.query != null
      && (typeof payload.query !== 'string' || payload.query.length > SEARCH_SERVER_MAX_QUERY_LENGTH))
      || (payload.regex != null
        && (typeof payload.regex !== 'string' || payload.regex.length > SEARCH_SERVER_MAX_QUERY_LENGTH))) {
    return readSemanticError(400, 'Invalid agent-span query context');
  }

  const call = ledger.beginCall(sessionId);
  if (call == null) return readSemanticError(400, 'Invalid session id');
  ledger.rememberQueryAtCall(sessionId, call, payload.query, payload.regex);
  const decisions = operation === 'read'
    ? ledger.decideAndObserveAtCall(sessionId, call, payload.spans, { force: force === true })
    : (ledger.observeAtCall(sessionId, call, payload.spans), []);
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      call,
      decisions,
      queryEvidence: ledger.queryEvidence(sessionId),
    }),
  };
}

export async function buildSearchBatchDaemonResponse(payload, {
  isUnixSocket = false,
  serverReady = false,
  initError = null,
  searcher = null,
  executeBatchFn = executeSearchBatch,
} = {}) {
  if (!isUnixSocket) return readSemanticError(403, '/batch is only available via Unix socket');
  const daemonProjectRoot = searcher?.projectRoot || process.cwd();
  let plan;
  try {
    plan = validateSearchBatchRequest(payload, { daemonProjectRoot });
  } catch (err) {
    return readSemanticError(err.status || 400, err.message || 'Invalid batch request');
  }
  if (!serverReady && searchBatchRequiresServerReady(plan)) {
    const reason = initError?.message
      ? `Server initialization failed: ${initError.message}`
      : 'Server is starting, please retry';
    return readSemanticError(503, reason, { status: initError ? 'failed' : 'starting' });
  }
  try {
    const result = await executeBatchFn(payload, { daemonProjectRoot, searcher });
    const responseResult = result && typeof result === 'object' && !Array.isArray(result)
      ? { ...result, cliOutput: renderSearchBatchCliResult(result) }
      : { result, cliOutput: renderSearchBatchCliResult(result) };
    return { status: 200, contentType: 'application/json', body: JSON.stringify(responseResult) };
  } catch (err) {
    return readSemanticError(err.status || 500, err.message || 'Batch execution failed');
  }
}

export async function readBoundedJsonBody(req, maxBytes = AGENT_SPAN_BODY_MAX_BYTES) {
  const declared = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    const err = new Error('Request body too large');
    err.status = 413;
    throw err;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      const err = new Error('Request body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('Invalid JSON body');
    err.status = 400;
    throw err;
  }
}

function beginAgentSpanUrlCall(url, ledger, { enabled = true } = {}) {
  if (!enabled || !ledger || !flagEnabled(url.searchParams.get('exactRereadOmission'))) return null;
  const sessionId = url.searchParams.get('agentSessionId');
  if (!validAgentSessionId(sessionId)) return null;
  const call = ledger.beginCall(sessionId);
  return call == null ? null : { sessionId, call };
}

export async function buildReadSemanticDaemonResponse(reqUrl, {
  isUnixSocket = false,
  serverReady = false,
  initError = null,
  searcher = null,
  readSemanticFn = null,
  formatReadSemanticResultFn = null,
  agentSpanLedger = null,
} = {}) {
  if (!isUnixSocket) {
    return readSemanticError(403, '/read-semantic is only available via Unix socket');
  }
  if (!serverReady) {
    const reason = initError?.message
      ? `Server initialization failed: ${initError.message}`
      : 'Server is starting, please retry';
    return readSemanticError(503, reason, { status: initError ? 'failed' : 'starting' });
  }
  if (reqUrl.length > SEARCH_SERVER_MAX_URL_LENGTH) {
    return readSemanticError(414, `Request URL too long (max ${SEARCH_SERVER_MAX_URL_LENGTH} chars)`);
  }

  let url;
  try {
    url = new URL(reqUrl, `http://localhost:${SEARCH_SERVER_PORT}`);
  } catch {
    return readSemanticError(400, 'Invalid request URL');
  }

  const file = url.searchParams.get('path') || url.searchParams.get('file') || '';
  const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
  const requestedRoot = url.searchParams.get('projectRoot') || '';
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'agent';

  if (!file) return readSemanticError(400, 'Missing path parameter ?path=');
  if (file.length > SEARCH_SERVER_MAX_READ_PATH_LENGTH) {
    return readSemanticError(413, `Path too long (max ${SEARCH_SERVER_MAX_READ_PATH_LENGTH} chars)`);
  }
  if (!query) return readSemanticError(400, 'Missing query parameter ?q=');
  if (query.length > SEARCH_SERVER_MAX_QUERY_LENGTH) {
    return readSemanticError(413, `Query too long (max ${SEARCH_SERVER_MAX_QUERY_LENGTH} chars)`);
  }
  if (!requestedRoot) return readSemanticError(400, 'Missing projectRoot parameter');

  const serverRoot = canonicalProjectRoot(searcher?.projectRoot || process.cwd());
  const clientRoot = canonicalProjectRoot(requestedRoot);
  if (serverRoot !== clientRoot) {
    return readSemanticError(409, 'Daemon project root mismatch', {
      serverProjectRoot: serverRoot,
      requestedProjectRoot: clientRoot,
    });
  }

  let topK; let threshold; let contextLines; let maxChars; let maxTokens;
  try {
    topK = parseInteger(url.searchParams.get('k') ?? url.searchParams.get('topK'), 'topK');
    threshold = parseFiniteNumber(url.searchParams.get('threshold'), 'threshold');
    contextLines = parseInteger(url.searchParams.get('contextLines') ?? url.searchParams.get('context'), 'contextLines');
    maxChars = parseInteger(url.searchParams.get('maxChars'), 'maxChars');
    maxTokens = parseInteger(url.searchParams.get('maxTokens'), 'maxTokens');
  } catch (err) {
    return readSemanticError(400, err.message);
  }
  const verbose = url.searchParams.get('verbose') === 'true';
  const agentSpanCall = beginAgentSpanUrlCall(url, agentSpanLedger, { enabled: format === 'agent' });

  try {
    let readSemantic = readSemanticFn;
    let formatReadSemanticResult = formatReadSemanticResultFn;
    if (!readSemantic || !formatReadSemanticResult) {
      const mod = await import('./search-read-semantic.js');
      readSemantic = readSemantic || mod.readSemantic;
      formatReadSemanticResult = formatReadSemanticResult || mod.formatReadSemanticResult;
    }
    const result = await readSemantic({
      path: file,
      query,
      projectRoot: serverRoot,
      topK,
      threshold,
      contextLines,
      maxChars,
      maxTokens,
      verbose,
      _lateInteractionIndex: reusableLateInteractionIndex(searcher),
    });
    if (agentSpanCall) {
      const spans = collectSemanticShownSpans(result, { projectRoot: serverRoot });
      agentSpanLedger.rememberQueryAtCall(agentSpanCall.sessionId, agentSpanCall.call, query);
      agentSpanLedger.observeAtCall(agentSpanCall.sessionId, agentSpanCall.call, spans);
    }
    const body = formatReadSemanticResult(result, format);
    return {
      status: result?.ok === false ? 404 : 200,
      contentType: format === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
      body: format === 'json' ? body : `${body}\n`,
    };
  } catch (err) {
    return readSemanticError(500, err.message || String(err));
  }
}

// Daemon handler for `trace` — structural callers/callees/impact served from the
// warm daemon so the native client pays no node startup + the code-graph.db is
// page-cache warm. Byte-identical to the in-process path (search-trace.js
// handleTraceCli): SAME traceSymbol + formatStructuralContext, with the banner
// emitted client-side (native binary), exactly like /read-semantic.
export async function buildTraceDaemonResponse(reqUrl, {
  isUnixSocket = false,
  serverReady = false,
  initError = null,
  searcher = null,
  agentSpanLedger = null,
} = {}) {
  if (!isUnixSocket) {
    return readSemanticError(403, '/trace is only available via Unix socket');
  }
  if (!serverReady) {
    const reason = initError?.message
      ? `Server initialization failed: ${initError.message}`
      : 'Server is starting, please retry';
    return readSemanticError(503, reason, { status: initError ? 'failed' : 'starting' });
  }
  if (reqUrl.length > SEARCH_SERVER_MAX_URL_LENGTH) {
    return readSemanticError(414, `Request URL too long (max ${SEARCH_SERVER_MAX_URL_LENGTH} chars)`);
  }
  let url;
  try {
    url = new URL(reqUrl, `http://localhost:${SEARCH_SERVER_PORT}`);
  } catch {
    return readSemanticError(400, 'Invalid request URL');
  }

  const symbol = url.searchParams.get('symbol') || url.searchParams.get('q') || '';
  const requestedRoot = url.searchParams.get('projectRoot') || '';
  const json = url.searchParams.get('format') === 'json';

  if (!symbol) return readSemanticError(400, 'Missing symbol parameter ?symbol=');
  if (symbol.length > SEARCH_SERVER_MAX_QUERY_LENGTH) {
    return readSemanticError(413, `Symbol too long (max ${SEARCH_SERVER_MAX_QUERY_LENGTH} chars)`);
  }
  if (!requestedRoot) return readSemanticError(400, 'Missing projectRoot parameter');

  const serverRoot = canonicalProjectRoot(searcher?.projectRoot || process.cwd());
  const clientRoot = canonicalProjectRoot(requestedRoot);
  if (serverRoot !== clientRoot) {
    return readSemanticError(409, 'Daemon project root mismatch', {
      serverProjectRoot: serverRoot,
      requestedProjectRoot: clientRoot,
    });
  }

  const filePath = url.searchParams.get('file') || undefined;
  const queryHint = url.searchParams.get('hint') || '';
  let maxDepth; let tokenBudget;
  try {
    maxDepth = parseInteger(url.searchParams.get('depth'), 'depth');
    tokenBudget = parseInteger(url.searchParams.get('budget'), 'budget');
  } catch (err) {
    return readSemanticError(400, err.message);
  }
  const agentSpanCall = beginAgentSpanUrlCall(url, agentSpanLedger, { enabled: !json });

  try {
    const { traceSymbol, formatStructuralContext } = await import('./search-trace.js');
    // Mirror search-trace.js parseArgs defaults exactly (maxDepth 3, adaptive
    // budget when null) so the result is identical to the in-process call.
    const result = traceSymbol(symbol, {
      projectRoot: serverRoot,
      filePath,
      queryHint,
      maxDepth: maxDepth ?? 3,
      tokenBudget: tokenBudget ?? null,
    });
    if (agentSpanCall) {
      agentSpanLedger.rememberQueryAtCall(
        agentSpanCall.sessionId,
        agentSpanCall.call,
        `${symbol} ${queryHint}`.trim(),
      );
      agentSpanLedger.observeAtCall(agentSpanCall.sessionId, agentSpanCall.call, []);
    }
    // handleTraceCli writes `console.log(json ? JSON : formatStructuralContext)`,
    // i.e. body + exactly one trailing newline in BOTH modes.
    const body = json ? JSON.stringify(result, null, 2) : formatStructuralContext(result);
    return {
      status: 200,
      contentType: json ? 'application/json' : 'text/plain; charset=utf-8',
      body: `${body}\n`,
    };
  } catch (err) {
    return readSemanticError(500, err.message || String(err));
  }
}

// Daemon handler for `read` — filesystem-grounded multi-file reader served from
// the warm daemon (no per-call node startup). Byte-identical to the in-process
// path (search-read.js handleReadCli): SAME readFiles + formatReadResults.
// readFiles statSync's every call (stat-keyed cache absPath|size|mtimeMs), so
// read-your-writes freshness is preserved across the daemon boundary.
export async function buildReadDaemonResponse(reqUrl, {
  isUnixSocket = false,
  serverReady = false,
  initError = null,
  searcher = null,
  agentSpanLedger = null,
} = {}) {
  if (!isUnixSocket) {
    return readSemanticError(403, '/read is only available via Unix socket');
  }
  // NOTE: /read deliberately does NOT gate on serverReady. `read` returns exact
  // file bytes from node:fs (search-read.js) and never touches the searcher /
  // indexes — the only index reference is `searcher?.projectRoot` in the root
  // check below, already null-tolerant. Gating it on init readiness made `read`
  // fail (503 → native client exit) during the cold-start window for no reason
  // (Codex finding). read-semantic/trace DO need indexes and keep their gate
  // (with a bounded readiness-wait added at the dispatch site).
  if (reqUrl.length > SEARCH_SERVER_MAX_URL_LENGTH) {
    return readSemanticError(414, `Request URL too long (max ${SEARCH_SERVER_MAX_URL_LENGTH} chars)`);
  }
  let url;
  try {
    url = new URL(reqUrl, `http://localhost:${SEARCH_SERVER_PORT}`);
  } catch {
    return readSemanticError(400, 'Invalid request URL');
  }

  const paths = url.searchParams.getAll('path');
  const requestedRoot = url.searchParams.get('projectRoot') || '';
  const fmtParam = url.searchParams.get('format') || 'agent';
  const format = (fmtParam === 'json' || fmtParam === 'raw') ? fmtParam : 'agent';
  const exactRereadOmission = format === 'agent'
    && flagEnabled(url.searchParams.get('exactRereadOmission'));
  const agentSessionId = url.searchParams.get('agentSessionId');
  const force = url.searchParams.get('force') === 'true';

  if (paths.length === 0) return readSemanticError(400, 'Missing path parameter ?path=');
  if (paths.length > 20) return readSemanticError(413, 'read accepts at most 20 files');
  for (const p of paths) {
    if (p.length > SEARCH_SERVER_MAX_READ_PATH_LENGTH) {
      return readSemanticError(413, `Path too long (max ${SEARCH_SERVER_MAX_READ_PATH_LENGTH} chars)`);
    }
  }
  if (!requestedRoot) return readSemanticError(400, 'Missing projectRoot parameter');

  const serverRoot = canonicalProjectRoot(searcher?.projectRoot || process.cwd());
  const clientRoot = canonicalProjectRoot(requestedRoot);
  if (serverRoot !== clientRoot) {
    return readSemanticError(409, 'Daemon project root mismatch', {
      serverProjectRoot: serverRoot,
      requestedProjectRoot: clientRoot,
    });
  }

  let startLine; let endLine;
  try {
    startLine = parseInteger(url.searchParams.get('startLine'), 'startLine');
    endLine = parseInteger(url.searchParams.get('endLine'), 'endLine');
  } catch (err) {
    return readSemanticError(400, err.message);
  }
  const includeMetadata = url.searchParams.get('metadata') !== 'false';
  const wantsRange = startLine != null || endLine != null;
  if (wantsRange && paths.length > 1) {
    return readSemanticError(400, '--lines requires exactly one path');
  }
  const files = paths.map(p => ({
    path: p,
    startLine: wantsRange ? startLine : undefined,
    endLine: wantsRange ? endLine : undefined,
  }));

  try {
    const { readFiles, formatReadResults } = await import('./search-read.js');
    // Agent-facing read route: span gate on. Measurement formats still veto it
    // inside spanExpandEnabled().
    const out = await readFiles(files, {
      projectRoot: serverRoot, includeMetadata, spanExpand: true, format,
    });
    let queryEvidence = null;
    if (exactRereadOmission && agentSpanLedger && validAgentSessionId(agentSessionId)) {
      const spans = collectReadShownSpans(out, { projectRoot: serverRoot });
      const agentSpanCall = beginAgentSpanUrlCall(url, agentSpanLedger);
      if (agentSpanCall) {
        const compactDecisions = agentSpanLedger.decideAndObserveAtCall(
          agentSpanCall.sessionId, agentSpanCall.call, spans, { force },
        );
        const decisions = Array.from({ length: out.files.length }, () => ({ omit: false }));
        spans.forEach((span, index) => { decisions[span.resultIndex] = compactDecisions[index]; });
        applyReadOmissionDecisions(out, decisions);
        queryEvidence = agentSpanLedger.queryEvidence(agentSpanCall.sessionId);
      }
    }
    const body = formatReadResults(out, format, { surface: 'cli', queryEvidence });
    // handleReadCli appends '\n' for non-json output (the extra process.stdout
    // .write('\n')); json gets no trailing newline. Mirror exactly.
    const allFailed = out.files.length > 0 && out.files.every(f => !f.ok);
    return {
      status: allFailed ? 404 : 200,
      contentType: format === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
      body: format === 'json' ? body : `${body}\n`,
    };
  } catch (err) {
    return readSemanticError(500, err.message || String(err));
  }
}

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

  const regexDialectNote = renderRegexDialectHint(stats?.regexDialectHint);
  if (regexDialectNote) out += `${regexDialectNote}\n`;

  return out;
}

/** Render a packaged agent response for the native captured-output CLI. */
export function renderAgentSearchResponse(response) {
  const results = response?.results || [];
  const routing = response?.stats?.routing || {};
  const routedMode = routing.mode || response?.mode || 'auto';
  let out = `# sweet-search: routed=${routedMode} budget=${response?.tokenBudget ?? '?'} used=${response?.tokensUsed ?? '?'} results=${results.length} subMode=${response?.subMode ?? 'agent'}\n`;
  if (response?.confidence) {
    out += `# confidence=${response.confidence}${response.confidenceReason ? ` (${response.confidenceReason})` : ''}`;
    if (response.sufficiencyVerdict) out += ` sufficient=${response.sufficiencyVerdict}`;
    out += '\n';
  }
  for (const result of results) {
    const symbol = result.symbol ? ` [${result.symbolType || 'code'}: ${result.symbol}]` : '';
    const kind = result.expansionKind ? ` kind=${result.expansionKind}` : '';
    const stale = result.stale ? ' STALE' : '';
    out += `\n## #${result.rank} ${result.file}:${result.startLine}-${result.endLine}${symbol} (${result.presentation}${kind}${stale}) score=${(result.score || 0).toFixed(3)}\n`;
    if (result.headerContext) out += `### imports\n\`\`\`\n${result.headerContext}\n\`\`\`\n`;
    if (result.code) {
      // Line-number gutter (default ON for agent output; benchmark path is JSON,
      // never here). Numbers start at the result's own startLine so the agent can
      // target exact edit spans directly from a search hit — same grounding
      // ss-read now provides. Skipped for tiny spans.
      const body = (lineGutterEnabled() && String(result.code).split('\n').length >= 15)
        ? numberCodeLines(result.code, result.startLine || 1)
        : result.code;
      out += `\`\`\`\n${body}\n\`\`\`\n`;
    } else if (result.summary) out += `${result.summary}\n`;
    if (result.neighbors?.rendered) {
      out += `### related (1-hop graph, ~${result.neighbors.tokens} tok)\n${result.neighbors.rendered}\n`;
    }
    if (result.sameFile?.rendered) out += `${result.sameFile.rendered}\n`;
    if (result.continuation?.rendered) {
      out += `${result.continuation.rendered}\n`;
      if (result.continuation.kind === 'symbol' && result.continuation.code) {
        out += `\`\`\`\n${result.continuation.code}\n\`\`\`\n`;
      }
    }
    if (result.familyManifest?.rendered) out += `${result.familyManifest.rendered}\n`;
  }
  if (results.length === 0) out += '(no matches)\n';
  const regexDialectNote = renderRegexDialectHint(response?.stats?.regexDialectHint);
  if (regexDialectNote) out += `${regexDialectNote}\n`;
  return out;
}

function buildJsonSearchResponse(results, stats, totalTime, extra = {}) {
  return JSON.stringify({
    results,
    stats: { ...stats, server_ms: totalTime },
    ...extra,
  });
}

// =============================================================================
// Server implementation
// =============================================================================

export async function startServer() {
  const http = await import('http');

  // Decide the line-number gutter form NOW, while the CLI that spawned us is
  // still alive and the process ancestry still reaches the agent harness. A
  // detached daemon is reparented to init once that parent exits, and would
  // otherwise resolve to the default form on its first render. The decision is
  // exported into our env so maintainers we spawn inherit it too.
  resolveGutterForm();

  // Per-project server identity (C3). The Unix socket + pidfile are derived from
  // the canonical project root so each project gets its own server and never
  // answers another project's queries. TCP is opt-in (off by default) — a single
  // global TCP port both collides (EADDRINUSE) and leaks across projects.
  const socketPath = projectSocketPath();
  const pidFile = projectPidFile();
  const httpPort = tcpPort();

  // ---------------------------------------------------------------------------
  // Idempotency guard (lifecycle fix). Historically the default `--serve`
  // path unconditionally `fs.unlink`'d the per-project socket and bound its
  // own, so every redundant invocation (Rust auto_start_server, Claude/Codex
  // SessionStart prewarm, benchmark warmups, manual `sweet-search --serve`)
  // silently stole the socket from the previous resident server and left it
  // memory-resident (~1–2 GB each, holding HNSW + vocab + float-vector
  // sidecar). 12 coexisting daemons cost ~15.6 GB before this guard.
  //
  // Probe BEFORE the expensive SweetSearch import: if a live daemon already
  // answers /health on our per-project socket, defer to it and exit cleanly
  // even when it is still initializing. A stale socket *file* with no listener
  // still falls through to the unlink+bind path below (existing behaviour
  // preserved for crash recovery).
  //
  // Deliberate replacement of a wrong-projectRoot daemon is handled by the
  // explicit ensureDaemonForProjectRoot() path (stopServer + autoSpawnServer),
  // not by startServer — this guard never steals from a live listener.
  // ---------------------------------------------------------------------------
  const existingHealth = await getServerHealth({ timeoutMs: 500 });
  if (existingHealth) {
    if (existingHealth.status === 'failed') {
      console.log(`[Server] Existing daemon on ${socketPath} reports failed initialization; requesting graceful restart.`);
      await stopServer({ timeoutMs: 2000 });
      const exited = await waitForServerExit({ timeoutMs: 5000, intervalMs: 200 });
      if (!exited) {
        console.log(`[Server] Existing failed daemon on ${socketPath} did not exit; refusing to steal its live socket.`);
        return;
      }
    } else {
      console.log(`[Server] Daemon already listening on ${socketPath} (status=${existingHealth.status ?? 'unknown'}); reusing existing instance (no spawn).`);
      return;
    }
  }

  // Dynamic import to avoid circular dependency
  const { default: SweetSearch } = await import('./sweet-search.js');

  const searcher = new SweetSearch({ verbose: false });
  const initStartedAt = Date.now();
  let serverReady = false;
  let initError = null;
  let initTimeMs = null;

  // Bounded readiness wait for the INDEX-DEPENDENT endpoints (read-semantic /
  // trace). The Unix socket is bound before searcher.init() finishes (below),
  // and the native client treats "connectable" as "ready" and fires its request
  // immediately — so a cold-start request used to hit a 503 and the client
  // exited (Codex finding). Waiting here (up to ~10s, or until a terminal
  // initError) turns that race into a short latency hit instead of a hard
  // failure. /read does NOT use this (it needs no indexes); /health is instant.
  const READINESS_WAIT_MS = 10_000;
  const waitForServerReady = async (budgetMs = READINESS_WAIT_MS) => {
    if (serverReady || initError) return;
    const deadline = Date.now() + budgetMs;
    while (!serverReady && !initError && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  // Track request count for periodic cache clearing in long-running sessions.
  let requestCount = 0;
  const CACHE_CLEAR_INTERVAL = 1000;  // Clear caches every 1000 requests
  let agentSpanLedger = null;

  let tcpServer;
  let unixServer;

  // ---------------------------------------------------------------------------
  // Daemon lifecycle (footprint bound). A warm per-repo daemon holds ~1–2 GB
  // (HNSW + vocab + float sidecar) and historically NEVER self-terminated, so
  // resident daemons accumulated unbounded across repos/sessions. Two bounds:
  //   (1) idle-TTL eviction (default ON): self-stop after no QUERY traffic for
  //       SWEET_SEARCH_DAEMON_IDLE_TTL_MS. Tracked by WALL CLOCK, not
  //       requestCount, because an idle daemon never increments requestCount.
  //   (2) resident-daemon LRU cap (default OFF; SWEET_SEARCH_MAX_DAEMONS): a
  //       hard ceiling on concurrently-resident daemons via a shared registry.
  // NOTE: lastActivityMs is set ONLY by real query routes (/search,
  // /read-semantic) — never by /health or /stop, so liveness probes (prewarm,
  // isServerRunning) can never keep an idle daemon alive.
  // ---------------------------------------------------------------------------
  let lastActivityMs = Date.now();
  let idleTimer = null;
  let registryTimer = null;
  let shuttingDown = false;

  // Close a server, letting in-flight requests finish but never letting an idle
  // keep-alive socket block exit (bounded grace, then resolve regardless).
  const closeServerGracefully = (srv, graceMs = 3000) => new Promise((resolve) => {
    if (!srv) { resolve(); return; }
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try {
      srv.close(done);
      // Drop idle keep-alive connections immediately; active requests still drain.
      srv.closeIdleConnections?.();
    } catch { done(); return; }
    const t = setTimeout(done, graceMs);
    if (t.unref) t.unref();
  });

  // Single idempotent teardown shared by SIGINT, /stop, and the idle timer.
  const gracefulShutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    if (registryTimer) { clearInterval(registryTimer); registryTimer = null; }
    if (capEnabled) {
      try { await registryRemoveSelf(process.pid); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] registry remove: ${err?.message || err}\n`);
      }
    }
    await closeServerGracefully(tcpServer);
    await closeServerGracefully(unixServer);
    try { searcher.close(); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] searcher close: ${err?.message || err}\n`);
    }
    try { await fs.unlink(pidFile); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    try { await fs.unlink(socketPath); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    console.log(`[Server] Shutdown (${reason}).`);
    process.exit(0);
  };

  // Resident-daemon cap (default OFF). Read once at startup to gate registry
  // participation; the numeric cap is re-read per enforcement tick.
  const capEnabled = Number(process.env.SWEET_SEARCH_MAX_DAEMONS ?? 0) > 0;

  // Enforce the LRU cap: prune dead registry entries, then /stop the
  // least-recently-active peers that are NOT self until we're within the cap.
  const enforceDaemonCap = async () => {
    const cap = Number(process.env.SWEET_SEARCH_MAX_DAEMONS ?? 0);
    if (!(cap > 0)) return;
    let live;
    try { live = await registryPruneAndList(); } catch { return; }
    if (!Array.isArray(live) || live.length <= cap) return;
    const targets = registrySelectEvictionTargets(live, process.pid, live.length - cap);
    for (const t of targets) {
      try { await sendStopToSocket(t.socketPath); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] cap evict ${t?.socketPath}: ${err?.message || err}\n`);
      }
    }
  };

  // Shared request handler for both TCP and Unix socket
  const handleRequest = async (req, res) => {
    const reqUrl = req.url || '';

    const componentState = {
      graphIndex: Boolean(searcher.hasGraphIndex),
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

    if (req.method === 'POST' && reqUrl === '/batch') {
      if (req.socket.remoteAddress) {
        const response = await buildSearchBatchDaemonResponse(null, { isUnixSocket: false });
        res.writeHead(response.status, { 'Content-Type': response.contentType });
        res.end(response.body);
        return;
      }
      let response;
      try {
        const payload = await readBoundedJsonBody(req, SEARCH_BATCH_BODY_MAX_BYTES);
        response = await buildSearchBatchDaemonResponse(payload, {
          isUnixSocket: true, serverReady, initError, searcher,
        });
        if (response.status === 503 && !initError) {
          await waitForServerReady();
          response = await buildSearchBatchDaemonResponse(payload, {
            isUnixSocket: true, serverReady, initError, searcher,
          });
        }
        if (response.status === 200) lastActivityMs = Date.now();
      } catch (err) {
        response = readSemanticError(err.status || 400, err.message || 'Invalid request body');
      }
      res.writeHead(response.status, { 'Content-Type': response.contentType });
      res.end(response.body);
    } else if (req.method === 'POST' && reqUrl === '/agent-spans') {
      if (req.socket.remoteAddress) {
        const response = readSemanticError(403, '/agent-spans is only available via Unix socket');
        res.writeHead(response.status, { 'Content-Type': response.contentType });
        res.end(response.body);
        return;
      }
      let response;
      try {
        const payload = await readBoundedJsonBody(req);
        response = buildAgentSpanDaemonResponse(payload, {
          isUnixSocket: true,
          ledger: agentSpanLedger ||= new AgentSpanLedger(),
        });
        if (response.status === 200 && (payload.operation === 'read' || payload.operation === 'observe')) {
          lastActivityMs = Date.now();
        }
      } catch (err) {
        response = readSemanticError(err.status || 400, err.message || 'Invalid request body');
      }
      res.writeHead(response.status, { 'Content-Type': response.contentType });
      res.end(response.body);
    } else if (req.method === 'GET' && reqUrl.startsWith('/search?')) {
      // Real query traffic — reset the idle-TTL clock (NOT /health or /stop).
      lastActivityMs = Date.now();
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
      const isUnixSocket = !req.socket.remoteAddress;
      if (isUnixSocket
          && (AGENT_FORMATS.has(url.searchParams.get('format'))
            || url.searchParams.get('agent') === 'true')
          && flagEnabled(url.searchParams.get('exactRereadOmission'))
          && !agentSpanLedger) {
        agentSpanLedger = new AgentSpanLedger();
      }
      const query = url.searchParams.get('q') || '';
      const mode = url.searchParams.get('mode') || 'auto';
      const topK = parseInt(url.searchParams.get('k') || '10', 10);
      const requestedRoot = url.searchParams.get('projectRoot') || '';
      if (requestedRoot.length > SEARCH_SERVER_MAX_READ_PATH_LENGTH) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Project root too long (max ${SEARCH_SERVER_MAX_READ_PATH_LENGTH} chars)` }));
        return;
      }
      if (requestedRoot) {
        const serverRoot = canonicalProjectRoot(searcher.projectRoot || process.cwd());
        const clientRoot = canonicalProjectRoot(requestedRoot);
        if (serverRoot !== clientRoot) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Daemon project root mismatch',
            serverProjectRoot: serverRoot,
            requestedProjectRoot: clientRoot,
          }));
          return;
        }
      }

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
      // Repeatable: `--in A --in B` arrives as several fileFilter params and
      // every one is applied. A single value stays a plain string, so the
      // one-scope wire format is byte-identical to before.
      //
      // MEASURED REGRESSION (screen-v3-20260812): when this read a single value
      // with .get(), an array sent by the CLI was stringified by
      // URLSearchParams into "src,tests,docs" and matched a directory of that
      // literal name — i.e. nothing. Four multi-scope ss-grep calls on
      // pytask-dev__pytask-210 returned 0 matches for patterns that are
      // certainly present. That is WORSE than the defect it replaced: the old
      // code silently used the first scope and at least returned its matches.
      const fileFilters = url.searchParams.getAll('fileFilter').filter(Boolean);
      const fileFilter = fileFilters.length > 1 ? fileFilters : (fileFilters[0] || undefined);
      if (fileFilters.some(f => f.length > SEARCH_SERVER_MAX_READ_PATH_LENGTH)) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `File filter too long (max ${SEARCH_SERVER_MAX_READ_PATH_LENGTH} chars)` }));
        return;
      }
      let perFileCap; let maxFiles;
      try {
        perFileCap = parseBoundedSearchInteger(url.searchParams.get('perFileCap'), 'perFileCap', 1000);
        maxFiles = parseBoundedSearchInteger(url.searchParams.get('maxFiles'), 'maxFiles', 1000);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      const fixedString = url.searchParams.get('fixedString') === 'true';
      const symbolType = url.searchParams.get('type') || '';
      const useLiteralFilter = url.searchParams.get('literalFilter') !== 'false';
      const useSparseGrams = url.searchParams.get('gramIndex') !== 'false';
      const globs = url.searchParams.getAll('glob');

      // Agent mode: context packaging (ColGrep agent format)
      const rawFormat = url.searchParams.get('format');
      const agentRequested = url.searchParams.get('agent') === 'true';
      const { agentFormat, renderText: renderAgentText } = resolveAgentSearchRequest(
        rawFormat,
        agentRequested,
      );
      const isAgentFormat = Boolean(agentFormat);
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
      const agentSpanCall = beginAgentSpanUrlCall(url, agentSpanLedger, {
        enabled: isUnixSocket && Boolean(agentFormat)
          && url.searchParams.get('trackAgentSpans') !== 'false',
      });

      try {
        const start = Date.now();
        const searchResult = await searcher.search(query, {
          k: topK,
          mode,
          regex,
          maxMatches,
          contextLines,
          fileFilter,
          perFileCap,
          maxFiles,
          fixedString,
          type: symbolType,
          globs,
          literalFilter: useLiteralFilter,
          gramIndex: useSparseGrams,
          expand,
          rerank,
          fusion,
          useLateInteraction,
          _isAgentFormat: isAgentFormat,
          ...(agentFormat && { format: agentFormat, tokenBudget }),
        });

        // Agent mode: return the packaged response directly as JSON.
        // Inject server-side repo identity so callers can prove which repo
        // produced these results (defends against multi-repo bench reusing
        // a stale daemon — see eval/agent-read-workflows/run-bench.js).
        if (searchResult.format === 'agent') {
          if (agentSpanCall) {
            agentSpanLedger.rememberQueryAtCall(
              agentSpanCall.sessionId,
              agentSpanCall.call,
              query,
              regex,
            );
            const spans = collectAgentShownSpans(searchResult.results, {
              projectRoot: searcher.projectRoot || process.cwd(),
            });
            agentSpanLedger.observeAtCall(agentSpanCall.sessionId, agentSpanCall.call, spans);
          }
          searchResult.serverProjectRoot = searcher.projectRoot || null;
          searchResult.serverPid = process.pid;
          if (renderAgentText) {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(renderAgentSearchResponse(searchResult));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(searchResult));
          }
        } else {
          if (agentSpanCall) {
            agentSpanLedger.rememberQueryAtCall(
              agentSpanCall.sessionId,
              agentSpanCall.call,
              query,
              regex,
            );
            agentSpanLedger.observeAtCall(agentSpanCall.sessionId, agentSpanCall.call, []);
          }
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
            res.end(buildJsonSearchResponse(results, stats, totalTime, {
              ...(searchResult.fileSummary ? { fileSummary: searchResult.fileSummary } : {}),
              ...(searchResult.familyManifest ? { familyManifest: searchResult.familyManifest } : {}),
            }));
          }
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'GET' && reqUrl.startsWith('/read-semantic?')) {
      // Real query traffic — reset the idle-TTL clock (NOT /health or /stop).
      lastActivityMs = Date.now();
      if (!req.socket.remoteAddress
          && reqUrl.includes('exactRereadOmission=true')
          && !agentSpanLedger) {
        agentSpanLedger = new AgentSpanLedger();
      }
      // read-semantic needs the indexes — wait out the cold-start init race
      // (bounded) so a freshly-spawned daemon doesn't 503 the first request.
      await waitForServerReady();
      const response = await buildReadSemanticDaemonResponse(reqUrl, {
        isUnixSocket: !req.socket.remoteAddress,
        serverReady,
        initError,
        searcher,
        agentSpanLedger,
      });
      res.writeHead(response.status, { 'Content-Type': response.contentType });
      res.end(response.body);
    } else if (req.method === 'GET' && reqUrl.startsWith('/trace?')) {
      // Real query traffic — reset the idle-TTL clock (NOT /health or /stop).
      lastActivityMs = Date.now();
      if (!req.socket.remoteAddress
          && reqUrl.includes('exactRereadOmission=true')
          && !agentSpanLedger) {
        agentSpanLedger = new AgentSpanLedger();
      }
      // trace needs the code-graph — wait out the cold-start init race (bounded)
      // so a freshly-spawned daemon doesn't 503 the first request.
      await waitForServerReady();
      const response = await buildTraceDaemonResponse(reqUrl, {
        isUnixSocket: !req.socket.remoteAddress,
        serverReady,
        initError,
        searcher,
        agentSpanLedger,
      });
      res.writeHead(response.status, { 'Content-Type': response.contentType });
      res.end(response.body);
    } else if (req.method === 'GET' && reqUrl.startsWith('/read?')) {
      // Real query traffic — reset the idle-TTL clock (NOT /health or /stop).
      lastActivityMs = Date.now();
      if (!req.socket.remoteAddress
          && reqUrl.includes('exactRereadOmission=true')
          && !agentSpanLedger) {
        agentSpanLedger = new AgentSpanLedger();
      }
      const response = await buildReadDaemonResponse(reqUrl, {
        isUnixSocket: !req.socket.remoteAddress,
        serverReady,
        initError,
        searcher,
        agentSpanLedger,
      });
      res.writeHead(response.status, { 'Content-Type': response.contentType });
      res.end(response.body);
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
      await gracefulShutdown('stop');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Use GET /search?q=<query>&mode=auto&k=10\n');
    }
  };

  // ---------------------------------------------------------------------------
  // Maintainer supervision (freshness bound).
  //
  // The maintainer stops itself after a long idle stretch on small-RAM hosts,
  // and until now nothing restarted it while this daemon stayed up — every
  // `launchMaintainer` call site runs at daemon STARTUP. The index then froze
  // silently: edited files returned zero hits and no error was logged anywhere.
  //
  // Supervision is driven from responses that have ALREADY been flushed, never
  // from the request path. `maybeSuperviseMaintainer` is called once per
  // response and, inside the rate-limit window, costs one integer comparison
  // and no syscalls — so it cannot show up in query latency.
  // ---------------------------------------------------------------------------
  const supervisionState = createSupervisionState();
  // Seed from the current activity stamp, NOT from 0. Seeded at 0 the very
  // first response of any kind — including the `/health` probe a client uses to
  // find out whether the daemon is up — would read as "new query traffic" and
  // supervise, while this daemon's own startup launch had not yet taken the
  // lock. That produced a second maintainer, which is exactly the duplication
  // the freshness-invariant tests exist to forbid.
  let lastSupervisedActivityMs = lastActivityMs;
  // The stamp as it was before any request arrived. Only real query routes move
  // lastActivityMs, so "it still equals this" is exactly "this repository has
  // never been queried", which the timer backstop must not mistake for use.
  const startupActivityMs = lastActivityMs;

  // Outcomes that settle the question for this burst of activity. Anything else
  // — rate-limited, the claim lost to a peer, a launch error — is RETRYABLE, and
  // must NOT consume the activity that triggered it. Consuming it
  // unconditionally meant a single query whose tick happened to be rate-limited
  // left an actively-used repository with no maintainer until the next query
  // arrived, which is the staleness bug wearing a smaller hat.
  const SETTLED_REASONS = new Set(['spawned', 'already-running', 'paused', 'opted-out', 'no-state-dir']);

  const maybeSuperviseMaintainer = ({ force = false } = {}) => {
    if (shuttingDown) return;
    // Only real query routes advance lastActivityMs, so /health and /stop never
    // trigger supervision — a liveness probe must not resurrect a maintainer for
    // a repository nobody is working in. `force` is the timer backstop, which
    // has already checked that this repo is in active use.
    const activityAtCall = lastActivityMs;
    if (!force && activityAtCall <= lastSupervisedActivityMs) return;
    // Defer off the response callback so no file system work is ever queued
    // ahead of the next request's handler.
    setImmediate(() => {
      try {
        const result = runSupervisionTick({ state: supervisionState, cwd: process.cwd() });
        // Mark the activity handled only once the answer is one that will not
        // change by trying again.
        if (SETTLED_REASONS.has(result?.reason)) lastSupervisedActivityMs = activityAtCall;
      } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] maintainer supervision: ${err?.message || err}\n`);
      }
    });
  };

  // One wrapper for both servers. It returns `handleRequest`'s promise exactly
  // as `createServer` received it before, so request semantics are unchanged.
  const serveRequest = (req, res) => {
    // Wrapped rather than passed directly: as a listener it would receive the
    // event's arguments, and `force` must only ever be set by the timer.
    res.on('finish', () => maybeSuperviseMaintainer());
    return handleRequest(req, res);
  };

  // TCP server — opt-in only (SWEET_SEARCH_TCP_PORT). Bound non-fatally so a
  // port already in use never crashes the server (C3: it used to be bound
  // unconditionally on 9876 and a second project's server died on EADDRINUSE).
  if (httpPort != null) {
    tcpServer = http.createServer(serveRequest);
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
  unixServer = http.createServer(serveRequest);
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
  // Routed through supervision rather than calling `launchMaintainer` directly,
  // so the startup spawn and every later supervision tick share ONE claim and
  // ONE rate limit. Called directly, the two paths could each spawn inside the
  // few hundred milliseconds it takes a fresh maintainer to take the lock.
  try {
    runSupervisionTick({ state: supervisionState, cwd: process.cwd() });
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] maintainer launch: ${err?.message || err}\n`);
  }

  // Handle graceful shutdown (shared idempotent teardown).
  process.on('SIGINT', () => { gracefulShutdown('sigint'); });

  // (1) Idle-TTL eviction — default ON. Unref'd so it never keeps the event
  // loop alive on its own. The TTL is read every tick so tests/operators can
  // tune it live; 0 disables. Self-stops once no QUERY route has been hit for
  // longer than the TTL — the actively-used repo's daemon keeps resetting
  // lastActivityMs and is therefore never idle-evicted while it is being
  // queried. (The separate LRU cap below is the only path that can stop an
  // active peer, and only via a newly-started peer within one registry-refresh
  // interval; see daemon-registry.js selectEvictionTargets.)
  idleTimer = setInterval(() => {
    const ttl = Number(process.env.SWEET_SEARCH_DAEMON_IDLE_TTL_MS ?? 1_200_000);
    const idleFor = Date.now() - lastActivityMs;
    if (ttl > 0 && idleFor > ttl) {
      gracefulShutdown('idle-ttl');
      return;
    }
    // Supervision backstop. The per-response hook covers the normal case; this
    // catches the one it cannot — a tick that lost the spawn claim to a peer
    // which then failed to start one, on a repo that goes quiet immediately
    // afterwards. Rate-limited internally, so a 60s cadence costs at most one
    // lock stat per minute.
    //
    // "In active use" is deliberately NOT `ttl > 0`: the daemon's own eviction
    // setting says nothing about whether this repository is being worked in,
    // and gating on it meant that turning daemon eviction off
    // (SWEET_SEARCH_DAEMON_IDLE_TTL_MS=0, a supported configuration) silently
    // removed the only backstop supervision has.
    //
    // It is also not merely "recently started". A daemon receiving nothing but
    // health probes has an idleFor measured from ITS OWN start, which would
    // read as active and resurrect a maintainer for a repository nobody has
    // ever queried — the exact thing the health-probe invariant forbids.
    const everQueried = lastActivityMs !== startupActivityMs;
    const activeWindow = ttl > 0 ? ttl : 1_200_000;
    if (everQueried && idleFor <= activeWindow) maybeSuperviseMaintainer({ force: true });
  }, Number(process.env.SWEET_SEARCH_DAEMON_IDLE_CHECK_MS ?? 60_000));
  if (idleTimer.unref) idleTimer.unref();

  // (2) Resident-daemon LRU cap — default OFF. Only when SWEET_SEARCH_MAX_DAEMONS
  // is opted into do we touch the shared registry at all: register self, then
  // refresh our real query activity + prune dead peers + enforce the cap on a
  // coarse unref'd timer. The maintainer is never enumerated (it never registers).
  if (capEnabled) {
    const entry = {
      pid: process.pid,
      projectRoot: resolveProjectRoot(),
      socketPath,
      pidFile,
      startedAt: Date.now(),
      lastActivityMs,
    };
    registryUpsertSelf(entry)
      .then(() => enforceDaemonCap())
      .catch((err) => {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] registry init: ${err?.message || err}\n`);
      });

    registryTimer = setInterval(() => {
      registryTouchSelf(process.pid, lastActivityMs)
        .then(() => enforceDaemonCap())
        .catch((err) => {
          if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] registry tick: ${err?.message || err}\n`);
        });
    }, Number(process.env.SWEET_SEARCH_DAEMON_REGISTRY_REFRESH_MS ?? 45_000));
    if (registryTimer.unref) registryTimer.unref();
  }
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
    fileFilter,
    perFileCap = 0,
    maxFiles = 0,
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
    projectRoot,
    trackAgentSpans = true,
    _isAgentFormat = false,
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
    // One param per scope. `set` would stringify an array into "a,b,c", which
    // the server then treats as one literal path that matches nothing.
    for (const f of (Array.isArray(fileFilter) ? fileFilter : [fileFilter])) {
      if (f) params.append('fileFilter', f);
    }
    if (perFileCap > 0) params.set('perFileCap', perFileCap.toString());
    if (maxFiles > 0) params.set('maxFiles', maxFiles.toString());
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
    if (projectRoot) params.set('projectRoot', projectRoot);
    if (_isAgentFormat) params.set('agent', 'true');
    if (!trackAgentSpans) params.set('trackAgentSpans', 'false');
    if (trackAgentSpans && format?.startsWith('agent') && exactRereadOmissionEnabled()) {
      const sessionId = resolveAgentSessionId();
      if (sessionId) {
        params.set('exactRereadOmission', 'true');
        params.set('agentSessionId', sessionId);
      }
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
    req.on('error', reject);
    req.end();
  });
}

/**
 * Query the warm daemon's read-semantic route as JSON. The caller may retain
 * its existing renderer while reusing the daemon's resident model/index.
 *
 * @param {{ path: string, query: string, projectRoot: string, maxChars?: number }} request
 * @returns {Promise<object>}
 */
export async function queryReadSemanticServer({ path: file, query, projectRoot, maxChars } = {}) {
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
 * Send /stop to a daemon on an EXPLICIT socket (variant of stopServer, which
 * always targets this process's own socket). Used by the resident-daemon LRU
 * cap to evict a least-recently-active PEER. Returns true if the request
 * reached the daemon (200, or the connection dropped as it exited).
 */
export async function sendStopToSocket(socketPath, { timeoutMs = 5000 } = {}) {
  if (!socketPath) return false;
  try {
    const http = await import('http');
    return await new Promise((resolve) => {
      const req = http.request({ socketPath, path: '/stop', method: 'GET' }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });
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
