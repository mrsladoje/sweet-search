#!/usr/bin/env node

// ESM-safe stdout protection: override console.log BEFORE any search module loads.
// Search modules call console.log at import time, which would corrupt stdio transport.
const _origLog = console.log;
console.log = (...args) => console.error(...args);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SearchOutputSchema,
  IndexOutputSchema,
  HealthOutputSchema,
  RepoMapOutputSchema,
  VocabPrewarmOutputSchema,
  handleSearch,
  handleIndex,
  checkHealth,
  handleRepoMap,
  handleVocabPrewarm,
} from './tool-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return '0.0.0';
  }
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
// Shared dependency objects passed to handlers
// ---------------------------------------------------------------------------

const coreDir = path.join(__dirname, '..', 'core');

const searchDeps = { getSearcher };
const indexDeps = { PROJECT_ROOT, coreDir };
const healthDeps = { getConfig, PROJECT_ROOT };
const repoMapDeps = { coreDir };
const vocabDeps = { coreDir };

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
// Tools
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
}, async (args) => handleSearch(args, searchDeps));

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
}, async (args) => handleIndex(args, indexDeps));

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
  const structured = await checkHealth(healthDeps);

  const statusLines = Object.entries(structured.subsystems).map(
    ([name, s]) => `  ${s.status === 'ok' ? '+' : s.status === 'not_initialized' ? '-' : 'x'} ${name}: ${s.status}${s.details ? ' (' + s.details + ')' : ''}`
  );
  const text = `Health: ${structured.healthy ? 'OK' : 'DEGRADED'}\nProject: ${path.basename(PROJECT_ROOT)}\n\n${statusLines.join('\n')}`;

  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
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
}, async (args) => handleRepoMap(args, repoMapDeps));

server.registerTool('vocab-prewarm', {
  description: 'Mine the codebase for search vocabulary and warm all search modes (lexical, semantic, hybrid) with project-specific terms',
  inputSchema: {
    depth: z.enum(['light', 'medium', 'deep']).default('medium').describe('Mining depth'),
    modes: z.array(z.enum(['lexical', 'semantic', 'hybrid'])).default(['lexical', 'semantic', 'hybrid']).describe('Search modes to warm'),
    top: z.number().int().min(50).max(5000).default(1000).describe('Number of top terms to warm'),
    incremental: z.boolean().default(true).describe('Only process changes since last warmup'),
    dryRun: z.boolean().default(false).describe('Show what would be mined without actually warming'),
    stats: z.boolean().default(false).describe('Return current warmup statistics'),
    localWarmup: z.boolean().default(false).describe('Force local model for warmup even when remote provider is active').optional(),
    provider: z.string().describe('Override embedding provider (voyage/mistral/jina/local)').optional(),
  },
  outputSchema: VocabPrewarmOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
}, async (args) => handleVocabPrewarm(args, vocabDeps));

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.resource(
  'status',
  'sweet-search://status',
  { mimeType: 'application/json', description: 'Index health and statistics' },
  async () => {
    const data = await checkHealth(healthDeps);
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
  try { server.close(); } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }
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
