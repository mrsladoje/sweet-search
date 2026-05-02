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
  ReadOutputSchema,
  ReadSemanticOutputSchema,
  handleSearch,
  handleIndex,
  checkHealth,
  handleRepoMap,
  handleVocabPrewarm,
  handleRead,
  handleReadSemantic,
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

  const { getWarmSearcher } = await import('../core/search/index.js');

  _searcher = await getWarmSearcher({ verbose: false });
  return _searcher;
}

async function getConfig() {
  return import('../core/infrastructure/config/index.js');
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
  description: 'Search the codebase using hybrid semantic/lexical/structural search. Use format="agent" with a regex for ColGrep pattern search that returns self-contained code blocks — eliminates follow-up file reads.',
  inputSchema: {
    query: z.string().min(1).max(1000).describe('Search query (1-1000 chars)'),
    k: z.number().int().min(1).max(200).default(10).describe('Number of results (1-200)'),
    mode: z.enum(['auto', 'lexical', 'semantic', 'hybrid']).default('auto')
      .describe('Search mode'),
    structural: z.boolean().default(false)
      .describe('Force structural graph search mode (callers, callees, implementations)'),
    regex: z.string().max(4096).optional()
      .describe('Regex pattern for ColGrep pattern search (implies mode=pattern)'),
    format: z.enum(['benchmark', 'agent', 'agent_preview', 'agent_full']).default('benchmark').optional()
      .describe('Output format. "agent"/"agent_preview" returns bounded code blocks (4K budget). "agent_full" returns expanded code for top-3 (8K budget).'),
    tokenBudget: z.number().int().min(500).max(16000).default(4000).optional()
      .describe('Agent mode: total token budget for all results (default: 4000)'),
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

server.registerTool('read', {
  description: 'Read one or more files for exact code understanding. Replaces the default Read tool for most code-reading workflows. Uses the filesystem as ground truth, supports line ranges and batching, and attaches symbol-aware chunk metadata when the file is indexed.',
  inputSchema: {
    files: z.array(z.object({
      path: z.string().describe('File path relative to project root (or absolute)'),
      startLine: z.number().int().min(1).optional().describe('Start line (1-based, inclusive)'),
      endLine: z.number().int().min(1).optional().describe('End line (1-based, inclusive)'),
    })).min(1).max(20).describe('Files to read (1-20)'),
    includeMetadata: z.boolean().default(true).optional()
      .describe('Attach symbol-aware chunk metadata when the file is indexed'),
  },
  outputSchema: ReadOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => handleRead(args, { PROJECT_ROOT }));

server.registerTool('read-semantic', {
  description: 'Read only the spans of a file relevant to a query. Selects spans via hybrid retrieval (lexical + symbol + ColBERT-style late-interaction MaxSim) with RRF fusion and LI re-rank, then re-reads exact lines from disk. Returns 1-N small spans instead of the full file. Falls back to a plain read if the file is not indexed.',
  inputSchema: {
    file: z.string().describe('File path (project-relative or absolute)'),
    query: z.string().min(1).max(500).describe('What you want to understand about this file'),
    topK: z.number().int().min(1).max(20).default(5).optional()
      .describe('Maximum spans before merging (default: 5)'),
    threshold: z.number().min(0).max(1).default(0.4).optional()
      .describe('MaxSim score floor (default: 0.4)'),
    contextLines: z.number().int().min(0).max(20).default(2).optional()
      .describe('Pre/post context lines per span (default: 2)'),
    maxChars: z.number().int().min(200).max(64000).default(8000).optional()
      .describe('Hard cap on returned text (default: 8000 chars)'),
    maxTokens: z.number().int().min(50).max(16000).optional()
      .describe('Convenience cap (~chars/4)'),
    verbose: z.boolean().default(false).optional()
      .describe('Include timings + per-signal scores'),
  },
  outputSchema: ReadSemanticOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => handleReadSemantic(args, { PROJECT_ROOT }));

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
