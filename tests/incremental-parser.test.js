/**
 * Incremental Parser Tests
 *
 * Tests for core/incremental-parser.js:
 * - Line-level diff (computeChangedLineRanges)
 * - Range overlap detection
 * - Chunk invalidation by line ranges
 * - Entity invalidation by line ranges
 * - AST cache lifecycle
 * - IncrementalParser end-to-end (line-diff mode)
 * - Tree-sitter range conversion
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeChangedLineRanges,
  treeSitterRangesToLineRanges,
  rangesOverlap,
  findInvalidatedChunks,
  findInvalidatedEntities,
  ASTCache,
  IncrementalParser,
} from '../core/incremental-parser.js';

// =============================================================================
// computeChangedLineRanges
// =============================================================================

describe('computeChangedLineRanges', () => {
  it('returns empty for identical content', () => {
    const ranges = computeChangedLineRanges('abc\ndef', 'abc\ndef');
    expect(ranges).toHaveLength(0);
  });

  it('detects single changed line', () => {
    const ranges = computeChangedLineRanges(
      'line1\nline2\nline3',
      'line1\nchanged\nline3'
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ startLine: 2, endLine: 2 });
  });

  it('detects contiguous block of changes', () => {
    const ranges = computeChangedLineRanges(
      'a\nb\nc\nd\ne',
      'a\nX\nY\nd\ne'
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ startLine: 2, endLine: 3 });
  });

  it('detects multiple disjoint changed regions', () => {
    const ranges = computeChangedLineRanges(
      'a\nb\nc\nd\ne\nf\ng',
      'a\nX\nc\nd\nY\nf\ng'
    );
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ startLine: 2, endLine: 2 });
    expect(ranges[1]).toEqual({ startLine: 5, endLine: 5 });
  });

  it('handles added lines at end', () => {
    const ranges = computeChangedLineRanges(
      'a\nb',
      'a\nb\nc\nd'
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startLine).toBe(3);
    expect(ranges[0].endLine).toBe(4);
  });

  it('handles removed lines at end', () => {
    const ranges = computeChangedLineRanges(
      'a\nb\nc\nd',
      'a\nb'
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startLine).toBe(3);
    expect(ranges[0].endLine).toBe(4);
  });

  it('handles completely different content', () => {
    const ranges = computeChangedLineRanges(
      'old1\nold2\nold3',
      'new1\nnew2\nnew3'
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ startLine: 1, endLine: 3 });
  });

  it('handles empty old content', () => {
    const ranges = computeChangedLineRanges('', 'new1\nnew2');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startLine).toBe(1);
  });

  it('handles empty new content', () => {
    const ranges = computeChangedLineRanges('old1\nold2', '');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startLine).toBe(1);
  });

  it('handles first line change', () => {
    const ranges = computeChangedLineRanges(
      'old\nb\nc',
      'new\nb\nc'
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ startLine: 1, endLine: 1 });
  });

  it('handles last line change', () => {
    const ranges = computeChangedLineRanges(
      'a\nb\nold',
      'a\nb\nnew'
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ startLine: 3, endLine: 3 });
  });
});

// =============================================================================
// treeSitterRangesToLineRanges
// =============================================================================

describe('treeSitterRangesToLineRanges', () => {
  it('converts 0-indexed tree-sitter positions to 1-indexed lines', () => {
    const tsRanges = [
      { startPosition: { row: 4, column: 0 }, endPosition: { row: 8, column: 0 } },
      { startPosition: { row: 15, column: 2 }, endPosition: { row: 15, column: 40 } },
    ];
    const result = treeSitterRangesToLineRanges(tsRanges);
    expect(result).toEqual([
      { startLine: 5, endLine: 9 },
      { startLine: 16, endLine: 16 },
    ]);
  });

  it('returns empty for no ranges', () => {
    expect(treeSitterRangesToLineRanges([])).toEqual([]);
  });
});

// =============================================================================
// rangesOverlap
// =============================================================================

describe('rangesOverlap', () => {
  it('returns true for overlapping ranges', () => {
    expect(rangesOverlap(
      { startLine: 1, endLine: 10 },
      { startLine: 5, endLine: 15 }
    )).toBe(true);
  });

  it('returns true for contained range', () => {
    expect(rangesOverlap(
      { startLine: 1, endLine: 20 },
      { startLine: 5, endLine: 10 }
    )).toBe(true);
  });

  it('returns true for touching ranges (end == start)', () => {
    expect(rangesOverlap(
      { startLine: 1, endLine: 5 },
      { startLine: 5, endLine: 10 }
    )).toBe(true);
  });

  it('returns false for non-overlapping ranges', () => {
    expect(rangesOverlap(
      { startLine: 1, endLine: 5 },
      { startLine: 6, endLine: 10 }
    )).toBe(false);
  });

  it('returns true for identical ranges', () => {
    expect(rangesOverlap(
      { startLine: 3, endLine: 7 },
      { startLine: 3, endLine: 7 }
    )).toBe(true);
  });

  it('returns false for far-apart ranges', () => {
    expect(rangesOverlap(
      { startLine: 1, endLine: 3 },
      { startLine: 100, endLine: 200 }
    )).toBe(false);
  });
});

// =============================================================================
// findInvalidatedChunks
// =============================================================================

describe('findInvalidatedChunks', () => {
  const makeChunk = (id, lineStart, lineEnd) => ({
    id,
    metadata: { line_start: lineStart, line_end: lineEnd },
  });

  it('returns empty for no changed ranges', () => {
    const chunks = [makeChunk('c1', 1, 10), makeChunk('c2', 11, 20)];
    const result = findInvalidatedChunks(chunks, []);
    expect(result.size).toBe(0);
  });

  it('invalidates only overlapping chunks', () => {
    const chunks = [
      makeChunk('c1', 1, 10),
      makeChunk('c2', 11, 20),
      makeChunk('c3', 21, 30),
    ];
    const changedRanges = [{ startLine: 8, endLine: 13 }];
    const result = findInvalidatedChunks(chunks, changedRanges);
    expect(result.size).toBe(2);
    expect(result.has('c1')).toBe(true);
    expect(result.has('c2')).toBe(true);
    expect(result.has('c3')).toBe(false);
  });

  it('handles multiple changed ranges', () => {
    const chunks = [
      makeChunk('c1', 1, 5),
      makeChunk('c2', 10, 15),
      makeChunk('c3', 20, 25),
      makeChunk('c4', 30, 35),
    ];
    const changedRanges = [
      { startLine: 3, endLine: 4 },
      { startLine: 22, endLine: 24 },
    ];
    const result = findInvalidatedChunks(chunks, changedRanges);
    expect(result.size).toBe(2);
    expect(result.has('c1')).toBe(true);
    expect(result.has('c3')).toBe(true);
  });

  it('conservatively invalidates chunks with no line info', () => {
    const chunks = [
      { id: 'c1', metadata: {} },
      { id: 'c2', metadata: { line_start: 0, line_end: 0 } },
    ];
    const changedRanges = [{ startLine: 5, endLine: 10 }];
    const result = findInvalidatedChunks(chunks, changedRanges);
    expect(result.size).toBe(2);
  });
});

// =============================================================================
// findInvalidatedEntities
// =============================================================================

describe('findInvalidatedEntities', () => {
  const makeEntity = (id, startLine, endLine) => ({
    id,
    start_line: startLine,
    end_line: endLine,
  });

  it('returns empty for no changed ranges', () => {
    const entities = [makeEntity('e1', 1, 10)];
    const result = findInvalidatedEntities(entities, []);
    expect(result.size).toBe(0);
  });

  it('invalidates overlapping entities', () => {
    const entities = [
      makeEntity('e1', 1, 15),
      makeEntity('e2', 20, 30),
      makeEntity('e3', 50, 60),
    ];
    const changedRanges = [{ startLine: 10, endLine: 12 }];
    const result = findInvalidatedEntities(entities, changedRanges);
    expect(result.size).toBe(1);
    expect(result.has('e1')).toBe(true);
  });

  it('invalidates entities with no line info', () => {
    const entities = [{ id: 'e1', start_line: 0, end_line: 0 }];
    const changedRanges = [{ startLine: 5, endLine: 10 }];
    const result = findInvalidatedEntities(entities, changedRanges);
    expect(result.has('e1')).toBe(true);
  });
});

// =============================================================================
// ASTCache
// =============================================================================

describe('ASTCache', () => {
  let cache;

  beforeEach(() => {
    cache = new ASTCache({ maxSize: 3 });
  });

  it('stores and retrieves trees', () => {
    const mockTree = { rootNode: 'mock' };
    cache.set('a.ts', mockTree);
    expect(cache.get('a.ts')).toBe(mockTree);
    expect(cache.has('a.ts')).toBe(true);
  });

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent.ts')).toBeNull();
    expect(cache.has('nonexistent.ts')).toBe(false);
  });

  it('tracks size', () => {
    expect(cache.size).toBe(0);
    cache.set('a.ts', {});
    cache.set('b.ts', {});
    expect(cache.size).toBe(2);
  });

  it('evicts oldest when at capacity', () => {
    cache.set('a.ts', { id: 'a' });
    cache.set('b.ts', { id: 'b' });
    cache.set('c.ts', { id: 'c' });
    expect(cache.size).toBe(3);

    // Adding a 4th should evict 'a.ts' (FIFO)
    cache.set('d.ts', { id: 'd' });
    expect(cache.size).toBe(3);
    expect(cache.has('a.ts')).toBe(false);
    expect(cache.has('d.ts')).toBe(true);
  });

  it('does not evict when updating existing key', () => {
    cache.set('a.ts', { id: 'a1' });
    cache.set('b.ts', { id: 'b' });
    cache.set('c.ts', { id: 'c' });

    // Update 'a.ts' — should NOT evict anything
    cache.set('a.ts', { id: 'a2' });
    expect(cache.size).toBe(3);
    expect(cache.get('a.ts').id).toBe('a2');
    expect(cache.has('b.ts')).toBe(true);
  });

  it('deletes entries', () => {
    cache.set('a.ts', {});
    cache.delete('a.ts');
    expect(cache.has('a.ts')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('clears all entries', () => {
    cache.set('a.ts', {});
    cache.set('b.ts', {});
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('calls delete() on evicted WASM trees', () => {
    let deleteCalled = false;
    const mockTree = { delete: () => { deleteCalled = true; } };
    cache.set('a.ts', mockTree);
    cache.set('b.ts', {});
    cache.set('c.ts', {});
    cache.set('d.ts', {}); // evicts 'a.ts'
    expect(deleteCalled).toBe(true);
  });
});

// =============================================================================
// IncrementalParser (line-diff mode)
// =============================================================================

describe('IncrementalParser', () => {
  let parser;

  beforeEach(() => {
    parser = new IncrementalParser();
  });

  it('returns no-change for identical content', async () => {
    const result = await parser.computeInvalidations(
      'test.ts', 'abc\ndef', 'abc\ndef', [], []
    );
    expect(result.mode).toBe('no-change');
    expect(result.invalidatedChunkIds.size).toBe(0);
    expect(result.invalidatedEntityIds.size).toBe(0);
    expect(result.changedRanges).toHaveLength(0);
  });

  it('invalidates overlapping chunks on change', async () => {
    const oldContent = 'line1\nline2\nline3\nline4\nline5';
    const newContent = 'line1\nchanged\nline3\nline4\nline5';

    const chunks = [
      { id: 'c1', metadata: { line_start: 1, line_end: 2 } },
      { id: 'c2', metadata: { line_start: 3, line_end: 5 } },
    ];

    const result = await parser.computeInvalidations(
      'test.ts', oldContent, newContent, chunks, []
    );
    expect(result.mode).toBe('line-diff');
    expect(result.invalidatedChunkIds.has('c1')).toBe(true);
    expect(result.invalidatedChunkIds.has('c2')).toBe(false);
  });

  it('invalidates overlapping entities on change', async () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nchanged\nline3';

    const entities = [
      { id: 'e1', start_line: 1, end_line: 1 },
      { id: 'e2', start_line: 2, end_line: 3 },
    ];

    const result = await parser.computeInvalidations(
      'test.ts', oldContent, newContent, [], entities
    );
    expect(result.invalidatedEntityIds.has('e1')).toBe(false);
    expect(result.invalidatedEntityIds.has('e2')).toBe(true);
  });

  it('invalidates both chunks and entities together', async () => {
    const old = 'a\nb\nc\nd\ne';
    const neu = 'a\nX\nc\nd\ne';

    const chunks = [
      { id: 'c1', metadata: { line_start: 1, line_end: 3 } },
      { id: 'c2', metadata: { line_start: 4, line_end: 5 } },
    ];
    const entities = [
      { id: 'e1', start_line: 2, end_line: 2 },
      { id: 'e2', start_line: 4, end_line: 5 },
    ];

    const result = await parser.computeInvalidations('f.ts', old, neu, chunks, entities);
    expect(result.invalidatedChunkIds.size).toBe(1);
    expect(result.invalidatedChunkIds.has('c1')).toBe(true);
    expect(result.invalidatedEntityIds.size).toBe(1);
    expect(result.invalidatedEntityIds.has('e1')).toBe(true);
  });

  it('reports total counts', async () => {
    const result = await parser.computeInvalidations(
      'f.ts', 'a\nb', 'a\nX',
      [{ id: 'c1', metadata: { line_start: 1, line_end: 2 } }],
      [{ id: 'e1', start_line: 1, end_line: 2 }]
    );
    expect(result.totalChunks).toBe(1);
    expect(result.totalEntities).toBe(1);
  });

  it('handles complete file rewrite', async () => {
    const chunks = [
      { id: 'c1', metadata: { line_start: 1, line_end: 5 } },
      { id: 'c2', metadata: { line_start: 6, line_end: 10 } },
    ];
    const result = await parser.computeInvalidations(
      'f.ts',
      'old1\nold2\nold3\nold4\nold5\nold6\nold7\nold8\nold9\nold10',
      'new1\nnew2\nnew3\nnew4\nnew5\nnew6\nnew7\nnew8\nnew9\nnew10',
      chunks, []
    );
    // All chunks invalidated on full rewrite
    expect(result.invalidatedChunkIds.size).toBe(2);
  });

  it('reset clears cache and provider state', () => {
    parser.astCache.set('a.ts', {});
    expect(parser.astCache.size).toBe(1);
    parser.reset();
    expect(parser.astCache.size).toBe(0);
  });
});

// =============================================================================
// Realistic scenario: TypeScript file edit
// =============================================================================

describe('Realistic TypeScript file edit scenario', () => {
  const parser = new IncrementalParser();

  const oldContent = `import { Router } from 'express';

export interface UserConfig {
  name: string;
  email: string;
}

export class UserService {
  constructor(private db: Database) {}

  async getUser(id: string): Promise<User> {
    return this.db.findOne({ id });
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.delete({ id });
  }
}

export function createRouter(): Router {
  return new Router();
}`;

  const newContent = `import { Router } from 'express';

export interface UserConfig {
  name: string;
  email: string;
  avatar?: string;
}

export class UserService {
  constructor(private db: Database) {}

  async getUser(id: string): Promise<User> {
    return this.db.findOne({ id });
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    return this.db.update({ id }, data);
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.delete({ id });
  }
}

export function createRouter(): Router {
  return new Router();
}`;

  it('detects interface modification and method addition', async () => {
    const chunks = [
      { id: 'chunk-import', metadata: { line_start: 1, line_end: 1 } },
      { id: 'chunk-interface', metadata: { line_start: 3, line_end: 6 } },
      { id: 'chunk-class', metadata: { line_start: 8, line_end: 18 } },
      { id: 'chunk-function', metadata: { line_start: 20, line_end: 22 } },
    ];

    const entities = [
      { id: 'e-interface', start_line: 3, end_line: 6 },
      { id: 'e-class', start_line: 8, end_line: 18 },
      { id: 'e-getUser', start_line: 11, end_line: 13 },
      { id: 'e-deleteUser', start_line: 15, end_line: 17 },
      { id: 'e-createRouter', start_line: 20, end_line: 22 },
    ];

    const result = await parser.computeInvalidations(
      'user-service.ts', oldContent, newContent, chunks, entities
    );

    // Interface chunk and class chunk should be invalidated
    expect(result.invalidatedChunkIds.has('chunk-interface')).toBe(true);
    expect(result.invalidatedChunkIds.has('chunk-class')).toBe(true);
    // Import chunk should be unchanged
    expect(result.invalidatedChunkIds.has('chunk-import')).toBe(false);

    // Interface entity and class-related entities should be invalidated
    expect(result.invalidatedEntityIds.has('e-interface')).toBe(true);
    expect(result.invalidatedEntityIds.has('e-class')).toBe(true);
  });
});
