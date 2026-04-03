/**
 * Chunk Location & File Reader Module — maps grep matches to indexed chunks.
 *
 * Provides the interval-map data structure that converts file:line grep hits
 * into indexed chunk IDs for MaxSim reranking, plus helpers for reading file
 * ranges, building bare-grep result objects, and symbol-type filtering.
 *
 * Split from search-pattern.js for the 500-line-limit rule.
 */

import path from 'path';
import { readFileSync } from 'fs';
import { PROJECT_ROOT } from '../infrastructure/config/index.js';
import { CODE_FILE_EXTENSIONS } from '../infrastructure/constants.js';

// =============================================================================
// Code path detection and symbol type helpers
// =============================================================================

export function isRipgrepCodePath(filePath) {
  const ext = path.extname(filePath || '').slice(1).toLowerCase();
  return CODE_FILE_EXTENSIONS.has(ext);
}

export function normalizeSearchSymbolType(symbolType) {
  if (typeof symbolType !== 'string') return null;
  const normalized = symbolType.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('function')) return 'function';
  if (normalized.includes('method')) return 'method';
  if (normalized.includes('class')) return 'class';
  if (normalized.includes('import')) return 'import';
  if (
    normalized.includes('type') ||
    normalized.includes('interface') ||
    normalized.includes('enum') ||
    normalized.includes('typedef')
  ) {
    return 'type';
  }
  return 'other';
}

export function resolveSearchSymbolFilter(options = {}) {
  return normalizeSearchSymbolType(options.symbolType || options.type || '');
}

// =============================================================================
// Chunk location map — maps file:line → chunk IDs
// =============================================================================

/**
 * Build a sorted interval map from late interaction index metadata.
 * Used for O(log n) lookup of which indexed chunk contains a given file:line.
 *
 * @param {import('../ranking/late-interaction-index.js').LateInteractionIndex} liIndex
 * @returns {Map<string, Array<{startLine: number, endLine: number, id: string, type?: string, name?: string}>>}
 */
export function buildChunkLocationMap(liIndex) {
  const map = new Map();

  for (const [id, doc] of liIndex.documents) {
    const meta = doc.metadata;
    if (!meta?.file || meta.startLine == null || meta.endLine == null) continue;

    let bucket = map.get(meta.file);
    if (!bucket) {
      bucket = [];
      map.set(meta.file, bucket);
    }
    bucket.push({
      startLine: meta.startLine,
      endLine: meta.endLine,
      id,
      type: meta.type || null,
      name: meta.name || null,
    });
  }

  // Sort each file's intervals by startLine for binary search
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startLine - b.startLine);
  }

  return map;
}

export function findChunkIntervalForLine(intervals, lineNumber) {
  if (!intervals || intervals.length === 0) return null;

  let lo = 0;
  let hi = intervals.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const iv = intervals[mid];

    if (lineNumber < iv.startLine) {
      hi = mid - 1;
    } else if (lineNumber > iv.endLine) {
      lo = mid + 1;
    } else {
      return { interval: iv, index: mid };
    }
  }

  return null;
}

/**
 * Binary search for the chunk whose [startLine, endLine] contains `lineNumber`.
 *
 * @param {Array<{startLine: number, endLine: number, id: string}>|undefined} intervals
 * @param {number} lineNumber
 * @returns {string|null} chunk ID or null
 */
export function findChunkForLine(intervals, lineNumber) {
  return findChunkIntervalForLine(intervals, lineNumber)?.interval?.id || null;
}

/**
 * Map ripgrep matches to indexed chunk IDs.
 * Returns match counts per chunk (grep density) alongside the ID set.
 *
 * Adjacent chunk inclusion: when a regex matches a line at the boundary
 * of a chunk (within 2 lines of the chunk's start or end), the adjacent
 * chunk is also included as a candidate. This handles the common case
 * where the AST chunker splits a function signature from its body —
 * the regex hits the signature line but the gold chunk is the body.
 *
 * @param {Array<{file: string, line: number, content: string}>} matches
 * @param {Map} locationMap - Output of buildChunkLocationMap
 * @param {Object} [opts]
 * @param {boolean} [opts.includeAdjacent=true] - Include adjacent chunks at boundaries
 * @returns {{ chunkIds: Set<string>, chunkMatchCounts: Map<string, number>, unindexed: Array }}
 */
