/**
 * Telemetry Tests (embedding-cache.js telemetry additions)
 *
 * Tests for telemetryStats, recordQueryTelemetry, getTelemetryReport,
 * and resetTelemetryStats.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises
const mockReadFile = vi.fn(async () => '');
const mockWriteFile = vi.fn(async () => {});
const mockAppendFile = vi.fn(async () => {});
const mockMkdir = vi.fn(async () => {});
const mockRename = vi.fn(async () => {});

vi.mock('fs/promises', () => ({
  default: {
    readFile: (...args) => mockReadFile(...args),
    writeFile: (...args) => mockWriteFile(...args),
    appendFile: (...args) => mockAppendFile(...args),
    mkdir: (...args) => mockMkdir(...args),
    rename: (...args) => mockRename(...args),
  },
  readFile: (...args) => mockReadFile(...args),
  writeFile: (...args) => mockWriteFile(...args),
  appendFile: (...args) => mockAppendFile(...args),
  mkdir: (...args) => mockMkdir(...args),
  rename: (...args) => mockRename(...args),
}));

// Mock fs (sync)
const mockExistsSync = vi.fn(() => false);

vi.mock('fs', () => ({
  existsSync: (...args) => mockExistsSync(...args),
  readFileSync: vi.fn(() => '{}'),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ size: 100 })),
}));

import {
  telemetryStats,
  recordQueryTelemetry,
  getTelemetryReport,
  resetTelemetryStats,
} from '../core/embedding-cache.js';

// ---------------------------------------------------------------------------
// resetTelemetryStats
// ---------------------------------------------------------------------------

describe('resetTelemetryStats', () => {
  it('zeros all mode counters', () => {
    telemetryStats.lexical.hits = 100;
    telemetryStats.semantic.misses = 50;
    telemetryStats.hybrid.count = 25;
    telemetryStats.lexical.totalLatencyMs = 999;

    resetTelemetryStats();

    for (const mode of ['lexical', 'semantic', 'hybrid']) {
      expect(telemetryStats[mode].hits).toBe(0);
      expect(telemetryStats[mode].misses).toBe(0);
      expect(telemetryStats[mode].count).toBe(0);
      expect(telemetryStats[mode].totalLatencyMs).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// recordQueryTelemetry
// ---------------------------------------------------------------------------

describe('recordQueryTelemetry', () => {
  beforeEach(() => {
    resetTelemetryStats();
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('increments in-memory stats for hit', async () => {
    await recordQueryTelemetry('lexical', true, 2.5);
    expect(telemetryStats.lexical.hits).toBe(1);
    expect(telemetryStats.lexical.misses).toBe(0);
    expect(telemetryStats.lexical.count).toBe(1);
    expect(telemetryStats.lexical.totalLatencyMs).toBe(2.5);
  });

  it('increments in-memory stats for miss', async () => {
    await recordQueryTelemetry('semantic', false, 50);
    expect(telemetryStats.semantic.misses).toBe(1);
    expect(telemetryStats.semantic.hits).toBe(0);
    expect(telemetryStats.semantic.count).toBe(1);
  });

  it('appends JSONL entry to file', async () => {
    await recordQueryTelemetry('lexical', true, 3.0);
    expect(mockAppendFile).toHaveBeenCalled();
    const writtenData = mockAppendFile.mock.calls[0][1];
    const entry = JSON.parse(writtenData.trim());
    expect(entry.mode).toBe('lexical');
    expect(entry.hit).toBe(true);
    expect(entry.latencyMs).toBe(3);
    expect(entry.timestamp).toBeDefined();
  });

  it('rounds latency to 2 decimal places', async () => {
    await recordQueryTelemetry('hybrid', true, 1.23456789);
    const writtenData = mockAppendFile.mock.calls[0][1];
    const entry = JSON.parse(writtenData.trim());
    expect(entry.latencyMs).toBe(1.23);
  });

  it('ignores unknown modes', async () => {
    await recordQueryTelemetry('unknown', true, 1);
    // Should not throw, should not update any bucket
    expect(telemetryStats.lexical.count).toBe(0);
    expect(telemetryStats.semantic.count).toBe(0);
    expect(telemetryStats.hybrid.count).toBe(0);
  });

  it('creates directory before writing', async () => {
    await recordQueryTelemetry('lexical', true, 1);
    expect(mockMkdir).toHaveBeenCalled();
  });

  it('rotates file when exceeding 10k lines', async () => {
    mockExistsSync.mockReturnValue(true);
    // Simulate 10000 lines already in the file
    mockReadFile.mockResolvedValueOnce('{"a":1}\n'.repeat(10000));

    await recordQueryTelemetry('lexical', true, 1);
    expect(mockRename).toHaveBeenCalled();
  });

  it('does not rotate when under 10k lines', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValueOnce('{"a":1}\n'.repeat(100));

    await recordQueryTelemetry('lexical', true, 1);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('handles file I/O errors gracefully', async () => {
    mockAppendFile.mockRejectedValueOnce(new Error('EACCES'));
    // Should not throw
    await recordQueryTelemetry('lexical', true, 1);
    // In-memory stats should still be updated
    expect(telemetryStats.lexical.hits).toBe(1);
  });

  it('accumulates multiple recordings', async () => {
    await recordQueryTelemetry('lexical', true, 2);
    await recordQueryTelemetry('lexical', false, 10);
    await recordQueryTelemetry('lexical', true, 3);

    expect(telemetryStats.lexical.hits).toBe(2);
    expect(telemetryStats.lexical.misses).toBe(1);
    expect(telemetryStats.lexical.count).toBe(3);
    expect(telemetryStats.lexical.totalLatencyMs).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// getTelemetryReport
// ---------------------------------------------------------------------------

describe('getTelemetryReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('returns empty report when file does not exist', async () => {
    const report = await getTelemetryReport();
    expect(report.total).toBe(0);
    expect(report.modes.lexical.hits).toBe(0);
  });

  it('parses JSONL and computes per-mode stats', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValueOnce(
      '{"mode":"lexical","hit":true,"latencyMs":2}\n' +
      '{"mode":"lexical","hit":false,"latencyMs":10}\n' +
      '{"mode":"semantic","hit":true,"latencyMs":50}\n'
    );

    const report = await getTelemetryReport(100);
    expect(report.total).toBe(3);
    expect(report.modes.lexical.hits).toBe(1);
    expect(report.modes.lexical.misses).toBe(1);
    expect(report.modes.lexical.count).toBe(2);
    expect(report.modes.semantic.hits).toBe(1);
    expect(report.modes.semantic.count).toBe(1);
  });

  it('computes hit rate correctly', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValueOnce(
      '{"mode":"lexical","hit":true,"latencyMs":2}\n' +
      '{"mode":"lexical","hit":true,"latencyMs":3}\n' +
      '{"mode":"lexical","hit":false,"latencyMs":10}\n'
    );

    const report = await getTelemetryReport();
    expect(report.modes.lexical.hitRate).toBe('66.7%');
  });

  it('computes average latency correctly', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValueOnce(
      '{"mode":"lexical","hit":true,"latencyMs":10}\n' +
      '{"mode":"lexical","hit":true,"latencyMs":20}\n'
    );

    const report = await getTelemetryReport();
    expect(report.modes.lexical.avgLatencyMs).toBe(15);
  });

  it('respects lastN parameter', async () => {
    mockExistsSync.mockReturnValue(true);
    const lines = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ mode: 'lexical', hit: true, latencyMs: i })
    ).join('\n') + '\n';
    mockReadFile.mockResolvedValueOnce(lines);

    const report = await getTelemetryReport(10);
    expect(report.total).toBe(10);
    expect(report.modes.lexical.count).toBe(10);
  });

  it('handles read errors gracefully', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockRejectedValueOnce(new Error('EACCES'));

    const report = await getTelemetryReport();
    expect(report.total).toBe(0);
  });

  it('skips malformed JSON lines', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValueOnce(
      '{"mode":"lexical","hit":true,"latencyMs":2}\n' +
      'NOT JSON\n' +
      '{"mode":"semantic","hit":false,"latencyMs":50}\n'
    );

    const report = await getTelemetryReport();
    expect(report.total).toBe(3); // 3 non-empty lines read, 2 parsed
    expect(report.modes.lexical.count).toBe(1);
    expect(report.modes.semantic.count).toBe(1);
  });
});
