/**
 * Warmup Metrics Tests
 *
 * Tests for WarmupMetrics class, isWarmupHit, getPromotionCandidates,
 * getDemotionCandidates, estimateWorkingSetSize, formatStatsReport,
 * and parseTelemetryEntries.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  WarmupMetrics,
  isWarmupHit,
  getPromotionCandidates,
  getDemotionCandidates,
  estimateWorkingSetSize,
  formatStatsReport,
  parseTelemetryEntries,
} from '../../core/search/warmup-metrics.js';

// ---------------------------------------------------------------------------
// WarmupMetrics class
// ---------------------------------------------------------------------------

describe('WarmupMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new WarmupMetrics();
  });

  describe('constructor', () => {
    it('initializes all modes with zero counters', () => {
      for (const mode of ['lexical', 'semantic', 'hybrid']) {
        expect(metrics[mode].hits).toBe(0);
        expect(metrics[mode].misses).toBe(0);
        expect(metrics[mode].count).toBe(0);
        expect(metrics[mode].totalLatencyMs).toBe(0);
        expect(metrics[mode].latencies).toEqual([]);
      }
    });
  });

  describe('hitRate', () => {
    it('returns 0 for empty bucket', () => {
      expect(metrics.hitRate('lexical')).toBe(0);
    });

    it('calculates correct hit rate', () => {
      metrics.lexical.hits = 7;
      metrics.lexical.misses = 3;
      expect(metrics.hitRate('lexical')).toBeCloseTo(0.7);
    });

    it('returns 1.0 for all hits', () => {
      metrics.semantic.hits = 10;
      metrics.semantic.misses = 0;
      expect(metrics.hitRate('semantic')).toBe(1.0);
    });

    it('returns 0 for unknown mode', () => {
      expect(metrics.hitRate('unknown')).toBe(0);
    });
  });

  describe('overallHitRate', () => {
    it('returns 0 when no queries', () => {
      expect(metrics.overallHitRate()).toBe(0);
    });

    it('computes weighted average across modes', () => {
      metrics.lexical.hits = 8;
      metrics.lexical.misses = 2;
      metrics.semantic.hits = 6;
      metrics.semantic.misses = 4;
      // total: 14 hits / 20 queries = 0.7
      expect(metrics.overallHitRate()).toBeCloseTo(0.7);
    });
  });

  describe('avgLatency', () => {
    it('returns 0 for empty mode', () => {
      expect(metrics.avgLatency('lexical')).toBe(0);
    });

    it('computes average correctly', () => {
      metrics.lexical.totalLatencyMs = 100;
      metrics.lexical.count = 10;
      expect(metrics.avgLatency('lexical')).toBe(10);
    });
  });

  describe('latencyPercentile', () => {
    it('returns 0 for empty latencies', () => {
      expect(metrics.latencyPercentile('lexical', 50)).toBe(0);
    });

    it('computes p50 correctly', () => {
      metrics.lexical.latencies = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(metrics.latencyPercentile('lexical', 50)).toBe(6);
    });

    it('computes p95 correctly', () => {
      metrics.lexical.latencies = Array.from({ length: 100 }, (_, i) => i + 1);
      const p95 = metrics.latencyPercentile('lexical', 95);
      expect(p95).toBe(96);
    });

    it('handles single entry', () => {
      metrics.lexical.latencies = [42];
      expect(metrics.latencyPercentile('lexical', 50)).toBe(42);
      expect(metrics.latencyPercentile('lexical', 99)).toBe(42);
    });
  });

  describe('loadFromEntries', () => {
    it('populates mode buckets from entries', () => {
      const entries = [
        { mode: 'lexical', hit: true, latencyMs: 2 },
        { mode: 'lexical', hit: false, latencyMs: 10 },
        { mode: 'semantic', hit: true, latencyMs: 50 },
      ];
      metrics.loadFromEntries(entries);
      expect(metrics.lexical.hits).toBe(1);
      expect(metrics.lexical.misses).toBe(1);
      expect(metrics.lexical.count).toBe(2);
      expect(metrics.semantic.hits).toBe(1);
      expect(metrics.semantic.count).toBe(1);
    });

    it('ignores entries with unknown modes', () => {
      metrics.loadFromEntries([{ mode: 'unknown', hit: true, latencyMs: 5 }]);
      expect(metrics.lexical.count).toBe(0);
    });
  });

  describe('loadFromReport', () => {
    it('loads stats from telemetry report format', () => {
      const report = {
        modes: {
          lexical: { hits: 10, misses: 5, avgLatencyMs: 3, count: 15 },
          semantic: { hits: 8, misses: 2, avgLatencyMs: 50, count: 10 },
        },
      };
      metrics.loadFromReport(report);
      expect(metrics.lexical.hits).toBe(10);
      expect(metrics.lexical.misses).toBe(5);
      expect(metrics.lexical.count).toBe(15);
      expect(metrics.lexical.totalLatencyMs).toBe(45); // 3 * 15
      expect(metrics.semantic.hits).toBe(8);
    });

    it('handles null report gracefully', () => {
      metrics.loadFromReport(null);
      expect(metrics.lexical.hits).toBe(0);
    });

    it('handles missing modes', () => {
      metrics.loadFromReport({ modes: {} });
      expect(metrics.lexical.hits).toBe(0);
    });
  });

  describe('reset', () => {
    it('zeros all counters', () => {
      metrics.lexical.hits = 100;
      metrics.semantic.misses = 50;
      metrics.hybrid.count = 25;
      metrics.reset();
      for (const mode of ['lexical', 'semantic', 'hybrid']) {
        expect(metrics[mode].hits).toBe(0);
        expect(metrics[mode].misses).toBe(0);
        expect(metrics[mode].count).toBe(0);
        expect(metrics[mode].totalLatencyMs).toBe(0);
        expect(metrics[mode].latencies).toEqual([]);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// isWarmupHit
// ---------------------------------------------------------------------------

describe('isWarmupHit', () => {
  it('lexical: hit when latencyMs < 5', () => {
    expect(isWarmupHit({ mode: 'lexical', latencyMs: 2 })).toBe(true);
    expect(isWarmupHit({ mode: 'lexical', latencyMs: 4.9 })).toBe(true);
  });

  it('lexical: miss when latencyMs >= 5', () => {
    expect(isWarmupHit({ mode: 'lexical', latencyMs: 5 })).toBe(false);
    expect(isWarmupHit({ mode: 'lexical', latencyMs: 100 })).toBe(false);
  });

  it('lexical: miss when latencyMs is undefined', () => {
    expect(isWarmupHit({ mode: 'lexical' })).toBe(false);
  });

  it('semantic: hit when source is vocabulary', () => {
    expect(isWarmupHit({ mode: 'semantic', source: 'vocabulary' })).toBe(true);
  });

  it('semantic: hit when source is semantic-cache', () => {
    expect(isWarmupHit({ mode: 'semantic', source: 'semantic-cache' })).toBe(true);
  });

  it('semantic: miss when source is api', () => {
    expect(isWarmupHit({ mode: 'semantic', source: 'api' })).toBe(false);
  });

  it('hybrid: hit when both sub-modes hit', () => {
    expect(isWarmupHit({ mode: 'hybrid', lexicalHit: true, semanticHit: true })).toBe(true);
  });

  it('hybrid: miss when only one sub-mode hits', () => {
    expect(isWarmupHit({ mode: 'hybrid', lexicalHit: true, semanticHit: false })).toBe(false);
    expect(isWarmupHit({ mode: 'hybrid', lexicalHit: false, semanticHit: true })).toBe(false);
  });

  it('unknown mode returns false', () => {
    expect(isWarmupHit({ mode: 'unknown' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPromotionCandidates
// ---------------------------------------------------------------------------

describe('getPromotionCandidates', () => {
  it('promotes terms queried 3+ times not in vocabulary', () => {
    const entries = [
      { query: 'AuthService', hit: true },
      { query: 'AuthService', hit: true },
      { query: 'AuthService', hit: false },
    ];
    const vocab = new Set();
    const candidates = getPromotionCandidates(entries, vocab);
    expect(candidates.length).toBe(1);
    expect(candidates[0].term).toBe('authservice');
    expect(candidates[0].reason).toBe('promote');
    expect(candidates[0].queryCount).toBe(3);
  });

  it('skips terms already in vocabulary', () => {
    const entries = [
      { query: 'AuthService', hit: true },
      { query: 'AuthService', hit: true },
      { query: 'AuthService', hit: false },
    ];
    const vocab = new Set(['authservice']);
    const candidates = getPromotionCandidates(entries, vocab);
    expect(candidates.length).toBe(0);
  });

  it('fast-promotes code identifier misses', () => {
    const entries = [
      { query: 'NewEntity', hit: false, source: 'code-identifier' },
    ];
    const vocab = new Set();
    const candidates = getPromotionCandidates(entries, vocab);
    expect(candidates.length).toBe(1);
    expect(candidates[0].reason).toBe('fast-promote');
  });

  it('deduplicates fast-promote and promote', () => {
    const entries = [
      { query: 'MyService', hit: false, source: 'code-identifier' },
      { query: 'MyService', hit: false, source: 'code-identifier' },
      { query: 'MyService', hit: false, source: 'code-identifier' },
    ];
    const vocab = new Set();
    const candidates = getPromotionCandidates(entries, vocab);
    // Only one entry for MyService (promote wins at 3+ count)
    expect(candidates.length).toBe(1);
    expect(candidates[0].reason).toBe('promote');
  });

  it('sorts by query count descending', () => {
    const entries = [
      ...Array(5).fill({ query: 'High' }),
      ...Array(3).fill({ query: 'Low' }),
    ];
    const vocab = new Set();
    const candidates = getPromotionCandidates(entries, vocab);
    expect(candidates[0].queryCount).toBeGreaterThanOrEqual(candidates[1]?.queryCount || 0);
  });

  it('handles empty entries', () => {
    expect(getPromotionCandidates([], new Set())).toEqual([]);
  });

  it('handles entries with null queries', () => {
    const entries = [{ query: null }, { query: undefined }];
    expect(getPromotionCandidates(entries, new Set())).toEqual([]);
  });

  it('works with Map as vocabulary', () => {
    const entries = [
      { query: 'test', hit: false, source: 'code-identifier' },
    ];
    const vocab = new Map([['test', true]]);
    const candidates = getPromotionCandidates(entries, vocab);
    expect(candidates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDemotionCandidates
// ---------------------------------------------------------------------------

describe('getDemotionCandidates', () => {
  it('demotes terms not seen in N days', () => {
    const vocab = new Set(['oldterm', 'recentterm']);
    const now = Date.now();
    const entries = [
      { query: 'recentterm', timestamp: new Date(now).toISOString() },
      { query: 'oldterm', timestamp: new Date(now - 10 * 86400000).toISOString() },
    ];
    const candidates = getDemotionCandidates(vocab, entries, 7);
    expect(candidates.length).toBe(1);
    expect(candidates[0].term).toBe('oldterm');
    expect(candidates[0].reason).toBe('inactive');
  });

  it('returns all terms when none have been queried', () => {
    const vocab = new Set(['a', 'b', 'c']);
    const candidates = getDemotionCandidates(vocab, [], 7);
    expect(candidates.length).toBe(3);
  });

  it('lastSeen is null when never queried', () => {
    const vocab = new Set(['orphan']);
    const candidates = getDemotionCandidates(vocab, [], 7);
    expect(candidates[0].lastSeen).toBeNull();
  });

  it('works with Map as vocabulary', () => {
    const vocab = new Map([['a', 1], ['b', 2]]);
    const candidates = getDemotionCandidates(vocab, [], 7);
    expect(candidates.length).toBe(2);
  });

  it('handles empty vocabulary', () => {
    expect(getDemotionCandidates(new Set(), [], 7)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// estimateWorkingSetSize
// ---------------------------------------------------------------------------

describe('estimateWorkingSetSize', () => {
  it('returns well-sized for empty inputs', () => {
    const result = estimateWorkingSetSize([], 7 * 86400000, 0, 2000);
    expect(result.wss).toBe(0);
    expect(result.recommendation).toBe('well-sized');
  });

  it('recommends expand when WSS > warmupSize', () => {
    const now = Date.now();
    const entries = Array.from({ length: 100 }, (_, i) => ({
      query: `query${i}`,
      timestamp: new Date(now - 1000).toISOString(),
    }));
    const result = estimateWorkingSetSize(entries, 7 * 86400000, 10, 2000);
    expect(result.wss).toBe(100);
    expect(result.recommendation).toBe('expand');
  });

  it('recommends converged when WSS > warmupSize >= maxWarmup', () => {
    const now = Date.now();
    const entries = Array.from({ length: 100 }, (_, i) => ({
      query: `query${i}`,
      timestamp: new Date(now - 1000).toISOString(),
    }));
    const result = estimateWorkingSetSize(entries, 7 * 86400000, 50, 50);
    expect(result.recommendation).toBe('converged');
  });

  it('recommends well-sized when WSS <= warmupSize', () => {
    const now = Date.now();
    const entries = [
      { query: 'a', timestamp: new Date(now - 1000).toISOString() },
      { query: 'b', timestamp: new Date(now - 1000).toISOString() },
    ];
    const result = estimateWorkingSetSize(entries, 7 * 86400000, 100, 2000);
    expect(result.wss).toBe(2);
    expect(result.recommendation).toBe('well-sized');
  });

  it('filters by time window', () => {
    const now = Date.now();
    const entries = [
      { query: 'recent', timestamp: new Date(now - 1000).toISOString() },
      { query: 'old', timestamp: new Date(now - 30 * 86400000).toISOString() },
    ];
    const result = estimateWorkingSetSize(entries, 7 * 86400000, 0, 2000);
    expect(result.wss).toBe(1); // Only 'recent' is within window
  });

  it('deduplicates queries', () => {
    const now = Date.now();
    const entries = [
      { query: 'same', timestamp: new Date(now - 1000).toISOString() },
      { query: 'same', timestamp: new Date(now - 2000).toISOString() },
      { query: 'same', timestamp: new Date(now - 3000).toISOString() },
    ];
    const result = estimateWorkingSetSize(entries, 7 * 86400000, 0, 2000);
    expect(result.wss).toBe(1);
  });

  it('caps clustering input size to avoid O(n^2) blow-up', () => {
    const now = Date.now();
    const entries = Array.from({ length: 1500 }, (_, i) => ({
      query: `q-${i}`,
      timestamp: new Date(now - 1000).toISOString(),
    }));
    const result = estimateWorkingSetSize(entries, 7 * 86400000, 0, 2000);
    expect(result.wss).toBeLessThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// formatStatsReport
// ---------------------------------------------------------------------------

describe('formatStatsReport', () => {
  it('renders report with metrics', () => {
    const metrics = new WarmupMetrics();
    metrics.lexical.hits = 80;
    metrics.lexical.misses = 20;
    metrics.semantic.hits = 60;
    metrics.semantic.misses = 40;
    metrics.hybrid.hits = 50;
    metrics.hybrid.misses = 50;

    const report = formatStatsReport(metrics, [], {
      identifierCount: 500,
      phraseCount: 100,
    });

    expect(report).toContain('Vocabulary Warmup Statistics');
    expect(report).toContain('500');
    expect(report).toContain('100');
    expect(report).toContain('Lexical');
    expect(report).toContain('Semantic');
    expect(report).toContain('Hybrid');
    expect(report).toContain('Overall');
  });

  it('includes community breakdown', () => {
    const metrics = new WarmupMetrics();
    const communities = [
      { id: 0, name: 'Auth Module', size: 50 },
      { id: 1, name: 'User Module', size: 30 },
    ];

    const report = formatStatsReport(metrics, communities);
    expect(report).toContain('Communities (Leiden)');
    expect(report).toContain('Auth Module');
    expect(report).toContain('User Module');
  });

  it('includes top cache misses', () => {
    const metrics = new WarmupMetrics();
    const vocabInfo = {
      topMisses: [
        { term: 'NewEntity', queryCount: 10 },
        { term: 'UnknownService', queryCount: 5 },
      ],
    };

    const report = formatStatsReport(metrics, [], vocabInfo);
    expect(report).toContain('Cache Misses');
    expect(report).toContain('NewEntity');
    expect(report).toContain('10x');
  });

  it('shows last warmup time', () => {
    const metrics = new WarmupMetrics();
    const report = formatStatsReport(metrics, [], {
      lastWarmup: new Date().toISOString(),
      warmupType: 'incremental',
    });
    expect(report).toContain('Last warmup');
    expect(report).toContain('incremental');
  });

  it('includes bar chart characters', () => {
    const metrics = new WarmupMetrics();
    metrics.lexical.hits = 5;
    metrics.lexical.misses = 5;
    const report = formatStatsReport(metrics);
    // Should contain block characters
    expect(report).toContain('\u2588');
    expect(report).toContain('\u2591');
  });

  it('handles zero queries gracefully', () => {
    const metrics = new WarmupMetrics();
    const report = formatStatsReport(metrics);
    expect(report).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// parseTelemetryEntries
// ---------------------------------------------------------------------------

describe('parseTelemetryEntries', () => {
  it('parses valid JSONL content', () => {
    const content = '{"mode":"lexical","hit":true,"latencyMs":2}\n{"mode":"semantic","hit":false,"latencyMs":50}\n';
    const entries = parseTelemetryEntries(content);
    expect(entries.length).toBe(2);
    expect(entries[0].mode).toBe('lexical');
    expect(entries[1].hit).toBe(false);
  });

  it('skips malformed lines', () => {
    const content = '{"valid":true}\nBAD LINE\n{"also":"valid"}\n';
    const entries = parseTelemetryEntries(content);
    expect(entries.length).toBe(2);
  });

  it('handles empty content', () => {
    expect(parseTelemetryEntries('')).toEqual([]);
  });

  it('respects lastN parameter', () => {
    const content = '{"a":1}\n{"b":2}\n{"c":3}\n{"d":4}\n{"e":5}\n';
    const entries = parseTelemetryEntries(content, 3);
    expect(entries.length).toBe(3);
    expect(entries[0].c).toBe(3);
    expect(entries[2].e).toBe(5);
  });

  it('returns all entries when lastN=0', () => {
    const content = '{"a":1}\n{"b":2}\n{"c":3}\n';
    const entries = parseTelemetryEntries(content, 0);
    expect(entries.length).toBe(3);
  });

  it('handles content with blank lines', () => {
    const content = '{"a":1}\n\n\n{"b":2}\n';
    const entries = parseTelemetryEntries(content);
    expect(entries.length).toBe(2);
  });
});