export function mapMatchesToChunks(matches, locationMap, opts = {}) {
  const includeAdjacent = opts.includeAdjacent ?? true;
  const chunkMatchCounts = new Map();
  const unindexed = [];

  for (const match of matches) {
    const intervals = locationMap.get(match.file);
    if (!intervals) { unindexed.push(match); continue; }

    const result = findChunkIntervalForLine(intervals, match.line);
    if (result) {
      const { interval: iv, index: idx } = result;
      chunkMatchCounts.set(iv.id, (chunkMatchCounts.get(iv.id) || 0) + 1);

      // Adjacent chunk inclusion: if the match is near a chunk boundary,
      // also include the next/prev chunk. This catches signature/body splits.
      if (includeAdjacent) {
        // If match is within 2 lines of chunk end and there's a next chunk
        if (match.line >= iv.endLine - 1 && idx + 1 < intervals.length) {
          const nextId = intervals[idx + 1].id;
          if (!chunkMatchCounts.has(nextId)) chunkMatchCounts.set(nextId, 0);
        }
        // If match is within 2 lines of chunk start and there's a prev chunk
        if (match.line <= iv.startLine + 1 && idx > 0) {
          const prevId = intervals[idx - 1].id;
          if (!chunkMatchCounts.has(prevId)) chunkMatchCounts.set(prevId, 0);
        }
      }
    } else {
      // Match falls in a gap — binary search for nearest following chunk
      if (includeAdjacent) {
        let lo = 0;
        let hi = intervals.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (intervals[mid].startLine <= match.line) {
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (lo < intervals.length && intervals[lo].startLine - match.line <= 3) {
          if (!chunkMatchCounts.has(intervals[lo].id)) chunkMatchCounts.set(intervals[lo].id, 0);
        }
      }
      unindexed.push(match);
    }
  }

  return { chunkIds: new Set(chunkMatchCounts.keys()), chunkMatchCounts, unindexed };
}

// =============================================================================
// File content loader (per-search cache to avoid re-reading the same file)
// =============================================================================

/**
 * Read a range of lines from a file (1-indexed, inclusive).
 * Uses a per-search fileCache to avoid re-reading the same file for
 * multiple results.
 *
 * @param {Map<string, string[]>} fileCache - Map<absPath, lines[]>
 * @param {string} filePath - Relative or absolute path
 * @param {number} startLine - 1-indexed start
 * @param {number} endLine - 1-indexed end (inclusive)
 * @returns {string|null}
 */
export function readFileRange(fileCache, filePath, startLine, endLine, projectRoot) {
  try {
    const root = projectRoot || PROJECT_ROOT;
    const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
    const resolved = path.resolve(abs);
    const resolvedRoot = path.resolve(root);
    // Prevent path traversal outside project root
    if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
      return null;
    }
    let lines = fileCache.get(resolved);
    if (!lines) {
      lines = readFileSync(resolved, 'utf-8').split('\n');
      fileCache.set(resolved, lines);
    }
    return lines.slice((startLine || 1) - 1, endLine || startLine).join('\n');
  } catch {
    return null;
  }
}

export function buildBareGrepResults(matches, options = {}) {
  const {
    projectRoot = PROJECT_ROOT,
    contextLines = 0,
  } = options;

  const fileCache = new Map();

  return matches.map((match, index) => {
    let contextBefore = [];
    let contextAfter = [];

    if (contextLines > 0) {
      const before = readFileRange(fileCache, match.file, Math.max(1, match.line - contextLines), match.line - 1, projectRoot);
      const after = readFileRange(fileCache, match.file, match.line + 1, match.line + contextLines, projectRoot);
      contextBefore = before ? before.split('\n').filter(Boolean) : [];
      contextAfter = after ? after.split('\n').filter(Boolean) : [];
    }

    return {
      id: `grep:${match.file}:${match.line}:${match.column || 1}:${index}`,
      file: match.file,
      line: match.line,
      column: match.column || 1,
      matchText: match.matchText || '',
      content: match.content,
      text: match.content,
      contextBefore,
      contextAfter,
      searchPath: 'grep',
      metadata: {
        file: match.file,
        startLine: match.line,
        endLine: match.line,
      },
    };
  });
}

// =============================================================================
// Lazy chunk location map initialization (wired onto SweetSearch.prototype)
// =============================================================================

/**
 * Get or build the chunk location map. Cached on this._chunkLocationMap.
 * Rebuilds only when the LI index document count changes (re-index).
 */
export function getChunkLocationMap() {
  const currentSize = this.lateInteractionIndex.documents.size;
  if (this._chunkLocationMap && this._chunkLocationMapSize === currentSize) {
    return this._chunkLocationMap;
  }
  this._chunkLocationMap = buildChunkLocationMap(this.lateInteractionIndex);
  this._chunkLocationMapSize = currentSize;
  return this._chunkLocationMap;
}

export function getCodebaseChunkTypeMap(searcher) {
  if (!searcher?.codebaseDb) return null;
  if (searcher._codebaseChunkTypeMap) return searcher._codebaseChunkTypeMap;

  const map = new Map();
  const rows = searcher.codebaseDb.prepare('SELECT file_path, metadata FROM vectors').iterate();

  for (const row of rows) {
    try {
      if (!row.file_path) continue;
      const metadata = JSON.parse(row.metadata || '{}');
      if (metadata.startLine == null || metadata.endLine == null) continue;

      let bucket = map.get(row.file_path);
      if (!bucket) {
        bucket = [];
        map.set(row.file_path, bucket);
      }

      bucket.push({
        startLine: metadata.startLine,
        endLine: metadata.endLine,
        id: row.file_path,
        type: metadata.type || null,
        name: metadata.name || null,
      });
    } catch {
      // Ignore malformed metadata rows.
    }
  }

  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startLine - b.startLine);
  }

  searcher._codebaseChunkTypeMap = map;
  return map;
}

export function filterMatchesBySymbolType(matches, symbolType, searcher) {
  if (!symbolType || !Array.isArray(matches) || matches.length === 0) {
    return matches;
  }

  const locationMap = getCodebaseChunkTypeMap(searcher);
  if (!locationMap) {
    return matches;
  }

  return matches.filter((match) => {
    const result = findChunkIntervalForLine(locationMap.get(match.file), match.line);
    return normalizeSearchSymbolType(result?.interval?.type) === symbolType;
  });
}
