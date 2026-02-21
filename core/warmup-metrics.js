/**
 * Warmup Metrics & Adaptive Learning (Step 9 of Vocabulary Prewarm)
 *
 * Tracks per-mode cache hit rates, latency percentiles, and provides
 * promotion/demotion rules for adaptive vocabulary management.
 * Integrates with Step 0 telemetry from embedding-cache.js.
 */

// =============================================================================
// WARMUP METRICS CLASS
// =============================================================================

export class WarmupMetrics {
  constructor() {
    this.lexical = { hits: 0, misses: 0, totalLatencyMs: 0, count: 0, latencies: [] };
    this.semantic = { hits: 0, misses: 0, totalLatencyMs: 0, count: 0, latencies: [] };
    this.hybrid = { hits: 0, misses: 0, totalLatencyMs: 0, count: 0, latencies: [] };
  }

  /**
   * Cache hit rate for a specific mode.
   * @param {'lexical'|'semantic'|'hybrid'} mode
   * @returns {number} 0-1 ratio
   */
  hitRate(mode) {
    const bucket = this[mode];
    if (!bucket) return 0;
    const total = bucket.hits + bucket.misses;
    return total > 0 ? bucket.hits / total : 0;
  }

  /**
   * Overall cache hit rate across all modes.
   * @returns {number} 0-1 ratio
   */
  overallHitRate() {
    let totalHits = 0;
    let totalQueries = 0;
    for (const mode of ['lexical', 'semantic', 'hybrid']) {
      totalHits += this[mode].hits;
      totalQueries += this[mode].hits + this[mode].misses;
    }
    return totalQueries > 0 ? totalHits / totalQueries : 0;
  }

  /**
   * Average latency for a mode.
   * @param {'lexical'|'semantic'|'hybrid'} mode
   * @returns {number} milliseconds
   */
  avgLatency(mode) {
    const bucket = this[mode];
    if (!bucket || bucket.count === 0) return 0;
    return bucket.totalLatencyMs / bucket.count;
  }

  /**
   * Latency percentile for a mode.
   * @param {'lexical'|'semantic'|'hybrid'} mode
   * @param {number} percentile - 0-100
   * @returns {number} milliseconds
   */
  latencyPercentile(mode, percentile) {
    const bucket = this[mode];
    if (!bucket || bucket.latencies.length === 0) return 0;
    const sorted = [...bucket.latencies].sort((a, b) => a - b);
    const idx = Math.min(
      Math.floor((percentile / 100) * sorted.length),
      sorted.length - 1,
    );
    return sorted[idx];
  }

  /**
   * Load metrics from parsed telemetry entries.
   * @param {Array<{mode: string, hit: boolean, latencyMs: number}>} entries
   */
  loadFromEntries(entries) {
    for (const entry of entries) {
      const bucket = this[entry.mode];
      if (!bucket) continue;

      bucket.count++;
      bucket.totalLatencyMs += entry.latencyMs || 0;
      bucket.latencies.push(entry.latencyMs || 0);

      if (entry.hit) {
        bucket.hits++;
      } else {
        bucket.misses++;
      }
    }
  }

  /**
   * Load from a getTelemetryReport()-style object (modes with hits/misses/count).
   * Note: loses per-query latency granularity (no percentiles).
   * @param {{ modes: Record<string, { hits: number, misses: number, avgLatencyMs: number, count: number }> }} report
   */
  loadFromReport(report) {
    if (!report?.modes) return;
    for (const [mode, stats] of Object.entries(report.modes)) {
      const bucket = this[mode];
      if (!bucket) continue;
      bucket.hits = stats.hits || 0;
      bucket.misses = stats.misses || 0;
      bucket.count = stats.count || 0;
      bucket.totalLatencyMs = (stats.avgLatencyMs || 0) * bucket.count;
    }
  }

  /**
   * Reset all counters.
   */
  reset() {
    for (const mode of ['lexical', 'semantic', 'hybrid']) {
      this[mode] = { hits: 0, misses: 0, totalLatencyMs: 0, count: 0, latencies: [] };
    }
  }
}

// =============================================================================
// CACHE HIT DEFINITIONS
// =============================================================================

/**
 * Determine if a query event counts as a cache hit for its mode.
 *
 * Lexical: FTS5 query latency < 5ms = hit
 * Semantic: source is 'vocabulary' or 'semantic-cache' = hit
 * Hybrid: both sub-mode hits = hit
 *
 * @param {object} entry - Telemetry entry
 * @param {string} entry.mode
 * @param {number} [entry.latencyMs]
 * @param {string} [entry.source] - 'vocabulary', 'semantic-cache', 'api', 'local', etc.
 * @param {boolean} [entry.lexicalHit] - For hybrid: lexical sub-hit
 * @param {boolean} [entry.semanticHit] - For hybrid: semantic sub-hit
 * @returns {boolean}
 */
