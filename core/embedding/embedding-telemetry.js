/**
 * Embedding Telemetry - Per-mode query telemetry for vocabulary prewarm pipeline.
 * Extracted from embedding-cache.js for SOLID compliance (single responsibility).
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { DB_PATHS } from '../infrastructure/config/index.js';

// =============================================================================
// PER-MODE QUERY TELEMETRY (Step 0 of Vocabulary Prewarm)
// =============================================================================

const TELEMETRY_PATH = path.join(path.dirname(DB_PATHS.vocabulary), 'query-telemetry.jsonl');
const TELEMETRY_MAX_LINES = 10_000;
const FLUSH_THRESHOLD = 50;

export const telemetryStats = {
  lexical:  { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
  semantic: { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
  hybrid:   { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
};

// P1.2: Buffer entries in memory, flush periodically instead of per-query I/O
const _telemetryBuffer = [];
let _lineCountEstimate = -1; // -1 = unknown, needs initial read
let _flushPromise = null;

// Periodic flush interval (30s) and process exit hook to prevent tail loss.
// The interval uses unref() so it doesn't keep the process alive.
let _flushInterval = null;

function _ensureShutdownHooks() {
  if (_flushInterval) return; // already registered
  _flushInterval = setInterval(() => {
    if (_telemetryBuffer.length > 0) flushTelemetry().catch(() => {});
  }, 30_000);
  _flushInterval.unref(); // don't keep process alive for telemetry

  // Synchronous best-effort flush on exit — beforeExit fires for empty event
  // loop (normal exit), but NOT for SIGTERM/uncaughtException. We use both
  // beforeExit (async-safe) and exit (sync-only, last resort).
  process.on('beforeExit', _beforeExitFlush);
  process.on('exit', _syncFlush);
}

async function _beforeExitFlush() {
  try { await flushTelemetry(); } catch {}
}

function _syncFlush() {
  // exit handler is synchronous — write what we can via writeFileSync
  if (_telemetryBuffer.length === 0) return;
  try {
    mkdirSync(path.dirname(TELEMETRY_PATH), { recursive: true });
    appendFileSync(TELEMETRY_PATH, _telemetryBuffer.splice(0).join('\n') + '\n');
  } catch {}
}

/**
 * Record a single query telemetry event.
 * Updates in-memory stats and buffers the entry. Flushes to disk
 * every FLUSH_THRESHOLD entries (default 50) to avoid per-query file I/O.
 *
 * @param {'lexical'|'semantic'|'hybrid'} mode - Search mode used
 * @param {boolean} hit - Whether the cache was hit
 * @param {number} latencyMs - Query latency in milliseconds
 * @param {string} [query] - The query text (for promotion/demotion analysis)
 * @param {string} [source] - Embedding source ('vocabulary', 'semantic-cache', 'api', 'local')
 * @param {boolean} [lexicalHit] - For hybrid mode: whether lexical sub-path was a hit
 * @param {boolean} [semanticHit] - For hybrid mode: whether semantic sub-path was a hit
 */
export async function recordQueryTelemetry(mode, hit, latencyMs, query, source, lexicalHit, semanticHit) {
  const bucket = telemetryStats[mode];
  if (!bucket) return;

  bucket.count++;
  bucket.totalLatencyMs += latencyMs;
  if (hit) bucket.hits++; else bucket.misses++;

  _telemetryBuffer.push(JSON.stringify({
    mode,
    hit,
    latencyMs: Math.round(latencyMs * 100) / 100,
    timestamp: new Date().toISOString(),
    ...(query ? { query } : {}),
    ...(source ? { source } : {}),
    ...(lexicalHit != null ? { lexicalHit } : {}),
    ...(semanticHit != null ? { semanticHit } : {}),
  }));

  _ensureShutdownHooks();

  if (_telemetryBuffer.length >= FLUSH_THRESHOLD) {
    await flushTelemetry();
  }
}

