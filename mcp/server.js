#!/usr/bin/env node

// ESM-safe stdout protection: override console.log BEFORE any search module loads.
// Search modules call console.log at import time, which would corrupt stdio transport.
const _origLog = console.log;
console.log = (...args) => console.error(...args);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  version: '2.3.0',
}, {
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: false, listChanged: true },
    prompts: { listChanged: true },
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
    query: z.string().describe('Search query'),
    k: z.number().default(10).describe('Number of results to return'),
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
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ mode }, { sendNotification }) => {
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

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      console.error(data.toString());
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      const line = data.toString().trim();
      if (line && sendNotification) {
        try {
          sendNotification({ method: 'notifications/progress', params: { message: line } });
        } catch { /* ignore notification errors */ }
      }
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - start;
      const success = code === 0;

      const filesMatch = stdout.match(/(\d+)\s+files?/i) || stderr.match(/(\d+)\s+files?/i);
      const filesIndexed = filesMatch ? parseInt(filesMatch[1], 10) : undefined;

      const structured = {
        success,
        filesIndexed,
        durationMs,
        mode,
        errors: success ? [] : [stderr.trim() || `Indexer exited with code ${code}`],
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
      { name: 'colbert', check: () => existsSync(config.DB_PATHS.colbert || path.join(PROJECT_ROOT, '.agentdb', 'colbert-tokens.db')) },
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

    try {
      const Database = (await import('better-sqlite3')).default;
      if (existsSync(config.DB_PATHS.codeGraph)) {
        const db = new Database(config.DB_PATHS.codeGraph, { readonly: true });
        const count = db.prepare('SELECT count(*) as cnt FROM entities').get();
        indexStats.totalFiles = count?.cnt || 0;
        db.close();
      }
    } catch { /* stats are optional */ }

  } catch (e) {
    healthy = false;
    subsystems['config'] = { status: 'error', details: e.message };
  }

  return { healthy, projectRoot: PROJECT_ROOT, subsystems, indexStats };
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
  const text = `Health: ${structured.healthy ? 'OK' : 'DEGRADED'}\nProject: ${PROJECT_ROOT}\n\n${statusLines.join('\n')}`;

  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
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
        projectRoot: PROJECT_ROOT,
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[sweet-search-mcp] Server started (project: ${PROJECT_ROOT})`);
}

main().catch((err) => {
  console.error('[sweet-search-mcp] Fatal:', err);
  process.exit(1);
});
