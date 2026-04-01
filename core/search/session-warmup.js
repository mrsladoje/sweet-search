#!/usr/bin/env node
/**
 * Session Warmup Coordinator
 *
 * Smart, conditional warmup for non-server-owned components.
 * The search server's init() handles heavy ONNX models, HNSW indexes, etc.
 * This module handles the lightweight edges that the server doesn't own:
 *
 *   - FTS5 + HCGS page cache (shared SQLite connection)
 *   - Vocabulary binary artifact preload
 *   - API TLS connection warmup (provider-conditional)
 *   - Health polling (overlapped with the above)
 *
 * All warmups run in parallel with server startup for maximum overlap.
 * Skips entirely when the server is already ready (idempotent).
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import Database from 'better-sqlite3';
import { applyReadPragmas } from '../infrastructure/db-utils.js';
import { Pool } from 'undici';
import {
  DB_PATHS,
  EMBEDDING_CONFIG,
  EMBEDDING_PROVIDERS,
  RERANK_CONFIG,
  shouldUseLocalReranker,
  LATE_INTERACTION_CONFIG,
} from '../infrastructure/config/index.js';
import { ARTIFACT_PATHS } from '../vocabulary/vocab-constants.js';

// ---------------------------------------------------------------------------
// Configuration (overridable via env for testing)
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = process.env.SWEET_SEARCH_BASE_URL || 'http://localhost:9876';
const DEFAULT_HEALTH_TIMEOUT_MS = Number.parseInt(process.env.SWEET_SEARCH_HEALTH_TIMEOUT_MS || '1000', 10);
const DEFAULT_READY_TIMEOUT_MS = Number.parseInt(process.env.SWEET_SEARCH_READY_TIMEOUT_MS || '10000', 10);
const DEFAULT_POLL_MS = Number.parseInt(process.env.SWEET_SEARCH_POLL_MS || '200', 10);
function useUndiciPool() {
  return (process.env.SWEET_SEARCH_USE_UNDICI_POOL || '1') !== '0';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsed(start) {
  return Date.now() - start;
}

function ok(component, start, details = {}) {
  return { component, ok: true, elapsedMs: elapsed(start), details };
}

function fail(component, start, error) {
  return { component, ok: false, elapsedMs: elapsed(start), error: error?.message || String(error) };
}

function skip(component, start, reason) {
  return { component, ok: true, elapsedMs: elapsed(start), details: { skip: reason } };
}

export function isHealthReady(health) {
  if (!health || typeof health !== 'object') return false;
  // Canonical contract
  if (health.status === 'ready') return true;
  // Legacy contract (older search-server)
  if (health.status === 'ok' && health.warm === true) return true;
  // Optional explicit ready flag
  return health.ready === true;
}

const connectionPools = new Map();

export function getPoolForEndpoint(endpoint) {
  const url = new URL(endpoint);
  const origin = url.origin;
  let pool = connectionPools.get(origin);
  if (!pool) {
    pool = new Pool(origin, {
      connections: 2,
      pipelining: 1,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
    connectionPools.set(origin, pool);
  }
  return { pool, url };
}

export async function postJsonWithKeepAlive(endpoint, headers, body, timeoutMs = 5000) {
  if (!useUndiciPool()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      return { statusCode: response.status };
    } finally {
      clearTimeout(timer);
    }
  }

  const { pool, url } = getPoolForEndpoint(endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await pool.request({
      method: 'POST',
      path: `${url.pathname}${url.search}`,
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    await response.body.text();
    return { statusCode: response.statusCode };
  } finally {
    clearTimeout(timer);
  }
}

export async function closeConnectionPools() {
  await Promise.all([...connectionPools.values()].map((pool) => pool.close().catch(() => {})));
  connectionPools.clear();
}

function resolveRerankerStage2Provider() {
  if (shouldUseLocalReranker()) return 'local-modernbert';
  if (RERANK_CONFIG.voyage.enabled && RERANK_CONFIG.voyage.apiKey) return 'voyage';
  if (RERANK_CONFIG.jina.enabled && RERANK_CONFIG.jina.apiKey) return 'jina';
  return 'none';
}

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

export async function readHealth(baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForReady({
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
} = {}) {
  const started = Date.now();
  while (elapsed(started) < timeoutMs) {
    const health = await readHealth(baseUrl);
    if (isHealthReady(health)) {
      return { ok: true, elapsedMs: elapsed(started), health };
    }
    await sleep(pollMs);
  }
  return { ok: false, elapsedMs: elapsed(started), health: null };
}

// ---------------------------------------------------------------------------
// Warmup components
// ---------------------------------------------------------------------------

/**
 * Warm FTS5 + HCGS page caches using a shared SQLite connection.
 * Tries vocab-warmer's cache-based warmup first (richer); falls back to raw
 * FTS5 touch if the vocab-warmer module fails to import.
 */
