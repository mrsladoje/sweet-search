import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { handleSearch, handleVocabPrewarm } from '../../mcp/tool-handlers.js';

describe('MCP agent shown-span trailer', () => {
  it('is default-on, agent-only, and lists only complete full spans', async () => {
    const previous = process.env.SWEET_SEARCH_SHOWN_SPAN_TRAILER;
    delete process.env.SWEET_SEARCH_SHOWN_SPAN_TRAILER;
    try {
      const result = await handleSearch({ query: 'q', k: 2, mode: 'auto', format: 'agent' }, {
        PROJECT_ROOT: '/repo',
        getSearcher: async () => ({
          search: async () => ({
            format: 'agent',
            results: [
              { rank: 1, file: 'src/a.js', startLine: 2, endLine: 3, score: 1, presentation: 'full', code: 'a\nb', codeTokens: 2 },
              { rank: 2, file: 'src/b.js', startLine: 1, endLine: 20, score: 0.5, presentation: 'full', code: 'short\n// ... (18 more lines)', codeTokens: 5 },
            ],
            confidence: 'high', confidenceReason: 'test', tokensUsed: 7, tokenBudget: 100,
            totalResults: 2, mode: 'auto', latencyMs: 1, subMode: 'agent', query: 'q',
          }),
        }),
      });
      expect(result.content[0].text).toContain('shown-full: src/a.js:2-3');
      expect(result.content[0].text).not.toContain('shown-full: src/b.js');
    } finally {
      if (previous == null) delete process.env.SWEET_SEARCH_SHOWN_SPAN_TRAILER;
      else process.env.SWEET_SEARCH_SHOWN_SPAN_TRAILER = previous;
    }
  });
});

describe('MCP tool handlers integration', () => {
  it('handleVocabPrewarm executes stats path via dynamic imports', async () => {
    const coreDir = mkdtempSync(path.join(tmpdir(), 'mcp-vocab-stats-'));
    try {
      // Create domain directory structure matching barrel imports
      mkdirSync(path.join(coreDir, 'embedding'), { recursive: true });
      mkdirSync(path.join(coreDir, 'search'), { recursive: true });

      writeFileSync(
        path.join(coreDir, 'embedding', 'index.js'),
        `export async function getTelemetryReport() { return { modes: { lexical: { hits: 3, misses: 1, avgLatencyMs: 2, count: 4 } } }; }\n`
      );
      writeFileSync(
        path.join(coreDir, 'search', 'index.js'),
        `
          export class WarmupMetrics {
            constructor() { this._rate = 0; }
            loadFromReport(r) {
              const m = r?.modes?.lexical || { hits: 0, misses: 0 };
              const total = (m.hits || 0) + (m.misses || 0);
              this._rate = total > 0 ? (m.hits || 0) / total : 0;
            }
            overallHitRate() { return this._rate; }
          }
          export function formatStatsReport() { return 'stats-report-ok'; }
        `
      );

      const res = await handleVocabPrewarm(
        { depth: 'medium', modes: ['lexical'], top: 100, incremental: true, dryRun: false, stats: true },
        { coreDir }
      );

      expect(res.isError).toBeUndefined();
      expect(res.content?.[0]?.text).toContain('stats-report-ok');
      expect(res.structuredContent.hitRateProjection).toBeCloseTo(0.75);
    } finally {
      rmSync(coreDir, { recursive: true, force: true });
    }
  });

  it('handleVocabPrewarm executes warmup path and maps structured output', async () => {
    const coreDir = mkdtempSync(path.join(tmpdir(), 'mcp-vocab-run-'));
    try {
      mkdirSync(path.join(coreDir, 'vocabulary'), { recursive: true });

      writeFileSync(
        path.join(coreDir, 'vocabulary', 'index.js'),
        `
          export async function runFullWarmup(opts = {}) {
            return {
              terms: opts.top ?? 0,
              communities: (opts.modes || []).length,
              timing: { total: 42, lexical: 11, semantic: 13 }
            };
          }
        `
      );

      const res = await handleVocabPrewarm(
        {
          depth: 'deep',
          modes: ['lexical', 'semantic'],
          top: 321,
          incremental: false,
          dryRun: true,
          stats: false,
          localWarmup: true,
          provider: 'local',
        },
        { coreDir }
      );

      expect(res.isError).toBeUndefined();
      expect(res.structuredContent.termsMined).toBe(321);
      expect(res.structuredContent.communitiesDetected).toBe(2);
      expect(res.structuredContent.warmupTimeMs).toBe(42);
      expect(res.structuredContent.dryRun).toBe(true);
      expect(res.content?.[0]?.text).toContain('[dry-run]');
    } finally {
      rmSync(coreDir, { recursive: true, force: true });
    }
  });
});