export function isWarmupHit(entry) {
  switch (entry.mode) {
    case 'lexical':
      return (entry.latencyMs || Infinity) < 5;
    case 'semantic':
      return entry.source === 'vocabulary' || entry.source === 'semantic-cache';
    case 'hybrid':
      return Boolean(entry.lexicalHit && entry.semanticHit);
    default:
      return false;
  }
}

// =============================================================================
// PROMOTION / DEMOTION (Adaptive Learning)
// =============================================================================

/**
 * Find terms that should be promoted to the warmup vocabulary.
 *
 * Rules:
 * - PROMOTE: Query used 3+ times and not in warmup set
 * - FAST-PROMOTE: Cache miss for an identifier found in code (source: 'code-identifier')
 *
 * @param {Array<{query?: string, mode?: string, hit?: boolean, source?: string}>} telemetryEntries
 * @param {Set<string>|Map<string,any>|{has: (t: string) => boolean}} vocabularyTerms
 * @returns {Array<{term: string, reason: 'promote'|'fast-promote', queryCount: number}>}
 */
export function getPromotionCandidates(telemetryEntries, vocabularyTerms) {
  const queryCounts = new Map();
  const fastPromoteCandidates = new Set();

  const hasVocab = (term) => {
    if (!term) return true;
    const normalized = term.toLowerCase().trim();
    if (typeof vocabularyTerms.has === 'function') return vocabularyTerms.has(normalized);
    return false;
  };

  for (const entry of telemetryEntries) {
    const query = entry.query?.toLowerCase().trim();
    if (!query) continue;

    // Count occurrences
    queryCounts.set(query, (queryCounts.get(query) || 0) + 1);

    // Fast-promote: cache miss + code identifier source
    if (!entry.hit && entry.source === 'code-identifier' && !hasVocab(query)) {
      fastPromoteCandidates.add(query);
    }
  }

  const candidates = [];

  // PROMOTE: 3+ uses, not in vocabulary
  for (const [term, count] of queryCounts) {
    if (count >= 3 && !hasVocab(term)) {
      candidates.push({ term, reason: 'promote', queryCount: count });
    }
  }

  // FAST-PROMOTE: code identifier misses
  for (const term of fastPromoteCandidates) {
    // Skip if already in promote list
    if (candidates.some(c => c.term === term)) continue;
    candidates.push({
      term,
      reason: 'fast-promote',
      queryCount: queryCounts.get(term) || 1,
    });
  }

  // Sort by query count descending
  candidates.sort((a, b) => b.queryCount - a.queryCount);
  return candidates;
}

/**
 * Find terms that should be demoted from the warmup vocabulary.
 *
 * Rule: Warmup term not queried in `days` days -> DEMOTE
 *
 * @param {Set<string>|Map<string,any>|Iterable<string>} vocabularyTerms
 * @param {Array<{query?: string, timestamp?: string}>} telemetryEntries
 * @param {number} [days=7] - Inactivity threshold in days
 * @returns {Array<{term: string, reason: 'inactive', lastSeen: string|null}>}
 */
export function getDemotionCandidates(vocabularyTerms, telemetryEntries, days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // Build a map of term -> last seen timestamp
  const lastSeen = new Map();
  for (const entry of telemetryEntries) {
    const query = entry.query?.toLowerCase().trim();
    if (!query) continue;
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    const prev = lastSeen.get(query) || 0;
    if (ts > prev) lastSeen.set(query, ts);
  }

  const candidates = [];
  const terms = vocabularyTerms instanceof Map
    ? vocabularyTerms.keys()
    : vocabularyTerms[Symbol.iterator]
      ? vocabularyTerms
      : [];

  for (const term of terms) {
    const normalized = typeof term === 'string' ? term.toLowerCase().trim() : term;
    const seen = lastSeen.get(normalized) || 0;
    if (seen < cutoff) {
      candidates.push({
        term: normalized,
        reason: 'inactive',
        lastSeen: seen > 0 ? new Date(seen).toISOString() : null,
      });
    }
  }

  return candidates;
}

// =============================================================================
// WORKING SET SIZE ESTIMATION
// =============================================================================

