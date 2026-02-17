#!/usr/bin/env node

// ESM-safe stdout protection: override console.log BEFORE any search module loads.
// Search modules call console.log at import time, which would corrupt stdio transport.
const _origLog = console.log;
console.log = (...args) => console.error(...args);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

// ---------------------------------------------------------------------------
// Project root resolution (once at startup)
// ---------------------------------------------------------------------------

function resolveProjectRoot() {
  const args = process.argv.slice(2);
  const rootFlagIdx = args.indexOf('--project-root');

  let root;
  if (rootFlagIdx !== -1 && args[rootFlagIdx + 1]) {
    root = args[rootFlagIdx + 1];
  } else if (process.env.SWEET_SEARCH_PROJECT_ROOT) {
    root = process.env.SWEET_SEARCH_PROJECT_ROOT;
  } else {
    root = process.cwd();
  }

  root = path.resolve(root);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`[sweet-search-mcp] Error: project root does not exist or is not a directory: ${root}`);
    process.exit(1);
  }

  return root;
}

const PROJECT_ROOT = resolveProjectRoot();

// Fix #3: Propagate resolved root to environment so core/config.js picks it up
// even when --project-root CLI flag was used instead of env var.
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

// ---------------------------------------------------------------------------
// Lazy-loaded search engine (dynamic import to keep stdout safe)
// ---------------------------------------------------------------------------

let _searcher = null;
let _healthDb = null;

async function getSearcher() {
  if (_searcher) return _searcher;

  const { getWarmSearcher } = await import(
    path.join(__dirname, '..', 'core', 'sweet-search.js')
  );

  _searcher = await getWarmSearcher({ verbose: false });
  return _searcher;
}

async function getConfig() {
  return import(path.join(__dirname, '..', 'core', 'config.js'));
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'sweet-search',
  version: PKG_VERSION,
}, {
  capabilities: {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false },
  },
});

// ---------------------------------------------------------------------------
// Output schemas (Zod — SDK converts to JSON Schema for clients)
// ---------------------------------------------------------------------------

const SearchOutputSchema = z.object({
  results: z.array(z.object({
    file: z.string(),
    line: z.number().int().optional(),
    score: z.number(),
    snippet: z.string(),
    signature: z.string().optional(),
    language: z.string().optional(),
  })),
  totalFound: z.number().int(),
  mode: z.string(),
  queryTimeMs: z.number(),
});

const IndexOutputSchema = z.object({
  success: z.boolean(),
  filesIndexed: z.number().int().optional(),
  durationMs: z.number().optional(),
  mode: z.string(),
  errors: z.array(z.string()).optional(),
});

