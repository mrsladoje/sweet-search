/**
 * Embedding Telemetry Unit Tests
 *
 * Tests for all exports from core/embedding-telemetry.js.
 * Mocks fs/promises and config.js to avoid real file I/O in most tests.
 * Uses temp directory for integration-style tests of file reading.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Mock config.js to control TELEMETRY_PATH
// ---------------------------------------------------------------------------

const testTmpDir = mkdtempSync(join(tmpdir(), 'telemetry-test-'));
const testTelemetryPath = join(testTmpDir, 'query-telemetry.jsonl');

vi.mock('../core/config.js', () => ({
  DB_PATHS: {
    vocabulary: join(testTmpDir, 'query-vocabulary.json'),
  },
}));

// Now import the module under test (after mocks are set up)
const {
  telemetryStats,
  resetTelemetryStats,
  recordQueryTelemetry,
  getTelemetryReport,
} = await import('../core/embedding-telemetry.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  resetTelemetryStats();
  // Clean up telemetry file between tests
  try { rmSync(testTelemetryPath, { force: true }); } catch {}
  try { rmSync(testTelemetryPath + '.bak', { force: true }); } catch {}
});


// ---------------------------------------------------------------------------
// telemetryStats
// ---------------------------------------------------------------------------

describe('telemetryStats', () => {
  it('has lexical, semantic, hybrid buckets', () => {
    expect(telemetryStats).toHaveProperty('lexical');
    expect(telemetryStats).toHaveProperty('semantic');
    expect(telemetryStats).toHaveProperty('hybrid');
  });

  it('each bucket has hits, misses, totalLatencyMs, count initialized to 0', () => {
    for (const mode of ['lexical', 'semantic', 'hybrid']) {
      const bucket = telemetryStats[mode];
      expect(bucket.hits).toBe(0);
      expect(bucket.misses).toBe(0);
      expect(bucket.totalLatencyMs).toBe(0);
      expect(bucket.count).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// resetTelemetryStats
// ---------------------------------------------------------------------------

describe('resetTelemetryStats', () => {
  it('zeros all counters', () => {
    // Mutate stats first
    telemetryStats.lexical.hits = 10;
    telemetryStats.lexical.misses = 5;
    telemetryStats.lexical.totalLatencyMs = 500;
    telemetryStats.lexical.count = 15;
    telemetryStats.semantic.hits = 3;

    resetTelemetryStats();

    for (const mode of ['lexical', 'semantic', 'hybrid']) {
      const bucket = telemetryStats[mode];
      expect(bucket.hits).toBe(0);
      expect(bucket.misses).toBe(0);
      expect(bucket.totalLatencyMs).toBe(0);
      expect(bucket.count).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// recordQueryTelemetry
// ---------------------------------------------------------------------------

describe('recordQueryTelemetry', () => {
  it('increments in-memory stats for a cache hit', async () => {
    await recordQueryTelemetry('lexical', true, 12.5);

    expect(telemetryStats.lexical.count).toBe(1);
    expect(telemetryStats.lexical.hits).toBe(1);
    expect(telemetryStats.lexical.misses).toBe(0);
    expect(telemetryStats.lexical.totalLatencyMs).toBe(12.5);
  });

  it('increments in-memory stats for a cache miss', async () => {
    await recordQueryTelemetry('semantic', false, 45.2);

    expect(telemetryStats.semantic.count).toBe(1);
    expect(telemetryStats.semantic.hits).toBe(0);
    expect(telemetryStats.semantic.misses).toBe(1);
    expect(telemetryStats.semantic.totalLatencyMs).toBe(45.2);
  });

  it('accumulates multiple calls', async () => {
    await recordQueryTelemetry('hybrid', true, 10);
    await recordQueryTelemetry('hybrid', false, 20);
    await recordQueryTelemetry('hybrid', true, 30);

    expect(telemetryStats.hybrid.count).toBe(3);
    expect(telemetryStats.hybrid.hits).toBe(2);
    expect(telemetryStats.hybrid.misses).toBe(1);
    expect(telemetryStats.hybrid.totalLatencyMs).toBe(60);
  });

  it('ignores unknown mode gracefully', async () => {
    // Should not throw
    await recordQueryTelemetry('unknown_mode', true, 10);
    // Stats unchanged
    expect(telemetryStats.lexical.count).toBe(0);
    expect(telemetryStats.semantic.count).toBe(0);
    expect(telemetryStats.hybrid.count).toBe(0);
  });

  it('writes to JSONL file', async () => {
    await recordQueryTelemetry('lexical', true, 5.5, 'test query', 'api');

    const { readFileSync } = await import('fs');
    const content = readFileSync(testTelemetryPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.mode).toBe('lexical');
    expect(entry.hit).toBe(true);
    expect(entry.query).toBe('test query');
    expect(entry.source).toBe('api');
  });

  it('includes optional fields when provided', async () => {
    await recordQueryTelemetry('hybrid', true, 10, 'find user', 'vocabulary', true, false);

    const { readFileSync } = await import('fs');
    const content = readFileSync(testTelemetryPath, 'utf-8');
    const entry = JSON.parse(content.trim().split('\n').pop());
    expect(entry.query).toBe('find user');
    expect(entry.source).toBe('vocabulary');
    expect(entry.lexicalHit).toBe(true);
    expect(entry.semanticHit).toBe(false);
  });

  it('omits optional fields when not provided', async () => {
    await recordQueryTelemetry('semantic', false, 20);

    const { readFileSync } = await import('fs');
    const content = readFileSync(testTelemetryPath, 'utf-8');
    const entry = JSON.parse(content.trim().split('\n').pop());
    expect(entry).not.toHaveProperty('query');
    expect(entry).not.toHaveProperty('source');
    expect(entry).not.toHaveProperty('lexicalHit');
    expect(entry).not.toHaveProperty('semanticHit');
  });
});

// ---------------------------------------------------------------------------
// getTelemetryReport
// ---------------------------------------------------------------------------

describe('getTelemetryReport', () => {
  it('returns zero report when no file exists', async () => {
    const report = await getTelemetryReport();
    expect(report.total).toBe(0);
    expect(report.modes.lexical.count).toBe(0);
    expect(report.modes.semantic.count).toBe(0);
    expect(report.modes.hybrid.count).toBe(0);
  });

  it('reads and aggregates JSONL entries', async () => {
    // Write test JSONL data
    const entries = [
      { mode: 'lexical', hit: true, latencyMs: 10 },
      { mode: 'lexical', hit: false, latencyMs: 20 },
      { mode: 'semantic', hit: true, latencyMs: 5 },
    ];
    mkdirSync(join(testTmpDir), { recursive: true });
    writeFileSync(testTelemetryPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const report = await getTelemetryReport(100);
    expect(report.total).toBe(3);
    expect(report.modes.lexical.count).toBe(2);
    expect(report.modes.lexical.hits).toBe(1);
    expect(report.modes.lexical.misses).toBe(1);
    expect(report.modes.semantic.count).toBe(1);
    expect(report.modes.semantic.hits).toBe(1);
  });

  it('respects lastN parameter', async () => {
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push({ mode: 'lexical', hit: i % 2 === 0, latencyMs: i * 10 });
    }
    writeFileSync(testTelemetryPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const report = await getTelemetryReport(3);
    expect(report.total).toBe(3);
    expect(report.modes.lexical.count).toBe(3);
  });

  it('formats hitRate as percentage string', async () => {
    const entries = [
      { mode: 'lexical', hit: true, latencyMs: 10 },
      { mode: 'lexical', hit: true, latencyMs: 10 },
      { mode: 'lexical', hit: false, latencyMs: 10 },
    ];
    writeFileSync(testTelemetryPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const report = await getTelemetryReport();
    expect(report.modes.lexical.hitRate).toBe('66.7%');
  });

  it('computes avgLatencyMs correctly', async () => {
    const entries = [
      { mode: 'semantic', hit: true, latencyMs: 10 },
      { mode: 'semantic', hit: true, latencyMs: 20 },
      { mode: 'semantic', hit: false, latencyMs: 30 },
    ];
    writeFileSync(testTelemetryPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const report = await getTelemetryReport();
    expect(report.modes.semantic.avgLatencyMs).toBe(20);
  });

  it('shows 0.0% hitRate when no entries for a mode', async () => {
    const entries = [
      { mode: 'lexical', hit: true, latencyMs: 10 },
    ];
    writeFileSync(testTelemetryPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const report = await getTelemetryReport();
    expect(report.modes.semantic.hitRate).toBe('0.0%');
    expect(report.modes.hybrid.hitRate).toBe('0.0%');
  });

  it('skips malformed JSON lines', async () => {
    const content = [
      JSON.stringify({ mode: 'lexical', hit: true, latencyMs: 10 }),
      'not valid json{{{',
      JSON.stringify({ mode: 'semantic', hit: false, latencyMs: 5 }),
    ].join('\n') + '\n';
    writeFileSync(testTelemetryPath, content);

    const report = await getTelemetryReport();
    // Design intent: total counts all JSONL lines (including malformed) for file-size monitoring.
    // Parsed entry counts are per-mode in report.modes.
    expect(report.total).toBe(3);
    expect(report.modes.lexical.count).toBe(1);
    expect(report.modes.semantic.count).toBe(1);
  });
});
