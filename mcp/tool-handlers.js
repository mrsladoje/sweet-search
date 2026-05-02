// mcp/tool-handlers.js — Extracted tool handler functions (SOLID refactor)
// Each handler receives its dependencies via a `deps` parameter.

import { z } from 'zod';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Output schemas (Zod — SDK converts to JSON Schema for clients)
// ---------------------------------------------------------------------------

const SearchResultSchema = z.object({
  file: z.string(),
  score: z.number(),
  line: z.number().int().optional(),
  snippet: z.string().optional(),
  signature: z.string().optional(),
  language: z.string().optional(),
  rank: z.number().int().optional(),
  startLine: z.number().int().nullable().optional(),
  endLine: z.number().int().nullable().optional(),
  symbol: z.string().nullable().optional(),
  symbolType: z.string().nullable().optional(),
  presentation: z.enum(['full', 'preview', 'summary']).optional(),
  code: z.string().nullable().optional(),
  codeTokens: z.number().int().optional(),
});

export const SearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
  totalFound: z.number().int(),
  mode: z.string(),
  queryTimeMs: z.number(),
  format: z.enum(['benchmark', 'agent']).optional(),
  subMode: z.string().optional(),
  query: z.string().optional(),
  regex: z.string().optional(),
  totalResults: z.number().int().optional(),
  tokenBudget: z.number().int().optional(),
  tokensUsed: z.number().int().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  confidenceReason: z.string().optional(),
  sufficient: z.boolean().optional(),
  sufficiencyReasons: z.array(z.string()).optional(),
  packagingMs: z.number().optional(),
  latencyMs: z.number().optional(),
});

export const IndexOutputSchema = z.object({
  success: z.boolean(),
  filesIndexed: z.number().int().optional(),
  durationMs: z.number().optional(),
  mode: z.string(),
  errors: z.array(z.string()).optional(),
});