const HealthOutputSchema = z.object({
  healthy: z.boolean(),
  projectRoot: z.string(),
  subsystems: z.record(z.string(), z.object({
    status: z.enum(['ok', 'degraded', 'error', 'not_initialized']),
    details: z.string().optional(),
  })),
  indexStats: z.object({
    totalFiles: z.number().int().optional(),
    lastIndexed: z.string().optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Tools (using registerTool for annotations + outputSchema support)
// ---------------------------------------------------------------------------

server.registerTool('search', {
  description: 'Search the codebase using hybrid semantic/lexical/structural search',
  inputSchema: {
    query: z.string().min(1).max(1000).describe('Search query (1-1000 chars)'),
    k: z.number().int().min(1).max(200).default(10).describe('Number of results (1-200)'),
    mode: z.enum(['auto', 'lexical', 'semantic', 'hybrid']).default('auto')
      .describe('Search mode'),
  },
  outputSchema: SearchOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ query, k, mode }) => {
  try {
    const searcher = await getSearcher();
    const { results, stats } = await searcher.search(query, {
      k,
      mode,
      expand: true,
      rerank: true,
    });

    const structured = {
      results: (results || []).map(r => ({
        file: r.file || r.file_path || r.metadata?.file || '',
        line: r.startLine || r.start_line || undefined,
        score: r.score || 0,
        snippet: r.snippet || r.signature || r.name || '',
        signature: r.signature || '',
        language: r.language || r.metadata?.language || '',
      })),
      totalFound: stats.results_count || 0,
      mode: stats.routing?.mode || mode,
      queryTimeMs: stats.total_ms || 0,
    };

    const lines = structured.results.map((r, i) =>
      `${i + 1}. ${r.file}${r.line ? ':' + r.line : ''} (score: ${r.score.toFixed(3)})${r.signature ? '\n   ' + r.signature : ''}`
    );
    const text = lines.length > 0
      ? `Found ${structured.totalFound} results (${structured.queryTimeMs}ms, ${structured.mode}):\n\n${lines.join('\n\n')}`
      : `No results found for "${query}" (${structured.queryTimeMs}ms)`;

    return {
      content: [{ type: 'text', text }],
      structuredContent: structured,
    };
  } catch (err) {
    const safeMessage = (err.message || 'Search failed')
      .split('\n')[0]                          // Strip stack traces
      .replace(/\/[^\s:]+/g, '<path>')         // Unix paths
      .replace(/[A-Z]:\\[^\s:]+/gi, '<path>')  // Windows paths
      .replace(/\\\\[^\s:]+/g, '<path>');      // UNC paths
    return {
      content: [{ type: 'text', text: `Search error: ${safeMessage}` }],
      isError: true,
    };
  }
});

server.registerTool('index', {
  description: 'Index or re-index the codebase',
  inputSchema: {
    mode: z.enum(['incremental', 'full']).default('incremental')
      .describe('Indexing mode'),
  },
  outputSchema: IndexOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
}, async ({ mode }) => {
  const indexerPath = path.join(__dirname, '..', 'core', 'index-codebase-v21.js');
  const args = ['--quiet'];
  if (mode === 'full') args.push('--full');

  const start = Date.now();

  return new Promise((resolve) => {
    const child = spawn('node', [indexerPath, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: PROJECT_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // F-11: Timeout to prevent indefinite hanging
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      // Give 5s grace period, then SIGKILL
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
    }, TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      console.error(data.toString());
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      const line = data.toString().trim();
      if (line) console.error(`[sweet-search-mcp] index: ${line}`);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - start;
      const success = code === 0;
      const timedOut = code === null || code === 143; // SIGTERM = 143

      const filesMatch = stdout.match(/(\d+)\s+files?/i) || stderr.match(/(\d+)\s+files?/i);
      const filesIndexed = filesMatch ? parseInt(filesMatch[1], 10) : undefined;

      const structured = {
        success,
        filesIndexed,
        durationMs,
        mode,
        errors: success ? [] : [timedOut ? `Indexing timed out after ${TIMEOUT_MS / 1000}s` : (stderr.trim() || `Indexer exited with code ${code}`)],
      };

      const text = success
        ? `Indexing complete (${mode}, ${durationMs}ms${filesIndexed ? ', ' + filesIndexed + ' files' : ''})`
        : `Indexing failed: ${structured.errors[0]}`;

      resolve({
        content: [{ type: 'text', text }],
        structuredContent: structured,
        isError: !success,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Shared health check (used by both `health` tool and `status` resource)
// ---------------------------------------------------------------------------

async function checkHealth() {
  const subsystems = {};
  let indexStats = {};
  let healthy = true;

  // Config-based filesystem checks — no searcher needed.
  // This ensures subsystem-level detail even if the search engine fails to load.
  try {
    const config = await getConfig();

    const checks = [
      { name: 'graph-index', check: () => existsSync(config.DB_PATHS.codeGraph) },
      { name: 'hnsw', check: () => existsSync(config.DB_PATHS.hnswIndex.replace('.idx', '.meta.json')) },
      { name: 'binary-hnsw', check: () => existsSync(config.DB_PATHS.binaryHnswIndex?.replace('.idx', '.meta.json')) },
      { name: 'colbert', check: () => existsSync(config.DB_PATHS.colbert || path.join(PROJECT_ROOT, '.sweet-search', 'colbert-tokens.db')) },
      { name: 'embedding-service', check: () => true },
      { name: 'reranker', check: () => true },
      { name: 'query-router', check: () => true },
      { name: 'translation', check: () => true },
    ];

    for (const { name, check } of checks) {
      try {
        const ok = check();
        subsystems[name] = { status: ok ? 'ok' : 'not_initialized', details: ok ? '' : 'Index not found' };
        if (!ok && ['graph-index', 'hnsw'].includes(name)) healthy = false;
      } catch (e) {
        subsystems[name] = { status: 'error', details: e.message };
        healthy = false;
      }
    }

    // SEISMIC sparse vector subsystem (separate from loop — uses 'disabled' semantics, not 'not_initialized')
    const seismicEnabled = config.SEISMIC_CONFIG?.enabled ?? false;
    subsystems['seismic'] = {
      status: seismicEnabled ? 'ok' : 'not_initialized',
      details: seismicEnabled ? '' : 'Disabled (awaiting sparse encoder)',
    };

    try {
      if (existsSync(config.DB_PATHS.codeGraph)) {
        if (!_healthDb) {
          const Database = (await import('better-sqlite3')).default;
          _healthDb = new Database(config.DB_PATHS.codeGraph, { readonly: true, timeout: 5000 });
        }
        const count = _healthDb.prepare('SELECT count(*) as cnt FROM entities').get();
        indexStats.totalFiles = count?.cnt || 0;
      }
    } catch (e) {
      // SQLITE_BUSY or stale connection — reset cache and continue
      try { _healthDb?.close(); } catch {}
      _healthDb = null;
    }

  } catch (e) {
    healthy = false;
    subsystems['config'] = { status: 'error', details: e.message };
  }

  return { healthy, projectRoot: path.basename(PROJECT_ROOT), subsystems, indexStats };
}

server.registerTool('health', {
  description: 'Check health status of all search subsystems',
  outputSchema: HealthOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async () => {
  const structured = await checkHealth();

  const statusLines = Object.entries(structured.subsystems).map(
    ([name, s]) => `  ${s.status === 'ok' ? '+' : s.status === 'not_initialized' ? '-' : 'x'} ${name}: ${s.status}${s.details ? ' (' + s.details + ')' : ''}`
  );
  const text = `Health: ${structured.healthy ? 'OK' : 'DEGRADED'}\nProject: ${path.basename(PROJECT_ROOT)}\n\n${statusLines.join('\n')}`;

  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
});

// ---------------------------------------------------------------------------
// Repo Map output schema
// ---------------------------------------------------------------------------

const RepoMapOutputSchema = z.object({
  text: z.string(),
  entityCount: z.number().int(),
  fileCount: z.number().int(),
  totalEntities: z.number().int(),
  pageRankTimeMs: z.number(),
});

server.registerTool('repo-map', {
  description: 'Generate a PageRank-scored repository map showing the most important symbols in the codebase, fitted to a token budget. Useful for giving LLMs a compressed structural overview.',
  inputSchema: {
    tokenBudget: z.number().int().min(100).max(100000).default(1024)
      .describe('Maximum token budget for the output (default: 1024)'),
    focusFiles: z.array(z.string()).optional()
      .describe('Boost importance of entities in these files'),
    focusEntities: z.array(z.string()).optional()
      .describe('Boost importance of entities with these names'),
  },
  outputSchema: RepoMapOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ tokenBudget, focusFiles, focusEntities }) => {
  try {
    const { generateRepoMap } = await import(
      path.join(__dirname, '..', 'core', 'repo-map.js')
    );

    const result = generateRepoMap({
      tokenBudget,
      focusFiles,
      focusEntities,
    });

    const summary = `Repo map: ${result.entityCount}/${result.totalEntities} entities across ${result.fileCount} files (${result.pageRankTimeMs}ms)`;
    const text = `${summary}\n\n${result.text}`;

    return {
      content: [{ type: 'text', text }],
      structuredContent: result,
    };
  } catch (err) {
    const safeMessage = (err.message || 'Repo map generation failed')
      .split('\n')[0]
      .replace(/\/[^\s:]+/g, '<path>')
      .replace(/[A-Z]:\\[^\s:]+/gi, '<path>')
      .replace(/\\\\[^\s:]+/g, '<path>');
    return {
      content: [{ type: 'text', text: `Repo map error: ${safeMessage}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.resource(
  'status',
  'sweet-search://status',
  { mimeType: 'application/json', description: 'Index health and statistics' },
  async () => {
    const data = await checkHealth();
    return { contents: [{ uri: 'sweet-search://status', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  },
);

server.resource(
  'config',
  'sweet-search://config',
  { mimeType: 'application/json', description: 'Current search configuration' },
  async () => {
    let data = {};
    try {
      const config = await getConfig();
      data = {
        searchMode: 'auto',
        reranker: {
          flashrank: true,
          localReranker: config.shouldUseLocalReranker?.() || false,
        },
        embeddingModel: config.EMBEDDING_CONFIG?.model || 'unknown',
        supportedLanguages: ['en', 'de', 'fr', 'es', 'pl', 'ja', 'ko', 'zh', 'ru'],
        projectRoot: path.basename(PROJECT_ROOT),
      };
    } catch (e) {
      data = { error: e.message };
    }
    return { contents: [{ uri: 'sweet-search://config', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

server.prompt(
  'search-codebase',
  'Guided codebase search with focused results',
  { query: z.string().describe('What to search for'), focus: z.string().optional().describe('Focus area: functions, types, tests, etc.') },
  ({ query, focus }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Search this codebase for: "${query}"${focus ? ` (focus on ${focus})` : ''}\n\nUse the search tool to find relevant code, then summarize the findings with file paths and key code snippets.`,
        },
      },
    ],
  }),
);

server.prompt(
  'explain-code',
  'Find and explain code related to a topic',
  { topic: z.string().describe('Topic to find and explain') },
  ({ topic }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Find code related to "${topic}" in this codebase using the search tool, then explain how it works with context about the architecture and key patterns.`,
        },
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

// TODO: Streamable HTTP transport (--transport http --port <port>) — future work.
// Currently only stdio is implemented (universal baseline for Claude Code + Codex).

// ---------------------------------------------------------------------------
// Graceful shutdown (F-18)
// ---------------------------------------------------------------------------

function shutdown(signal) {
  console.error(`[sweet-search-mcp] ${signal} received, shutting down`);
  try { server.close(); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[sweet-search-mcp] Server started (project: ${PROJECT_ROOT})`);
}

main().catch((err) => {
  console.error('[sweet-search-mcp] Fatal:', err);
  process.exit(1);
});
