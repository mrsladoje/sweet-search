/**
 * Embedding Telemetry - Per-mode query telemetry for vocabulary prewarm pipeline.
 * Extracted from embedding-cache.js for SOLID compliance (single responsibility).
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { DB_PATHS } from './config.js';

// =============================================================================
// PER-MODE QUERY TELEMETRY (Step 0 of Vocabulary Prewarm)
// =============================================================================

const TELEMETRY_PATH = path.join(path.dirname(DB_PATHS.vocabulary), 'query-telemetry.jsonl');
const TELEMETRY_MAX_LINES = 10_000;

export const telemetryStats = {
  lexical:  { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
  semantic: { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
  hybrid:   { hits: 0, misses: 0, totalLatencyMs: 0, count: 0 },
};

/**
 * Record a single query telemetry event.
 * Updates in-memory stats and appends to the JSONL file (auto-rotated at 10k lines).
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

  const entry = JSON.stringify({
    mode,
    hit,
    latencyMs: Math.round(latencyMs * 100) / 100,
    timestamp: new Date().toISOString(),
    ...(query ? { query } : {}),
    ...(source ? { source } : {}),
    ...(lexicalHit != null ? { lexicalHit } : {}),
    ...(semanticHit != null ? { semanticHit } : {}),
  });

  try {
    await fs.mkdir(path.dirname(TELEMETRY_PATH), { recursive: true });

    // Rotate if over limit
    if (existsSync(TELEMETRY_PATH)) {
      const content = await fs.readFile(TELEMETRY_PATH, 'utf-8');
      const lineCount = content.split('\n').filter(Boolean).length;
      if (lineCount >= TELEMETRY_MAX_LINES) {
        await fs.rename(TELEMETRY_PATH, TELEMETRY_PATH + '.bak');
      }
    }

    await fs.appendFile(TELEMETRY_PATH, entry + '\n');
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
 * Reset in-memory telemetry stats (for testing).
 */
export function resetTelemetryStats() {
  for (const bucket of Object.values(telemetryStats)) {
    bucket.hits = 0;
    bucket.misses = 0;
    bucket.totalLatencyMs = 0;
    bucket.count = 0;
  }
}