/**
 * Estimate working set size = unique query clusters in a time window.
 *
 * Uses simple normalization (lowercase, trim) for clustering.
 *
 * @param {Array<{query?: string, timestamp?: string}>} telemetryEntries
 * @param {number} [windowMs=604800000] - Time window (default 7 days)
 * @param {number} [warmupSize=0] - Current warmup vocabulary size
 * @param {number} [maxWarmup=2000] - Maximum warmup set size
 * @returns {{ wss: number, warmupSize: number, recommendation: 'well-sized'|'expand'|'converged' }}
 */
export function estimateWorkingSetSize(
  telemetryEntries,
  windowMs = 7 * 24 * 60 * 60 * 1000,
  warmupSize = 0,
  maxWarmup = 2000,
) {
  const cutoff = Date.now() - windowMs;
  const uniqueQueries = new Set();

  for (const entry of telemetryEntries) {
    const query = entry.query?.toLowerCase().trim();
    if (!query) continue;
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    if (ts >= cutoff) {
      uniqueQueries.add(query);
    }
  }

  // F12: Basic string-similarity clustering (Jaccard on word sets) to avoid
  // counting near-duplicate queries as separate working set entries.
  const queryList = [...uniqueQueries];
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < queryList.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [queryList[i]];
    assigned.add(i);
    const wordsI = new Set(queryList[i].split(/\s+/));
    for (let j = i + 1; j < queryList.length; j++) {
      if (assigned.has(j)) continue;
      const wordsJ = new Set(queryList[j].split(/\s+/));
      // Jaccard similarity
      let intersection = 0;
      for (const w of wordsI) { if (wordsJ.has(w)) intersection++; }
      const union = wordsI.size + wordsJ.size - intersection;
      if (union > 0 && intersection / union >= 0.6) {
        cluster.push(queryList[j]);
        assigned.add(j);
      }
    }
    clusters.push(cluster);
  }

  const wss = clusters.length;
  let recommendation;

  if (warmupSize === 0 && wss === 0) {
    recommendation = 'well-sized';
  } else if (wss > warmupSize && warmupSize < maxWarmup) {
    recommendation = 'expand';
  } else if (wss <= warmupSize) {
    recommendation = 'well-sized';
  } else {
    // wss > warmupSize but warmupSize >= maxWarmup → can't expand further
    recommendation = 'converged';
  }

  return { wss, warmupSize, recommendation };
}

// =============================================================================
// STATS REPORT FORMATTER
// =============================================================================

/**
 * Render a horizontal bar chart segment.
 * @param {number} ratio - 0 to 1
 * @param {number} [width=10] - Number of characters
 * @returns {string} e.g. "████████░░"
 */
