import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { handleVocabPrewarm } from '../mcp/tool-handlers.js';

describe('MCP tool handlers integration', () => {
  it('handleVocabPrewarm executes stats path via dynamic imports', async () => {
    const coreDir = mkdtempSync(path.join(tmpdir(), 'mcp-vocab-stats-'));
    try {
      writeFileSync(
        path.join(coreDir, 'embedding-cache.js'),
        `export async function getTelemetryReport() { return { modes: { lexical: { hits: 3, misses: 1, avgLatencyMs: 2, count: 4 } } }; }\n`
      );
      writeFileSync(
        path.join(coreDir, 'warmup-metrics.js'),
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
      writeFileSync(
        path.join(coreDir, 'vocab-warmer.js'),
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