async function warmSQLiteCaches() {
  const started = Date.now();
  if (!existsSync(DB_PATHS.codeGraph)) {
    return skip('fts5+hcgs', started, 'not indexed');
  }

  // Try the vocab-warmer path first (uses real cached terms)
  try {
    const { warmFromCache } = await import('../vocabulary/vocab-warmer.js');
    const result = await warmFromCache({ maxFts5Queries: 50, maxHnswTraversals: 100 });
    // warmFromCache also touches HCGS via HNSW traversals, so we're done
    return ok('fts5+hcgs', started, result);
  } catch {
    // Fallback: direct SQLite touch
  }

  let db;
  try {
    db = new Database(DB_PATHS.codeGraph, { readonly: true, timeout: 5000 });
    applyReadPragmas(db);

    // FTS5 page cache
    try { db.prepare('SELECT count(*) FROM entities_fts WHERE name MATCH "warmup"').get(); } catch { /* table may not exist */ }
    try { db.prepare('SELECT count(*) FROM relationships').get(); } catch { /* table may not exist */ }

    // HCGS summary pages
    let summaries = 0;
    try {
      const row = db.prepare('SELECT count(*) as cnt FROM entities WHERE summary IS NOT NULL').get();
      summaries = row?.cnt || 0;
    } catch { /* column may not exist */ }

    return ok('fts5+hcgs', started, { summaries, fallback: true });
  } catch (err) {
    return fail('fts5+hcgs', started, err);
  } finally {
    if (db) try { db.close(); } catch { /* best effort */ }
  }
}

/**
 * Preload vocabulary binary artifact into OS file cache.
 * This avoids a ~100ms stall on the first semantic query after a cold boot.
 */
async function warmVocabulary() {
  const started = Date.now();
  const binPath = ARTIFACT_PATHS.identifiersBin;
  const metaPath = ARTIFACT_PATHS.identifiersMeta;

  if (!existsSync(binPath) || !existsSync(metaPath)) {
    return skip('vocabulary', started, 'no binary artifact');
  }

  try {
    // Reading the file loads it into the OS page cache
    const [metaRaw] = await Promise.all([
      fs.readFile(metaPath, 'utf-8'),
      fs.readFile(binPath), // discard content, just warm the cache
    ]);

    let meta;
    try {
      meta = JSON.parse(metaRaw);
    } catch (err) {
      return fail('vocabulary', started, `corrupt meta.json: ${err?.message || String(err)}`);
    }

    return ok('vocabulary', started, {
      terms: meta.termCount,
      dimension: meta.dimension,
      format: 'binary',
    });
  } catch (err) {
    return fail('vocabulary', started, err);
  }
}

/**
 * Warm the active embedding API's TLS connection.
 * Only runs when the active provider is remote (Voyage/Mistral/Jina).
 * Sends a minimal embedding request to establish the TCP+TLS tunnel
 * so the server's first real API call skips the ~100-150ms handshake.
 */
