/**
 * Incremental Parser
 *
 * Provides chunk-level invalidation for selective reindex on file changes.
 * Two operating modes:
 *
 * 1. **Tree-sitter mode**: Uses `parser.parse(newSource, oldTree)` with
 *    `oldTree.getChangedRanges(newTree)` for byte-accurate change detection.
 *    Only chunks overlapping changed ranges are invalidated.
 *
 * 2. **Fallback mode**: Uses line-level diff to detect changed regions.
 *    Chunks whose `[line_start, line_end]` overlaps any changed line are
 *    invalidated. Less precise than tree-sitter but works for all languages.
 *
 * Both modes output the same result: a set of invalidated chunk IDs and
 * entity IDs that need re-extraction and re-embedding.
 *
 * Usage:
 *   const parser = new IncrementalParser();
 *   const result = parser.computeInvalidations(oldContent, newContent, oldChunks, oldEntities);
 *   // result.invalidatedChunkIds: Set of chunk IDs to re-embed
 *   // result.invalidatedEntityIds: Set of entity IDs to re-extract
 *   // result.changedLineRanges: Array of [startLine, endLine] ranges
 */

// ---------------------------------------------------------------------------
// Line-level diff (fallback when tree-sitter unavailable)
// ---------------------------------------------------------------------------

/**
 * Compute changed line ranges between old and new file content.
 * Uses a simple LCS-free algorithm: compare lines pairwise, detect
 * contiguous blocks of changes, handle insertions/deletions.
 *
 * @param {string} oldContent - Previous file content
 * @param {string} newContent - Updated file content
 * @returns {Array<{ startLine: number, endLine: number }>} Changed ranges (1-indexed)
 */