/**
 * Flush buffered telemetry entries to disk.
 * Safe to call multiple times; coalesces concurrent flushes.
 */
export async function flushTelemetry() {
  if (_telemetryBuffer.length === 0) return;
  // Coalesce concurrent flush calls
  if (_flushPromise) return _flushPromise;
  _flushPromise = _flushTelemetryInner();
  try { await _flushPromise; } finally { _flushPromise = null; }
}

async function _flushTelemetryInner() {
  const batch = _telemetryBuffer.splice(0, _telemetryBuffer.length);
  if (batch.length === 0) return;

  try {
    await fs.mkdir(path.dirname(TELEMETRY_PATH), { recursive: true });

    // Lazy-init line count estimate (only once, not per query)
    if (_lineCountEstimate < 0) {
      if (existsSync(TELEMETRY_PATH)) {
        const content = await fs.readFile(TELEMETRY_PATH, 'utf-8');
        _lineCountEstimate = content.split('\n').filter(Boolean).length;
      } else {
        _lineCountEstimate = 0;
      }
    }

    // Rotate if over limit
    if (_lineCountEstimate + batch.length >= TELEMETRY_MAX_LINES) {
      if (existsSync(TELEMETRY_PATH)) {
        await fs.rename(TELEMETRY_PATH, TELEMETRY_PATH + '.bak');
      }
      _lineCountEstimate = 0;
    }

    await fs.appendFile(TELEMETRY_PATH, batch.join('\n') + '\n');
    _lineCountEstimate += batch.length;
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }
}

/**
 * Read the last N telemetry entries and compute per-mode statistics.
 *
 * @param {number} [lastN=100] - Number of recent entries to analyze
 * @returns {Promise<{modes: Record<string, {hits: number, misses: number, hitRate: string, avgLatencyMs: number, count: number}>, total: number}>}
 */
export async function getTelemetryReport(lastN = 100) {
  const modes = {
    lexical:  { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
    semantic: { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
    hybrid:   { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
  };

  try {
    if (!existsSync(TELEMETRY_PATH)) return { modes: _formatModes(modes), total: 0 };

    const content = await fs.readFile(TELEMETRY_PATH, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const recent = lines.slice(-lastN);

    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        const bucket = modes[entry.mode];
        if (!bucket) continue;
        bucket.count++;
        bucket.totalLatencyMs += entry.latencyMs || 0;
        if (entry.hit) bucket.hits++; else bucket.misses++;
      } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
    }

    return { modes: _formatModes(modes), total: recent.length };
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return { modes: _formatModes(modes), total: 0 };
  }
}

function _formatModes(modes) {
  const result = {};
  for (const [mode, stats] of Object.entries(modes)) {
    const total = stats.hits + stats.misses;
    result[mode] = {
      hits: stats.hits,
      misses: stats.misses,
      hitRate: total > 0 ? `${(stats.hits / total * 100).toFixed(1)}%` : '0.0%',
      avgLatencyMs: stats.count > 0 ? Math.round(stats.totalLatencyMs / stats.count * 100) / 100 : 0,
      count: stats.count,
    };
  }
  return result;
}

/**
 * Reset in-memory telemetry stats and buffer (for testing).
 * Also tears down shutdown hooks to prevent listener leaks in test suites.
 */
export function resetTelemetryStats() {
  for (const bucket of Object.values(telemetryStats)) {
    bucket.hits = 0;
    bucket.misses = 0;
    bucket.totalLatencyMs = 0;
    bucket.count = 0;
  }
  _telemetryBuffer.length = 0;
  _lineCountEstimate = -1;
  // Tear down hooks to prevent listener leaks during tests
  if (_flushInterval) {
    clearInterval(_flushInterval);
    _flushInterval = null;
  }
  process.removeListener('beforeExit', _beforeExitFlush);
  process.removeListener('exit', _syncFlush);
}