async function warmEmbeddingAPIConnection() {
  const started = Date.now();
  const provider = EMBEDDING_CONFIG.provider;

  if (!EMBEDDING_CONFIG.isRemote) {
    return skip('api-connection', started, 'local provider');
  }

  const providerConfig = EMBEDDING_PROVIDERS[provider];
  if (!providerConfig?.enabled || !providerConfig?.apiKey) {
    return skip('api-connection', started, `${provider} not configured`);
  }

  try {
    const body = { model: providerConfig.model, input: ['warmup'] };
    // Jina uses task_type instead of input_type
    if (provider === 'jina') {
      body.task = 'retrieval.query';
    } else {
      body.input_type = 'query';
    }

    const response = await postJsonWithKeepAlive(
      providerConfig.endpoint,
      {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      5000,
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return fail(`${provider}-connection`, started, `HTTP ${response.statusCode}`);
    }
    return ok(`${provider}-connection`, started);
  } catch (err) {
    return fail(`${provider}-connection`, started, err);
  }
}

async function warmRerankerAPIConnection() {
  const started = Date.now();
  const stage2Provider = resolveRerankerStage2Provider();

  if (stage2Provider === 'local-modernbert' || stage2Provider === 'none') {
    return skip('reranker-api-connection', started, stage2Provider);
  }

  const providerConfig = RERANK_CONFIG[stage2Provider];
  if (!providerConfig?.enabled || !providerConfig?.apiKey) {
    return skip('reranker-api-connection', started, `${stage2Provider} not configured`);
  }

  try {
    const body = stage2Provider === 'voyage'
      ? {
          model: providerConfig.model,
          query: 'warmup',
          documents: ['warmup'],
          top_k: 1,
          return_documents: false,
        }
      : {
          model: providerConfig.model,
          query: 'warmup',
          documents: ['warmup'],
          top_n: 1,
          return_documents: false,
        };

    const response = await postJsonWithKeepAlive(
      providerConfig.endpoint,
      {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      5000,
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return fail(`${stage2Provider}-reranker-connection`, started, `HTTP ${response.statusCode}`);
    }
    return ok(`${stage2Provider}-reranker-connection`, started);
  } catch (err) {
    return fail(`${stage2Provider}-reranker-connection`, started, err);
  }
}

async function warmQueryRouterViaServer(baseUrl) {
  const started = Date.now();
  if (!existsSync(DB_PATHS.codeGraph) && !existsSync(DB_PATHS.codebase)) {
    return skip('query-router', started, 'no indexes');
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const params = new URLSearchParams({
      q: 'AuthService',
      mode: 'auto',
      k: '1',
      rerank: 'false',
      format: 'json',
    });

    const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      return fail('query-router', started, `HTTP ${response.status}`);
    }
    return ok('query-router', started);
  } catch (err) {
    return fail('query-router', started, err);
  }
}

async function warmLateInteractionViaServer(baseUrl) {
  const started = Date.now();
  if (!LATE_INTERACTION_CONFIG.enabled) {
    return skip('late-interaction', started, 'disabled');
  }
  if (!existsSync(DB_PATHS.codeGraph) && !existsSync(DB_PATHS.codebase)) {
    return skip('late-interaction', started, 'no indexes');
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const params = new URLSearchParams({
      q: 'warmup late interaction rerank signal',
      mode: 'semantic',
      k: '20',
      rerank: 'false',
      'late-interaction': 'true',
      format: 'json',
    });

    const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      return fail('late-interaction', started, `HTTP ${response.status}`);
    }
    return ok('late-interaction', started);
  } catch (err) {
    return fail('late-interaction', started, err);
  }
}

// ---------------------------------------------------------------------------
// Warmup registry & orchestration
// ---------------------------------------------------------------------------

/**
 * Build the warmup plan based on current configuration.
 * Each entry has a name, condition, and warmup function.
 * Only components whose condition is true are warmed.
 */
