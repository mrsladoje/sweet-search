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
import { launchMaintainer } from '../core/indexing/maintainer-launcher.mjs';

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
import { TraceOutputSchema, handleTrace } from './trace-tool.js';
import {
  ReadOutputSchema,
  ReadSemanticOutputSchema,
  handleRead,
  handleReadSemantic,
} from './read-tool.js';

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
const traceDeps = { PROJECT_ROOT };
const indexDeps = { PROJECT_ROOT, coreDir };
const healthDeps = { getConfig, PROJECT_ROOT };
const repoMapDeps = { coreDir, PROJECT_ROOT };
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
  description: 'Hybrid code search (semantic + lexical + structural). USE INSTEAD OF native Grep for code-discovery tasks. Returns ranked, auto-expanded, self-contained code blocks by default (`format="agent"`) — no follow-up Read needed. Pass `regex` for ColGrep pattern search (regex anchor + semantic re-rank), `structural=true` for callers/callees/impact, or omit for hybrid auto-routing. Pass `format="benchmark"` only for retrieval-quality measurement, not agent consumption.',
  inputSchema: {
    query: z.string().min(1).max(1000).describe('Search query (1-1000 chars)'),
    k: z.number().int().min(1).max(200).default(10).describe('Number of results (1-200)'),
    mode: z.enum(['auto', 'lexical', 'semantic', 'hybrid']).default('auto')
      .describe('Search mode'),
    structural: z.boolean().default(false)
      .describe('Force structural graph search mode (callers, callees, implementations)'),
    regex: z.string().max(4096).optional()
      .describe('Regex pattern for ColGrep pattern search (implies mode=pattern)'),
    format: z.enum(['benchmark', 'agent', 'agent_preview', 'agent_full']).default('agent').optional()
      .describe('Output format. Default "agent" returns ranked, self-contained code blocks for agent consumption. Use "benchmark" only for retrieval-quality measurement.'),
    tokenBudget: z.number().int().min(500).max(16000).optional()
      .describe('Agent mode: optional token budget override. Omit to let the tool pick.'),
  },
  outputSchema: SearchOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async (args) => handleSearch(args, searchDeps));

server.registerTool('trace', {
  description: 'Trace callers, callees, and transitive impact paths for one specific symbol — returns a single structural-context package adapted to the token budget. USE WHEN the question is "who calls X", "what does X depend on", or "what would break if I changed X". For general code discovery use `search` instead; for navigation around an unfamiliar repo use `repo-map` first.',
  inputSchema: {
    symbol: z.string().min(1).max(256)
      .describe('Symbol/entity name to trace, e.g. processOrder or EmployeeService.processOrder'),
    file: z.string().max(1000).optional()
      .describe('Optional indexed file path to disambiguate duplicate symbol names'),
    query: z.string().max(1000).optional()
      .describe('Optional natural-language hint used only to rank structural context'),
    maxDepth: z.number().int().min(1).max(4).default(3).optional()
      .describe('Maximum transitive impact depth (default: 3, capped at 4)'),
    tokenBudget: z.number().int().min(1000).max(16000).optional()
      .describe('Optional token budget. Omit for adaptive 3k/8k/12k selection.'),
  },
  outputSchema: TraceOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async (args) => handleTrace(args, traceDeps));

server.registerTool('index', {
  description: 'Index or re-index the codebase. USE BEFORE first search if the project has not been indexed yet, or after large source changes (`mode="full"`). The Claude Code SessionStart hook installed by `sweet-search init` keeps the incremental index fresh during normal sessions, so manual re-indexing is rarely needed.',
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
  description: 'Check health of every sweet-search subsystem (index, embedding model, late-interaction reranker, structural graph, daemon). USE WHEN searches return empty unexpectedly, results look stale, or latency is unusual — diagnoses missing index, model load failures, daemon issues. Read-only, fast.',
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
  description: 'Compressed structural overview of the codebase as a PageRank-scored symbol list, fitted to a token budget. USE FIRST when exploring an unfamiliar repo to orient yourself, or to brief a delegated agent before handing off a task. Not for targeted lookups — use `search` for that. Pass `focusFiles` / `focusEntities` to bias the map toward the area you care about.',
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
  description: 'Pre-warm sweet-search caches by mining the codebase for project-specific vocabulary across lexical / semantic / hybrid modes. USE ONCE after a fresh index to make the first batch of searches faster; generally not needed for one-off queries because the daemon-prewarm hook handles cold-start warmup automatically.',
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
  description: 'Read 1-20 files (with optional line ranges) for exact code understanding. USE INSTEAD OF the native Read tool for code-discovery reads — batches multiple files in one call, attaches symbol-aware chunk metadata when the file is indexed, and returns the exact bytes from disk. Native Read remains fine for files you are about to Edit (Edit needs a prior Read of that exact file).',
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
  description: 'Read only the spans of a file relevant to a question. USE WHEN you know the file but the relevant span is unclear — selects spans via hybrid retrieval (lexical + symbol + ColBERT MaxSim, RRF-fused and LI-reranked), then re-reads exact lines from disk. Returns 1-N small spans instead of the full file. Avoid running this on multiple files unless the task is explicitly multi-file — call `search` with the question instead. Falls back to a plain read when the file is not indexed.',
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

  // MCP is opt-in (only runs when the user configures it). When it IS running,
  // reuse the SAME shared launcher so the default-on maintainer starts here too
  // — but MCP is never REQUIRED for incremental indexing (the warm search-server
  // path is the durable guarantee). stdout is the MCP protocol channel, so the
  // launcher's stdout-clean contract is load-bearing; never let it break MCP.
  try {
    const result = launchMaintainer({ cwd: PROJECT_ROOT });
    if (result.spawned) console.error(`[sweet-search-mcp] incremental maintainer started (pid ${result.pid})`);
  } catch (err) {
    console.error(`[sweet-search-mcp] maintainer launch (non-fatal): ${err?.message || err}`);
  }
}

main().catch((err) => {
  console.error('[sweet-search-mcp] Fatal:', err);
  process.exit(1);
});