export const HealthOutputSchema = z.object({
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

export const RepoMapOutputSchema = z.object({
  text: z.string(),
  entityCount: z.number().int(),
  fileCount: z.number().int(),
  totalEntities: z.number().int(),
  pageRankTimeMs: z.number(),
});

export const VocabPrewarmOutputSchema = z.object({
  termsMined: z.number().int(),
  communitiesDetected: z.number().int(),
  warmupTimeMs: z.number(),
  perMode: z.record(z.string(), z.object({
    queriesWarmed: z.number().int(),
    timeMs: z.number(),
  })).optional(),
  hitRateProjection: z.number().optional(),
  dryRun: z.boolean().optional(),
});

const ReadFileResultSchema = z.object({
  file: z.string(),
  absolutePath: z.string().optional(),
  ok: z.boolean(),
  exact: z.boolean().optional(),
  indexed: z.boolean().optional(),
  language: z.string().nullable().optional(),
  totalLines: z.number().int().optional(),
  bytes: z.number().int().optional(),
  mtimeMs: z.number().optional(),
  range: z.object({
    startLine: z.number().int(),
    endLine: z.number().int(),
  }).nullable().optional(),
  text: z.string().optional(),
  chunks: z.array(z.object({
    id: z.string(),
    symbol: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    startLine: z.number().int().nullable().optional(),
    endLine: z.number().int().nullable().optional(),
    signature: z.string().nullable().optional(),
  })).optional(),
  error: z.string().optional(),
  timings: z.object({ totalMs: z.number() }).optional(),
});

export const ReadOutputSchema = z.object({
  files: z.array(ReadFileResultSchema),
  totalMs: z.number(),
});

const ReadSemanticSpanSchema = z.object({
  startLine: z.number().int(),
  endLine: z.number().int(),
  score: z.number(),
  symbols: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  chunkIds: z.array(z.string()).optional(),
  text: z.string(),
  truncated: z.boolean().optional(),
});

export const ReadSemanticOutputSchema = z.object({
  file: z.string(),
  query: z.string(),
  ok: z.boolean(),
  indexed: z.boolean(),
  fellBack: z.boolean(),
  reason: z.string().optional(),
  language: z.string().nullable().optional(),
  totalLines: z.number().int().optional(),
  spans: z.array(ReadSemanticSpanSchema),
  charsReturned: z.number().int().optional(),
  approxTokensReturned: z.number().int().optional(),
  signals: z.record(z.string(), z.any()).optional(),
  timings: z.record(z.string(), z.number()).optional(),
});

// ---------------------------------------------------------------------------
// Internal state for health DB cache (module-scoped, not exported)
// ---------------------------------------------------------------------------

let _healthDb = null;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @param {{ query: string, k: number, mode: string, structural?: boolean, regex?: string, format?: string, tokenBudget?: number }} args
 * @param {{ getSearcher: () => Promise<object> }} deps
 */
export async function handleSearch({ query, k, mode, structural, regex, format, tokenBudget }, { getSearcher }) {
  try {
    // Agent format requires a regex (pattern search). If no regex, ignore the format
    // to avoid silent fallback to non-pattern search without agent packaging.
    const isAgentFormat = format && format.startsWith('agent');
    const effectiveFormat = (isAgentFormat && !regex) ? undefined : format;

    const searcher = await getSearcher();
    const searchMode = structural ? 'structural' : mode;
    const searchResult = await searcher.search(query, {
      k,
      mode: searchMode,
      expand: true,
      rerank: true,
      ...(regex && { regex }),
      ...(effectiveFormat && { format: effectiveFormat }),
      ...(tokenBudget && { tokenBudget }),
    });

    // Agent mode: return the fully packaged response directly
    if (searchResult.format === 'agent') {
      const agentResults = searchResult.results || [];
      const lines = agentResults
        .filter(r => r.presentation !== 'summary')
        .map((r) => {
          const header = `${r.rank}. ${r.file}:${r.startLine}-${r.endLine} (score: ${r.score.toFixed(3)}, ${r.presentation})`;
          const symbolInfo = r.symbol ? `\n   ${r.symbolType || 'symbol'}: ${r.symbol}` : '';
          const code = r.code ? `\n\`\`\`\n${r.code}\n\`\`\`` : '';
          return header + symbolInfo + code;
        });

      const summaries = agentResults
        .filter(r => r.presentation === 'summary')
        .map(r => `${r.rank}. ${r.summary}`);

      const confidence = `Confidence: ${searchResult.confidence} (${searchResult.confidenceReason})`;
      const budget = `Tokens: ${searchResult.tokensUsed}/${searchResult.tokenBudget}`;

      const text = lines.length > 0
        ? `${confidence} | ${budget}\n\n${lines.join('\n\n')}${summaries.length ? '\n\nAlso found:\n' + summaries.join('\n') : ''}`
        : `No results found for "${query}"`;

      // Shape structuredContent to conform to SearchOutputSchema
      const structured = {
        results: agentResults.map(r => ({
          file: r.file,
          score: r.score,
          rank: r.rank,
          startLine: r.startLine ?? null,
          endLine: r.endLine ?? null,
          symbol: r.symbol ?? null,
          symbolType: r.symbolType ?? null,
          presentation: r.presentation,
          code: r.code ?? null,
          codeTokens: r.codeTokens,
        })),
        totalFound: searchResult.totalResults,
        mode: searchResult.mode,
        queryTimeMs: searchResult.latencyMs,
        format: searchResult.format,
        subMode: searchResult.subMode,
        query: searchResult.query,
        regex: searchResult.regex,
        totalResults: searchResult.totalResults,
        tokenBudget: searchResult.tokenBudget,
        tokensUsed: searchResult.tokensUsed,
        confidence: searchResult.confidence,
        confidenceReason: searchResult.confidenceReason,
        sufficient: searchResult.sufficient,
        sufficiencyReasons: searchResult.sufficiencyReasons || [],
        packagingMs: searchResult.packagingMs,
        latencyMs: searchResult.latencyMs,
      };

      return {
        content: [{ type: 'text', text }],
        structuredContent: structured,
      };
    }

    // Standard benchmark mode
    const { results, stats } = searchResult;
    const structured = {
      format: 'benchmark',
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
      .split('\n')[0]
      .replace(/\/[^\s:]+/g, '<path>')
      .replace(/[A-Z]:\\[^\s:]+/gi, '<path>')
      .replace(/\\\\[^\s:]+/g, '<path>');
    return {
      content: [{ type: 'text', text: `Search error: ${safeMessage}` }],
      isError: true,
    };
  }
}

/**
 * @param {{ mode: string }} args
 * @param {{ PROJECT_ROOT: string, coreDir: string }} deps
 */
export async function handleIndex({ mode }, { PROJECT_ROOT, coreDir }) {
  const indexerPath = path.join(coreDir, 'indexing', 'index-codebase-v21.js');
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
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      } }, 5000);
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
}

/**
 * @param {{ getConfig: () => Promise<object>, PROJECT_ROOT: string }} deps
 */
export async function checkHealth({ getConfig, PROJECT_ROOT }) {
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
      { name: 'late-interaction', check: () => existsSync(config.DB_PATHS.lateInteraction || path.join(PROJECT_ROOT, '.sweet-search', 'late-interaction-tokens.db')) },
      { name: 'embedding-service', check: () => true },
      { name: 'reranker', check: () => true },
      { name: 'query-router', check: () => true },
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
          const { applyReadPragmas } = await import('../core/infrastructure/index.js');
          applyReadPragmas(_healthDb);
        }
        const count = _healthDb.prepare('SELECT count(*) as cnt FROM entities').get();
        indexStats.totalFiles = count?.cnt || 0;
      }
    } catch (e) {
      // SQLITE_BUSY or stale connection — reset cache and continue
      try { _healthDb?.close(); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
      _healthDb = null;
    }

  } catch (e) {
    healthy = false;
    subsystems['config'] = { status: 'error', details: e.message };
  }

  return { healthy, projectRoot: path.basename(PROJECT_ROOT), subsystems, indexStats };
}