function _barChart(ratio, width = 10) {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

/**
 * Format a human-friendly elapsed-time string.
 * @param {Date|string|number} timestamp
 * @returns {string} e.g. "2 hours ago"
 */
function _timeAgo(timestamp) {
  if (!timestamp) return 'never';
  const ms = Date.now() - new Date(timestamp).getTime();
  if (ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/**
 * Depth label from identifier + phrase counts.
 * @param {number} identifiers
 * @param {number} phrases
 * @returns {string}
 */
function _depthLabel(identifiers, phrases) {
  const total = identifiers + phrases;
  if (total < 200) return 'shallow';
  if (total < 1000) return 'medium';
  return 'deep';
}

/**
 * Format the --stats output report.
 *
 * @param {WarmupMetrics} metrics
 * @param {Array<{id?: string|number, size?: number, name?: string}>} [communities=[]]
 * @param {object} [vocabInfo={}]
 * @param {number} [vocabInfo.identifierCount=0]
 * @param {number} [vocabInfo.phraseCount=0]
 * @param {string} [vocabInfo.depth]
 * @param {string|Date} [vocabInfo.lastWarmup]
 * @param {string} [vocabInfo.warmupType] - 'incremental' | 'full'
 * @param {number} [vocabInfo.newTerms]
 * @param {string} [vocabInfo.graphHash]
 * @param {string} [vocabInfo.nlHash]
 * @param {Array<{term: string, queryCount: number}>} [vocabInfo.topMisses=[]] - promotion candidates
 * @returns {string}
 */
export function formatStatsReport(metrics, communities = [], vocabInfo = {}) {
  const lines = [];
  const identifiers = vocabInfo.identifierCount || 0;
  const phrases = vocabInfo.phraseCount || 0;
  const depth = vocabInfo.depth || _depthLabel(identifiers, phrases);
  const communityCount = communities.length;

  lines.push('Vocabulary Warmup Statistics');
  lines.push('\u2501'.repeat(37));

  // Vocabulary info
  lines.push(
    `Vocabulary size:    ${identifiers.toLocaleString()} identifiers + ${phrases.toLocaleString()} community phrases (${depth} depth)`,
  );

  // Communities
  lines.push(
    `Communities:        ${communityCount} detected (Leiden, import-graph-based)`,
  );

  // Last warmup
  const warmupAgo = _timeAgo(vocabInfo.lastWarmup);
  const warmupDetail = vocabInfo.warmupType
    ? ` (${vocabInfo.warmupType}${vocabInfo.newTerms ? `, ${vocabInfo.newTerms} new terms` : ''})`
    : '';
  lines.push(`Last warmup:        ${warmupAgo}${warmupDetail}`);

  // Hashes
  if (vocabInfo.graphHash) {
    lines.push(`Import graph hash:  ${vocabInfo.graphHash} (up to date)`);
  }
  if (vocabInfo.nlHash) {
    lines.push(`NL content hash:    ${vocabInfo.nlHash} (up to date)`);
  }

  lines.push('');

  // Per-mode cache hit rates
  const totalQueries = ['lexical', 'semantic', 'hybrid'].reduce(
    (sum, m) => sum + metrics[m].hits + metrics[m].misses,
    0,
  );
  lines.push(`Cache Hit Rates (last ${totalQueries} queries):`);

  for (const mode of ['lexical', 'semantic', 'hybrid']) {
    const bucket = metrics[mode];
    const total = bucket.hits + bucket.misses;
    const rate = total > 0 ? bucket.hits / total : 0;
    const pct = (rate * 100).toFixed(1);
    const bar = _barChart(rate);
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    lines.push(`  ${label.padEnd(10)} ${pct.padStart(5)}%  ${bar} (${bucket.hits}/${total} queries)`);
  }

  // Overall
  const overallRate = metrics.overallHitRate();
  const overallPct = (overallRate * 100).toFixed(1);
  const overallBar = _barChart(overallRate);
  const overallHits = ['lexical', 'semantic', 'hybrid'].reduce((s, m) => s + metrics[m].hits, 0);
  lines.push(`  ${'Overall'.padEnd(10)} ${overallPct.padStart(5)}%  ${overallBar} (${overallHits}/${totalQueries} queries)`);

  lines.push('');

  // Latency percentiles
  lines.push('Latency (p50 / p95):');
  for (const mode of ['lexical', 'semantic', 'hybrid']) {
    const p50 = Math.round(metrics.latencyPercentile(mode, 50));
    const p95 = Math.round(metrics.latencyPercentile(mode, 95));
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    lines.push(`  ${label.padEnd(10)} ${p50}ms / ${p95}ms`);
  }

  lines.push('');

  // Top cache misses (promotion candidates)
  const topMisses = vocabInfo.topMisses || [];
  if (topMisses.length > 0) {
    lines.push(`Top ${Math.min(topMisses.length, 5)} Cache Misses (candidates for next warmup):`);
    for (let i = 0; i < Math.min(topMisses.length, 5); i++) {
      const m = topMisses[i];
      lines.push(`  ${i + 1}. "${m.term}" (queried ${m.queryCount}x, not in vocab)`);
    }
  }

  // F5: Community breakdown with phrases and topEntities
  if (communities.length > 0) {
    lines.push('');
    lines.push('Communities (Leiden):');
    for (let i = 0; i < Math.min(communities.length, 10); i++) {
      const c = communities[i];
      const name = c.name || `community-${c.id ?? i}`;
      const fileCount = c.fileIds?.length || c.size || c.entityCount || 0;
      const phraseList = (c.phrases || []).slice(0, 3).map(p => `"${p}"`).join(', ');
      const detail = phraseList ? ` \u2014 phrases: ${phraseList}` : '';
      lines.push(`  ${name}: ${fileCount} files${detail}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// TELEMETRY ENTRY PARSING HELPERS
// =============================================================================

/**
 * Parse raw JSONL telemetry file content into entry objects.
 * @param {string} content - Raw JSONL text
 * @param {number} [lastN=0] - Limit to last N entries (0 = all)
 * @returns {Array<object>}
 */
export function parseTelemetryEntries(content, lastN = 0) {
  const lines = content.split('\n').filter(Boolean);
  const subset = lastN > 0 ? lines.slice(-lastN) : lines;
  const entries = [];
  for (const line of subset) {
    try {
      entries.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }
  return entries;
}