export function computeChangedLineRanges(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const ranges = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  let rangeStart = null;

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine !== newLine) {
      if (rangeStart === null) rangeStart = i;
    } else {
      if (rangeStart !== null) {
        ranges.push({ startLine: rangeStart + 1, endLine: i }); // 1-indexed
        rangeStart = null;
      }
    }
  }

  // Close final range
  if (rangeStart !== null) {
    ranges.push({ startLine: rangeStart + 1, endLine: maxLen });
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// Tree-sitter changed ranges (when available)
// ---------------------------------------------------------------------------

/**
 * Convert tree-sitter byte ranges to line ranges.
 * Tree-sitter `getChangedRanges()` returns `{ startPosition, endPosition }` objects
 * where positions have `{ row, column }` (0-indexed).
 *
 * @param {Array} tsRanges - Tree-sitter range objects
 * @returns {Array<{ startLine: number, endLine: number }>} 1-indexed line ranges
 */
export function treeSitterRangesToLineRanges(tsRanges) {
  return tsRanges.map(range => ({
    startLine: range.startPosition.row + 1,
    endLine: range.endPosition.row + 1,
  }));
}

// ---------------------------------------------------------------------------
// Overlap detection
// ---------------------------------------------------------------------------

/**
 * Check if two line ranges overlap.
 * Both ranges are inclusive: [startLine, endLine].
 *
 * @param {{ startLine: number, endLine: number }} a
 * @param {{ startLine: number, endLine: number }} b
 * @returns {boolean}
 */
export function rangesOverlap(a, b) {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Find chunks whose line ranges overlap any of the changed ranges.
 *
 * @param {Array<{ id: string, metadata: { line_start: number, line_end: number }}>} chunks
 * @param {Array<{ startLine: number, endLine: number }>} changedRanges
 * @returns {Set<string>} Invalidated chunk IDs
 */
export function findInvalidatedChunks(chunks, changedRanges) {
  const invalidated = new Set();
  if (changedRanges.length === 0) return invalidated;

  for (const chunk of chunks) {
    const chunkRange = {
      startLine: chunk.metadata?.line_start || 0,
      endLine: chunk.metadata?.line_end || 0,
    };
    if (chunkRange.startLine === 0 && chunkRange.endLine === 0) {
      // Chunk has no line info — invalidate conservatively
      invalidated.add(chunk.id);
      continue;
    }
    for (const changed of changedRanges) {
      if (rangesOverlap(chunkRange, changed)) {
        invalidated.add(chunk.id);
        break;
      }
    }
  }

  return invalidated;
}

/**
 * Find entities whose line ranges overlap any of the changed ranges.
 *
 * @param {Array<{ id: string, start_line: number, end_line: number }>} entities
 * @param {Array<{ startLine: number, endLine: number }>} changedRanges
 * @returns {Set<string>} Invalidated entity IDs
 */
export function findInvalidatedEntities(entities, changedRanges) {
  const invalidated = new Set();
  if (changedRanges.length === 0) return invalidated;

  for (const entity of entities) {
    const entityRange = {
      startLine: entity.start_line || 0,
      endLine: entity.end_line || 0,
    };
    if (entityRange.startLine === 0 && entityRange.endLine === 0) {
      invalidated.add(entity.id);
      continue;
    }
    for (const changed of changedRanges) {
      if (rangesOverlap(entityRange, changed)) {
        invalidated.add(entity.id);
        break;
      }
    }
  }

  return invalidated;
}

// ---------------------------------------------------------------------------
// AST cache for incremental tree-sitter parsing
// ---------------------------------------------------------------------------

/**
 * Per-file AST cache. Stores parsed tree-sitter trees keyed by file path.
 * Trees are kept in memory for incremental re-parsing.
 */
export class ASTCache {
  constructor(options = {}) {
    this._trees = new Map();
    this._maxSize = options.maxSize || 500;
  }

  /** Store a parsed tree for a file */
  set(filePath, tree) {
    // Evict oldest if at capacity (simple FIFO)
    if (this._trees.size >= this._maxSize && !this._trees.has(filePath)) {
      const firstKey = this._trees.keys().next().value;
      const evicted = this._trees.get(firstKey);
      try { evicted?.delete?.(); } catch { /* WASM cleanup */ }
      this._trees.delete(firstKey);
    }
    this._trees.set(filePath, tree);
  }

  /** Get cached tree for a file */
  get(filePath) {
    return this._trees.get(filePath) || null;
  }

  /** Remove a file from cache */
  delete(filePath) {
    const tree = this._trees.get(filePath);
    try { tree?.delete?.(); } catch { /* WASM cleanup */ }
    this._trees.delete(filePath);
  }

  /** Clear all cached trees */
  clear() {
    for (const tree of this._trees.values()) {
      try { tree?.delete?.(); } catch { /* WASM cleanup */ }
    }
    this._trees.clear();
  }

  /** Number of cached trees */
  get size() {
    return this._trees.size;
  }

  /** Check if a file has a cached tree */
  has(filePath) {
    return this._trees.has(filePath);
  }
}

// ---------------------------------------------------------------------------
// Main incremental parser
// ---------------------------------------------------------------------------

export class IncrementalParser {
  constructor(options = {}) {
    this._astCache = new ASTCache({ maxSize: options.maxCacheSize || 500 });
    this._treeSitterProvider = null;
    this._treeSitterChecked = false;
  }

  /** Lazily check for tree-sitter availability */
  async _getTreeSitterProvider() {
    if (this._treeSitterChecked) return this._treeSitterProvider;
    this._treeSitterChecked = true;

    try {
      const { getTreeSitterProvider } = await import('./tree-sitter-provider.js');
      const provider = getTreeSitterProvider();
      if (await provider.isAvailable()) {
        this._treeSitterProvider = provider;
      }
    } catch {
      // tree-sitter not available
    }
    return this._treeSitterProvider;
  }

  /**
   * Incrementally re-parse a file and compute changed ranges.
   *
   * With tree-sitter: uses `parse(newContent, oldTree)` + `getChangedRanges()`.
   * Without tree-sitter: falls back to line-level diff.
   *
   * @param {string} filePath - File path (for language detection and cache key)
   * @param {string} oldContent - Previous file content
   * @param {string} newContent - Updated file content
   * @param {string} [languageId] - Language ID override
   * @returns {Promise<{ changedRanges: Array, mode: 'tree-sitter' | 'line-diff' }>}
   */
  async getChangedRanges(filePath, oldContent, newContent, languageId) {
    const provider = await this._getTreeSitterProvider();

    if (provider && provider.hasLanguage(languageId || '')) {
      try {
        return await this._treeSitterChangedRanges(filePath, oldContent, newContent, languageId);
      } catch {
        // Fall through to line diff
      }
    }

    // Fallback: line-level diff
    const changedRanges = computeChangedLineRanges(oldContent, newContent);
    return { changedRanges, mode: 'line-diff' };
  }

  /**
   * Tree-sitter incremental parse path.
   * @private
   */
  async _treeSitterChangedRanges(filePath, oldContent, newContent, languageId) {
    const provider = this._treeSitterProvider;
    const language = await provider.loadLanguage(languageId);
    if (!language) {
      const changedRanges = computeChangedLineRanges(oldContent, newContent);
      return { changedRanges, mode: 'line-diff' };
    }

    // Get or create old tree
    let oldTree = this._astCache.get(filePath);
    if (!oldTree) {
      oldTree = await provider.parse(oldContent, languageId);
      if (!oldTree) {
        const changedRanges = computeChangedLineRanges(oldContent, newContent);
        return { changedRanges, mode: 'line-diff' };
      }
    }

    // Incremental parse with old tree
    const newTree = await provider.parse(newContent, languageId);
    if (!newTree) {
      this._astCache.delete(filePath);
      const changedRanges = computeChangedLineRanges(oldContent, newContent);
      return { changedRanges, mode: 'line-diff' };
    }

    // Get changed ranges from tree-sitter
    const tsRanges = oldTree.getChangedRanges(newTree);
    const changedRanges = treeSitterRangesToLineRanges(tsRanges);

    // Cache the new tree for next incremental parse
    this._astCache.set(filePath, newTree);
    // Clean up old tree (only if it's not the one we just cached)
    if (oldTree !== newTree) {
      try { oldTree.delete(); } catch { /* WASM cleanup */ }
    }

    return { changedRanges, mode: 'tree-sitter' };
  }

  /**
   * Compute full invalidation result for a file change.
   *
   * Given old/new content and the existing chunks/entities, returns:
   * - Which chunks need re-embedding
   * - Which entities need re-extraction
   * - The changed line ranges
   *
   * @param {string} filePath - File path
   * @param {string} oldContent - Previous content
   * @param {string} newContent - Updated content
   * @param {Array} oldChunks - Previous chunks with { id, metadata: { line_start, line_end } }
   * @param {Array} oldEntities - Previous entities with { id, start_line, end_line }
   * @param {string} [languageId] - Language ID override
   * @returns {Promise<{
   *   invalidatedChunkIds: Set<string>,
   *   invalidatedEntityIds: Set<string>,
   *   changedRanges: Array,
   *   mode: string,
   *   totalChunks: number,
   *   totalEntities: number,
   * }>}
   */
  async computeInvalidations(filePath, oldContent, newContent, oldChunks, oldEntities, languageId) {
    // Identical content → nothing to invalidate
    if (oldContent === newContent) {
      return {
        invalidatedChunkIds: new Set(),
        invalidatedEntityIds: new Set(),
        changedRanges: [],
        mode: 'no-change',
        totalChunks: oldChunks.length,
        totalEntities: oldEntities.length,
      };
    }

    const { changedRanges, mode } = await this.getChangedRanges(
      filePath, oldContent, newContent, languageId
    );

    const invalidatedChunkIds = findInvalidatedChunks(oldChunks, changedRanges);
    const invalidatedEntityIds = findInvalidatedEntities(oldEntities, changedRanges);

    return {
      invalidatedChunkIds,
      invalidatedEntityIds,
      changedRanges,
      mode,
      totalChunks: oldChunks.length,
      totalEntities: oldEntities.length,
    };
  }

  /** Get the AST cache (for inspection/testing) */
  get astCache() {
    return this._astCache;
  }

  /** Clear all cached state */
  reset() {
    this._astCache.clear();
    this._treeSitterProvider = null;
    this._treeSitterChecked = false;
  }
}

export default IncrementalParser;