/**
 * @param {{ tokenBudget: number, focusFiles?: string[], focusEntities?: string[] }} args
 * @param {{ coreDir: string }} deps
 */
export async function handleRepoMap({ tokenBudget, focusFiles, focusEntities }, { coreDir }) {
  try {
    const { generateRepoMap } = await import(
      path.join(coreDir, 'graph', 'index.js')
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
}

/**
 * @param {{ depth: string, modes: string[], top: number, incremental: boolean, dryRun: boolean, stats: boolean, localWarmup?: boolean, provider?: string }} args
 * @param {{ coreDir: string }} deps
 */
export async function handleVocabPrewarm({ depth, modes, top, incremental, dryRun, stats, localWarmup, provider }, { coreDir }) {
  try {
    if (stats) {
      const { getTelemetryReport } = await import(
        path.join(coreDir, 'embedding', 'index.js')
      );
      const { WarmupMetrics, formatStatsReport } = await import(
        path.join(coreDir, 'search', 'index.js')
      );
      const report = await getTelemetryReport(500);
      const metrics = new WarmupMetrics();
      metrics.loadFromReport(report);
      const text = formatStatsReport(metrics);
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          termsMined: 0,
          communitiesDetected: 0,
          warmupTimeMs: 0,
          hitRateProjection: metrics.overallHitRate(),
        },
      };
    }

    const { runFullWarmup } = await import(
      path.join(coreDir, 'vocabulary', 'index.js')
    );

    const result = await runFullWarmup({
      depth,
      top,
      modes,
      incremental,
      dryRun,
      localWarmup,
      provider,
    });

    const structured = {
      termsMined: result.terms ?? 0,
      communitiesDetected: result.communities ?? 0,
      warmupTimeMs: result.timing?.total || 0,
      perMode: result.timing || {},
      hitRateProjection: 0,
      dryRun: dryRun || false,
    };

    const modeLines = ['lexical', 'semantic', 'hybrid']
      .filter(m => structured.perMode[m] != null)
      .map(m => `  ${m}: ${structured.perMode[m]}ms`);

    const text = dryRun
      ? `[dry-run] Would mine ${structured.termsMined} terms, ${structured.communitiesDetected} communities`
      : `Vocab prewarm complete: ${structured.termsMined} terms, ${structured.communitiesDetected} communities (${structured.warmupTimeMs}ms)\n${modeLines.join('\n')}`;

    return {
      content: [{ type: 'text', text }],
      structuredContent: structured,
    };
  } catch (err) {
    const safeMessage = (err.message || 'Vocab prewarm failed')
      .split('\n')[0]
      .replace(/\/[^\s:]+/g, '<path>')
      .replace(/[A-Z]:\\[^\s:]+/gi, '<path>')
      .replace(/\\\\[^\s:]+/g, '<path>');
    return {
      content: [{ type: 'text', text: `Vocab prewarm error: ${safeMessage}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// read — filesystem-grounded reader
// ---------------------------------------------------------------------------

/**
 * @param {{ files: Array<{path: string, startLine?: number, endLine?: number}>, includeMetadata?: boolean }} args
 * @param {{ PROJECT_ROOT: string }} deps
 */
export async function handleRead(args, deps) {
  try {
    const { readFiles, formatReadResults } = await import('../core/search/index.js');
    const result = await readFiles(args.files || [], {
      projectRoot: deps.PROJECT_ROOT,
      includeMetadata: args.includeMetadata !== false,
    });
    return {
      content: [{ type: 'text', text: formatReadResults(result, 'agent') }],
      structuredContent: result,
    };
  } catch (err) {
    const msg = (err.message || 'read failed').split('\n')[0];
    return { content: [{ type: 'text', text: `read error: ${msg}` }], isError: true };
  }
}

// ---------------------------------------------------------------------------
// read-semantic — hybrid span selection + filesystem-grounded re-read
// ---------------------------------------------------------------------------

/**
 * @param {{ file: string, query: string, topK?: number, threshold?: number, contextLines?: number, maxChars?: number, maxTokens?: number, verbose?: boolean }} args
 * @param {{ PROJECT_ROOT: string }} deps
 */
export async function handleReadSemantic(args, deps) {
  try {
    const { readSemantic, formatReadSemanticResult } = await import('../core/search/index.js');
    const result = await readSemantic({
      path: args.file,
      query: args.query,
      topK: args.topK,
      threshold: args.threshold,
      contextLines: args.contextLines,
      maxChars: args.maxChars,
      maxTokens: args.maxTokens,
      projectRoot: deps.PROJECT_ROOT,
      verbose: args.verbose,
    });
    return {
      content: [{ type: 'text', text: formatReadSemanticResult(result, 'agent') }],
      structuredContent: result,
    };
  } catch (err) {
    const msg = (err.message || 'read-semantic failed').split('\n')[0];
    return { content: [{ type: 'text', text: `read-semantic error: ${msg}` }], isError: true };
  }
}