function buildWarmupPlan() {
  const stage2Provider = resolveRerankerStage2Provider();
  return [
    {
      name: 'fts5+hcgs',
      phase: 'pre-ready',
      when: () => existsSync(DB_PATHS.codeGraph),
      fn: warmSQLiteCaches,
    },
    {
      name: 'vocabulary',
      phase: 'pre-ready',
      when: () => existsSync(ARTIFACT_PATHS.identifiersBin),
      fn: warmVocabulary,
    },
    {
      name: 'embedding-api-connection',
      phase: 'pre-ready',
      when: () => EMBEDDING_CONFIG.isRemote,
      fn: warmEmbeddingAPIConnection,
    },
    {
      name: 'reranker-api-connection',
      phase: 'pre-ready',
      when: () => stage2Provider === 'voyage' || stage2Provider === 'jina',
      fn: warmRerankerAPIConnection,
    },
    {
      name: 'query-router',
      phase: 'post-ready',
      when: () => true,
      fn: warmQueryRouterViaServer,
    },
    {
      name: 'late-interaction-model',
      phase: 'pre-ready',
      when: () => LATE_INTERACTION_CONFIG.enabled,
      fn: async () => {
        const started = Date.now();
        try {
          const { getLateInteractionPipeline } = await import('../ranking/late-interaction-model.js');
          await getLateInteractionPipeline();
          return ok('late-interaction-model', started);
        } catch (err) {
          return fail('late-interaction-model', started, err);
        }
      },
    },
    {
      name: 'late-interaction',
      phase: 'post-ready',
      when: () => LATE_INTERACTION_CONFIG.enabled,
      fn: warmLateInteractionViaServer,
    },
  ];
}

function printResult(result) {
  const icon = result.ok ? (result.details?.skip ? '[skip]' : '[ok]') : '[err]';
  const suffix = result.error
    ? ` (${result.error})`
    : result.details?.skip
      ? ` (${result.details.skip})`
      : '';
  console.log(`[session-warmup] ${icon} ${result.component}: ${result.elapsedMs}ms${suffix}`);
}

/**
 * Main entry point. Orchestrates all warmup with maximum parallelism.
 *
 * Flow:
 * 1. Check if server is already ready and skip everything.
 * 2. Build conditional warmup plan from config.
 * 3. Run all qualifying warmups in parallel with server health polling.
 * 4. Report results.
 */
export async function warmSession(options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const readyTimeoutMs = options.readyTimeoutMs || DEFAULT_READY_TIMEOUT_MS;
  const warmServerPath = options.warmServerPath !== false;
  try {
    // Fast path: server already fully ready, no work to do
    const initialHealth = await readHealth(baseUrl);
    if (isHealthReady(initialHealth)) {
      console.log('[session-warmup] Server already ready, skipping redundant warmup.');
      return { skipped: true, reason: 'already-ready', health: initialHealth };
    }

    // Build conditional warmup plan
    const plan = buildWarmupPlan();
    const preReadyTasks = plan.filter((w) => w.phase === 'pre-ready' && w.when());
    const postReadyTasks = plan.filter((w) => w.phase === 'post-ready' && w.when());

    if (preReadyTasks.length === 0 && !initialHealth) {
      // No server, no warmup targets, just wait for server
      const ready = await waitForReady({ baseUrl, timeoutMs: readyTimeoutMs });
      return { skipped: false, ready: ready.ok, elapsedMs: ready.elapsedMs, components: [] };
    }

    // Run all warmups in parallel with server health polling
    const warmupPromises = preReadyTasks.map((w) => w.fn());
    const waitPromise = waitForReady({ baseUrl, timeoutMs: readyTimeoutMs });

    const [ready, ...results] = await Promise.all([waitPromise, ...warmupPromises]);

    // Report
    for (const r of results) printResult(r);

    if (ready.ok) {
      console.log(`[session-warmup] [ok] Server ready in ${ready.elapsedMs}ms`);
    } else {
      console.log(`[session-warmup] [warn] Server did not report ready within ${readyTimeoutMs}ms`);
    }

    if (ready.ok && warmServerPath) {
      const serverWarmups = await Promise.all(postReadyTasks.map((task) => task.fn(baseUrl)));
      for (const r of serverWarmups) printResult(r);
      results.push(...serverWarmups);
    }

    return {
      skipped: false,
      ready: ready.ok,
      elapsedMs: ready.elapsedMs,
      health: ready.health,
      components: results,
    };
  } finally {
    await closeConnectionPools();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await warmSession();
  } catch (err) {
    // Best-effort warmup: never crash the session on preheat failures.
    console.error(`[session-warmup] Non-fatal error: ${err?.message || err}`);
  }
}
