// mcp/tool-handlers.js — Extracted tool handler functions (SOLID refactor)
// Each handler receives its dependencies via a `deps` parameter.

import { z } from 'zod';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Output schemas (Zod — SDK converts to JSON Schema for clients)
// ---------------------------------------------------------------------------

export const SearchOutputSchema = z.object({
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

// ---------------------------------------------------------------------------
// Internal state for health DB cache (module-scoped, not exported)
// ---------------------------------------------------------------------------

let _healthDb = null;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @param {{ query: string, k: number, mode: string, structural?: boolean }} args
 * @param {{ getSearcher: () => Promise<object> }} deps
 */
export async function handleSearch({ query, k, mode, structural }, { getSearcher }) {
  try {
    const searcher = await getSearcher();
    const searchMode = structural ? 'structural' : mode;
    const { results, stats } = await searcher.search(query, {
      k,
      mode: searchMode,
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
          const { applyReadPragmas } = await import('../core/infrastructure/db-utils.js');
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
      path.join(coreDir, 'repo-map.js')
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
        path.join(coreDir, 'embedding-cache.js')
      );
      const { WarmupMetrics, formatStatsReport } = await import(
        path.join(coreDir, 'warmup-metrics.js')
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
      path.join(coreDir, 'vocab-warmer.js')
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
